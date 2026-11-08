// Transações e travas (leases) confiáveis no Firebase Realtime Database.
//
// Dois comportamentos do SDK causavam as falhas "o primeiro salva, o segundo dá
// erro" em produção:
//
// 1. A função da transação é chamada primeiro com o CACHE LOCAL. Sem listener
//    ativo o cache está vazio e ela recebe null. Se a função devolve undefined
//    nessa primeira chamada, o SDK ABORTA sem consultar o servidor
//    (committed:false). A liberação `cur => cur?.owner===owner ? null : undefined`
//    nunca chegava ao servidor e toda trava ficava presa até expirar (90-120 s).
//
// 2. Se o WebSocket cai com a transação em voo, o SDK rejeita com
//    Error('disconnect'); uma gravação concorrente no mesmo caminho rejeita com
//    Error('set'). Sem tratamento isso virava HTTP 500 e a trava ficava presa.
//
// runTransaction mantém um listener 'value' ativo durante a transação (o cache
// passa a refletir o servidor antes da primeira chamada) e repete a operação
// em erros transitórios. As travas são reentrantes para o MESMO dono, de modo
// que a repetição após uma queda de conexão não bloqueia a própria operação.

const TRANSIENT_TRANSACTION_ERRORS = new Set(['disconnect', 'set', 'maxretry']);

export function isTransientFirebaseError(error) {
  const message = String(error?.message || error || '').trim().toLowerCase();
  if (TRANSIENT_TRANSACTION_ERRORS.has(message)) return true;
  const code = String(error?.code || '').toLowerCase();
  return code === 'unavailable' || code === 'network-error' || code === 'app/network-error'
    || /client is offline|network error|socket hang up|econnreset|etimedout/.test(message);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Aguarda o primeiro evento 'value' de um listener. Enquanto ele estiver ativo
// o SDK mantém o valor do servidor em cache e a transação parte do dado real.
function primeCache(ref, timeoutMs) {
  if (!ref || typeof ref.on !== 'function' || typeof ref.off !== 'function') {
    return Promise.resolve(() => {});
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const detach = () => { try { ref.off('value', onValue); } catch { /* listener já removido */ } };
    function onValue() {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(detach);
    }
    function onCancel(error) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      detach();
      reject(error || new Error('Leitura cancelada pelo Firebase.'));
    }
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      detach();
      const error = new Error('Tempo esgotado ao consultar o Firebase.');
      error.code = 'unavailable';
      reject(error);
    }, timeoutMs);
    if (typeof timer?.unref === 'function') timer.unref();
    ref.on('value', onValue, onCancel);
  });
}

/**
 * Executa ref.transaction com cache aquecido e repetição em falhas transitórias.
 * A função de atualização pode ser chamada várias vezes; ela deve ser pura.
 */
export async function runTransaction(ref, update, { attempts = 4, primeTimeoutMs = 15000, sleep = wait } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let detach = null;
    try {
      detach = await primeCache(ref, primeTimeoutMs);
      return await ref.transaction(update, undefined, false);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientFirebaseError(error)) throw error;
      await sleep(Math.min(1500, 120 * attempt * attempt));
    } finally {
      if (detach) detach();
    }
  }
  throw lastError;
}

/**
 * Obtém uma trava com prazo. Reentrante para o mesmo dono: se a tentativa
 * anterior foi gravada mas a confirmação se perdeu, a repetição a renova.
 */
export async function acquireLease(ref, owner, { now = () => Date.now(), ttlMs = 120000, meta = {}, attempts } = {}) {
  if (!owner) throw new Error('Dono da trava ausente.');
  const result = await runTransaction(ref, (current) => {
    if (current && typeof current === 'object' && current.owner !== owner && Number(current.expiresAt) > now()) return undefined;
    return { ...meta, owner, expiresAt: now() + ttlMs };
  }, attempts ? { attempts } : undefined);
  return result?.committed === true;
}

/**
 * Libera uma trava SOMENTE se ela ainda pertencer ao dono informado.
 * Nunca lança: uma falha aqui não pode mascarar o erro original da operação.
 * Retorna true quando a trava não pertence mais a este dono.
 */
export async function releaseLease(ref, owner, { logger = console, label = 'rtdb.lease.release' } = {}) {
  if (!ref || !owner) return true;
  try {
    const result = await runTransaction(ref, (current) => {
      if (current == null) return null; // nada a liberar (inclusive cache frio)
      if (current.owner === owner) return null; // nossa trava: remove
      return undefined; // trava de outra operação: preserva
    });
    if (result?.committed === true) return true;
    const live = result?.snapshot?.val?.();
    return !live || live.owner !== owner;
  } catch (error) {
    try { logger?.error?.(label, { message: String(error?.message || error) }); } catch { /* sem log */ }
    return false;
  }
}

/** Libera várias travas na ordem inversa da aquisição. */
export async function releaseLeases(entries, owner, options) {
  const list = Array.isArray(entries) ? [...entries].reverse() : [];
  for (const entry of list) {
    const ref = entry?.ref || entry;
    await releaseLease(ref, owner, options);
  }
}
