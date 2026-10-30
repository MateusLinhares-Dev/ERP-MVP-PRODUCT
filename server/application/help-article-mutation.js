/**
 * Atomic operations on ERP help articles, using Firebase RTDB REST ETags.
 *
 * The Admin SDK's transaction callback may initially receive null on an
 * uncached node even after a child.get(), incorrectly reporting 404. REST
 * conditional writes use the server's real ETag and avoid that cache race.
 * All credentials and database requests remain on the server.
 */
const fail = (message, status = 503, code = 'HELP_STORE_UNAVAILABLE') =>
  Object.assign(new Error(message), { status, code });

function requireFirebaseDatabaseUrl(value, projectId) {
  let url;
  try { url = new URL(value); } catch { throw fail('URL do Realtime Database inválida.', 500); }
  const hostname = url.hostname.toLowerCase();
  const validDomain = hostname.endsWith('.firebaseio.com') || hostname.endsWith('.firebasedatabase.app');
  if (url.protocol !== 'https:' || !validDomain || !hostname.startsWith(projectId.toLowerCase() + '-') || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw fail('URL do Realtime Database não corresponde ao projeto Firebase.', 500);
  }
  return url.origin;
}

/**
 * Supply the Firebase Admin app, not a browser token. The OAuth credential
 * has the database scope and is never sent to a client.
 */
export async function firebaseArticleTransport({ app, projectId, databaseUrl, fetchImpl = fetch }) {
  if (!app?.options?.credential?.getAccessToken) throw fail('Credencial administrativa indisponível.', 500);
  const base = requireFirebaseDatabaseUrl(databaseUrl, projectId);
  const credentials = await app.options.credential.getAccessToken();
  if (!credentials?.access_token) throw fail('Autenticação administrativa indisponível.', 503);
  const authorization = 'Bearer ' + credentials.access_token;
  const baseHeaders = { Authorization: authorization, Accept: 'application/json' };
  const address = id => `${base}/erpHelp/articles/${encodeURIComponent(id)}.json`;
  async function request(url, options) {
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
    catch { throw fail('Não foi possível comunicar com o Realtime Database. Nenhum sucesso foi confirmado.'); }
    if ([401, 403].includes(response.status)) throw fail('A credencial do servidor não possui acesso ao Realtime Database.', 503, 'HELP_STORE_AUTH');
    if (response.status >= 500 || response.status === 404) throw fail('Realtime Database indisponível para escrita.', 503);
    return response;
  }
  return {
    async read(id) {
      const response = await request(address(id), { method: 'GET', headers: { ...baseHeaders, 'X-Firebase-ETag': 'true' } });
      if (!response.ok) throw fail('Não foi possível consultar o artigo no Firebase.');
      const value = await response.json();
      const etag = response.headers.get('etag');
      if (!etag) throw fail('Firebase não retornou a versão do artigo.');
      return { value, etag };
    },
    async write(id, { action, value, etag }) {
      const response = await request(address(id), {
        method: action === 'delete' ? 'DELETE' : 'PUT',
        headers: { ...baseHeaders, 'Content-Type': 'application/json', 'if-match': etag },
        ...(action === 'delete' ? {} : { body: JSON.stringify(value) }),
      });
      if (response.status === 412) return { conflict: true };
      if (!response.ok) throw fail('O Firebase não confirmou a gravação do artigo.');
      return { conflict: false };
    },
  };
}

/** Validate revision against the live server record, then use ETag compare-and-swap. */
export async function mutateHelpArticle(transport, { action, id, existing = true, revision, article, actor }) {
  const { value: current, etag } = await transport.read(id);
  if (!current && (action === 'delete' || existing)) {
    return { outcome: 'not_found' };
  }
  if (current && (!existing || Number(current.revision ?? 0) !== revision)) {
    return { outcome: 'conflict' };
  }
  if (action !== 'save' && action !== 'delete') throw fail('Ação inválida.', 400, 'HELP_INVALID_ACTION');
  const now = Date.now();
  const doc = action === 'save' ? {
    ...article, id, revision: revision + 1,
    createdAt: current?.createdAt || now, createdBy: current?.createdBy || actor,
    updatedAt: now, updatedBy: actor,
  } : null;
  const result = await transport.write(id, { action, value: doc, etag });
  if (result.conflict) return { outcome: 'conflict' };
  return { outcome: 'ok', article: doc };
}
