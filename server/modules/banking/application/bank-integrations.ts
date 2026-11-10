import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { runTransaction } from '../../../shared/firebase/rtdb-transaction.js';

type Row = Record<string, unknown>;
type Fetcher = typeof globalThis.fetch;

export interface EncryptedCredentials {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface ProviderSecret {
  clientId: string;
  clientSecret: string;
}

interface IntegrationConfig {
  provider?: string;
  secret?: EncryptedCredentials;
  itemId?: string;
  accountId?: string;
  syncCursor?: string;
  lastSyncAt?: number;
  lastSyncCount?: number;
  updatedAt?: number;
}

interface ProviderTransaction {
  id?: unknown;
  date?: unknown;
  amount?: unknown;
  description?: unknown;
  descriptionRaw?: unknown;
  status?: unknown;
}

const BASE = 'https://api.pluggy.ai';

const deny = (message: string, status = 400): AppError =>
  new AppError(status, status === 403 ? 'FORBIDDEN' : 'BANK_INTEGRATION_ERROR', message);

const validBank = (code: unknown): boolean => /^[A-Za-z0-9_-]{1,40}$/.test(String(code || ''));
const validId = (id: unknown): boolean => /^[A-Za-z0-9_-]{3,100}$/.test(String(id || ''));
const clean = (text: unknown, max = 120): string =>
  String(text || '')
    .trim()
    .slice(0, max);

export function bankIntegrationKey(raw = process.env.BANK_INTEGRATION_ENCRYPTION_KEY): Buffer {
  if (!raw)
    throw deny('Configure BANK_INTEGRATION_ENCRYPTION_KEY no servidor antes de salvar credenciais.', 503);
  const value = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (value.length !== 32) {
    throw deny(
      'BANK_INTEGRATION_ENCRYPTION_KEY deve conter 32 bytes em Base64 ou 64 caracteres hexadecimais.',
      503,
    );
  }
  return value;
}

export function encryptCredentials(data: unknown, key: Buffer = bankIntegrationKey()): EncryptedCredentials {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export function decryptCredentials(
  record: EncryptedCredentials | null | undefined,
  key: Buffer = bankIntegrationKey(),
): unknown {
  if (!record || record.v !== 1) throw deny('Credenciais não configuradas.', 409);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString(
      'utf8',
    ),
  ) as unknown;
}

export function centsFromProvider(amount: unknown): string {
  const text = String(amount);
  if (!/^-?\d{1,13}(?:\.\d{1,4})?$/.test(text)) throw deny('Valor bancário externo inválido.', 422);
  const negative = text.startsWith('-');
  const [units = '0', fraction = ''] = text.replace('-', '').split('.');
  const padded = fraction.padEnd(4, '0');
  let total = BigInt(units) * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) total += 1n;
  return (negative ? -total : total).toString();
}

export function normalizeProviderTransaction(
  row: ProviderTransaction,
  bankCode: string,
  identity: Identity,
  accountId: string,
) {
  if (!validId(row.id)) throw deny('Transação bancária sem identificador válido.', 422);
  const date = String(row.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))
    throw deny('Transação bancária sem data válida.', 422);
  const amountCents = centsFromProvider(row.amount);
  const id =
    'P' +
    createHash('sha256')
      .update('pluggy|' + bankCode + '|' + accountId + '|' + String(row.id))
      .digest('hex');
  return {
    id,
    fitid: clean(row.id, 100),
    description: clean(row.description || row.descriptionRaw || 'Movimentação bancária', 240),
    date,
    amountCents,
    bankCode,
    source: 'pluggy',
    providerAccountId: accountId,
    importedBy: identity.erpUser,
    uid: identity.uid,
    importedAt: Date.now(),
  };
}

const safeStatus = (config: IntegrationConfig | null | undefined) => ({
  provider: 'pluggy',
  connected: Boolean(config?.itemId),
  configured: Boolean(config?.secret),
  itemId: config?.itemId || '',
  accountId: config?.accountId || '',
  lastSyncAt: config?.lastSyncAt || null,
  lastSyncCount: config?.lastSyncCount || 0,
  hasMore: Boolean(config?.syncCursor),
  updatedAt: config?.updatedAt || null,
});

interface PluggyOptions {
  apiKey?: string;
  method?: string;
  body?: unknown;
  fetcher?: Fetcher;
}

async function pluggy(
  path: string,
  { apiKey, method = 'GET', body, fetcher = globalThis.fetch }: PluggyOptions = {},
): Promise<Row> {
  const url = new URL(path, BASE);
  if (url.origin !== BASE) throw deny('Endereço de integração inválido');
  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method,
      signal: AbortSignal.timeout(12000),
      headers: {
        ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw deny('Banco/Open Finance indisponível no momento.', 502);
  }
  let parsed: Row = {};
  try {
    parsed = (await response.json()) as Row;
  } catch {
    parsed = {};
  }
  if (!response.ok) {
    throw deny(
      response.status === 401
        ? 'Credenciais Pluggy inválidas.'
        : 'Falha na comunicação com o provedor bancário (' + response.status + ').',
      response.status === 401 ? 401 : 502,
    );
  }
  return parsed;
}

const keyCache = new Map<string, { apiKey: string; fingerprint: string; expire: number }>();

async function providerKey(bankCode: string, secret: ProviderSecret, fetcher: Fetcher): Promise<string> {
  const fingerprint = createHash('sha256')
    .update(secret.clientId + '|' + secret.clientSecret)
    .digest('hex');
  const entry = keyCache.get(bankCode);
  if (entry?.fingerprint === fingerprint && entry.expire > Date.now()) return entry.apiKey;
  const auth = await pluggy('/auth', { method: 'POST', body: secret, fetcher });
  if (!auth.apiKey) throw deny('Provedor não retornou uma chave válida.', 502);
  const apiKey = String(auth.apiKey);
  keyCache.set(bankCode, { apiKey, fingerprint, expire: Date.now() + 100 * 60 * 1000 });
  return apiKey;
}

const rows = (value: unknown): Row[] =>
  Object.values(value && typeof value === 'object' ? (value as Row) : {}).filter(
    (item): item is Row => Boolean(item) && typeof item === 'object',
  );

async function accountExists(db: Database, code: string): Promise<boolean> {
  return rows((await db.ref('erp/bancos').get()).val()).some((bank) => String(bank.cod) === code);
}

async function verifyAccount(apiKey: string, itemId: string, accountId: string, fetcher: Fetcher) {
  const list = await pluggy('/accounts?itemId=' + encodeURIComponent(itemId), { apiKey, fetcher });
  const accounts = Array.isArray(list.results) ? (list.results as Row[]) : [];
  if (accountId && !accounts.some((account) => String(account.id) === accountId)) {
    throw deny('Conta externa não pertence à conexão bancária informada.', 422);
  }
  return accounts.map((account) => ({
    id: String(account.id),
    name: clean(account.name || account.number || 'Conta'),
    type: clean(account.type, 32),
    numberEnd: String(account.number || '').slice(-4),
  }));
}

export interface IntegrationInput {
  bankCode?: unknown;
  action?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
  itemId?: unknown;
  accountId?: unknown;
}

export async function handleBankIntegration(
  identity: Identity,
  input: IntegrationInput,
  { db, fetcher = globalThis.fetch }: { db?: Database; fetcher?: Fetcher } = {},
) {
  if (!identity.erpAccess || identity.canBanking !== true) throw deny('Acesso bancário não autorizado.', 403);
  const code = String(input.bankCode || '');
  if (!validBank(code)) throw deny('Conta do ERP inválida.');
  const database = db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  if (!(await accountExists(database, code))) throw deny('Conta do ERP não encontrada.', 404);
  const action = String(input.action || 'status');
  const admin = identity.admin === true;
  const ref = database.ref('erpBankIntegrationPrivate/' + code);
  const config = ((await ref.get()).val() ?? {}) as IntegrationConfig;
  if (action === 'status') return { config: safeStatus(config), canConfigure: admin };
  if (!admin)
    throw deny('Apenas a administradora pode configurar ou sincronizar uma integração bancária.', 403);
  const touched = () => ({ updatedAt: Date.now(), updatedBy: identity.erpUser });
  if (action === 'save') {
    const clientId = clean(input.clientId, 200);
    const clientSecret = clean(input.clientSecret, 300);
    if (!clientId || !clientSecret) throw deny('Informe Client ID e Client Secret do provedor.');
    const encrypted = encryptCredentials({ clientId, clientSecret });
    await ref.update({
      provider: 'pluggy',
      secret: encrypted,
      itemId: null,
      accountId: null,
      syncCursor: null,
      ...touched(),
    });
    keyCache.delete(code);
    return {
      config: safeStatus({ ...config, secret: encrypted, itemId: '', accountId: '' }),
      message: 'Credenciais protegidas e salvas.',
    };
  }
  if (action === 'disconnect') {
    await ref.update({ itemId: null, accountId: null, syncCursor: null, ...touched() });
    return {
      config: safeStatus({ ...config, itemId: '', accountId: '' }),
      message: 'Vínculo com banco desconectado. Histórico existente foi preservado.',
    };
  }
  if (!config.secret) throw deny('Configure as credenciais antes de conectar.', 409);
  const secret = decryptCredentials(config.secret) as ProviderSecret;
  const apiKey = await providerKey(code, secret, fetcher);
  if (action === 'test') return { success: true, message: 'Credenciais autenticadas no Pluggy.' };
  if (action === 'connect-token') {
    const payload = await pluggy('/connect_token', {
      apiKey,
      method: 'POST',
      fetcher,
      body: { options: { clientUserId: identity.uid, avoidDuplicates: true } },
    });
    if (!payload.accessToken) throw deny('Token de conexão indisponível.', 502);
    return { accessToken: payload.accessToken };
  }
  if (action === 'link') {
    const itemId = clean(input.itemId, 100);
    if (!validId(itemId)) throw deny('Conexão bancária inválida.');
    const accounts = await verifyAccount(apiKey, itemId, '', fetcher);
    if (!accounts.length) throw deny('Nenhuma conta disponível nessa conexão.', 422);
    await ref.update({ itemId, accountId: null, syncCursor: null, ...touched() });
    return { accounts, config: safeStatus({ ...config, itemId, accountId: '' }) };
  }
  if (action === 'accounts') {
    if (!validId(config.itemId)) throw deny('Conecte um banco primeiro.', 409);
    return {
      accounts: await verifyAccount(apiKey, String(config.itemId), '', fetcher),
      config: safeStatus(config),
    };
  }
  if (action === 'select-account') {
    const accountId = clean(input.accountId, 100);
    if (!validId(config.itemId) || !validId(accountId)) throw deny('Selecione uma conta bancária válida.');
    await verifyAccount(apiKey, String(config.itemId), accountId, fetcher);
    await ref.update({ accountId, syncCursor: null, ...touched() });
    return { config: safeStatus({ ...config, accountId }), message: 'Conta vinculada ao cadastro bancário.' };
  }
  if (action === 'sync') return synchronize(database, identity, code, config, apiKey, fetcher);
  throw deny('Operação de integração não suportada.');
}

async function synchronize(
  database: Database,
  identity: Identity,
  code: string,
  config: IntegrationConfig,
  apiKey: string,
  fetcher: Fetcher,
) {
  const ref = database.ref('erpBankIntegrationPrivate/' + code);
  if (!validId(config.itemId) || !validId(config.accountId))
    throw deny('Conecte uma conta antes de sincronizar.', 409);
  const accountId = String(config.accountId);
  await verifyAccount(apiKey, String(config.itemId), accountId, fetcher);
  let cursor = String(config.syncCursor || '');
  let created = 0;
  let duplicates = 0;
  let processed = 0;
  for (let page = 0; page < 3; page++) {
    const query = new URLSearchParams({ accountId });
    if (cursor) query.set('after', cursor);
    const data = await pluggy('/v2/transactions?' + query.toString(), { apiKey, fetcher });
    const transactions = Array.isArray(data.results) ? (data.results as ProviderTransaction[]) : [];
    if (transactions.length > 500) throw deny('Resposta bancária acima do limite esperado.', 502);
    for (let index = 0; index < transactions.length; index += 10) {
      const batch = transactions.slice(index, index + 10).filter((row) => row.status !== 'PENDING');
      const records = batch.map((row) => normalizeProviderTransaction(row, code, identity, accountId));
      const changes = await Promise.all(
        records.map((record) =>
          runTransaction(
            database.ref('erp/bankReconciliationImports/' + code + '/' + record.id),
            (previous) => (previous === null ? record : undefined),
          ),
        ),
      );
      created += changes.filter((result) => result.committed).length;
      duplicates += changes.filter((result) => !result.committed).length;
      processed += changes.length;
    }
    if (!data.next) {
      cursor = '';
      await ref.update({ syncCursor: null });
      break;
    }
    const next = new URL(String(data.next), BASE + '/v2/transactions');
    if (next.pathname !== '/v2/transactions') throw deny('Paginação externa inválida.', 502);
    const nextCursor = next.searchParams.get('after');
    if (!nextCursor || nextCursor === cursor) throw deny('Cursor de paginação inválido.', 502);
    cursor = nextCursor;
    await ref.update({ syncCursor: cursor });
  }
  await ref.update({
    lastSyncAt: Date.now(),
    lastSyncCount: created,
    updatedAt: Date.now(),
    updatedBy: identity.erpUser,
  });
  await database.ref('erpBankIntegrationAudit/' + code).push({
    action: 'sync',
    created,
    duplicates,
    processed,
    actor: identity.erpUser,
    uid: identity.uid,
    at: Date.now(),
  });
  return {
    created,
    duplicates,
    processed,
    hasMore: Boolean(cursor),
    message:
      `${created} movimentação(ões) nova(s) importada(s). ${duplicates} duplicada(s) ignorada(s).` +
      (cursor ? ' Há mais páginas; clique em Buscar movimentações novamente.' : ''),
  };
}
