// Contador leve de requisições HTTP ativas que podem usar o Firebase.
// Fica separado de firebase-admin.js para que endpoints sem banco (health,
// config) não precisem carregar o SDK apenas para registrar a requisição.
//
// Política (ver firebase-admin.js):
//   - a primeira requisição de cada rajada recicla o WebSocket do RTDB;
//   - quando não resta requisição ativa, a conexão é encerrada.

let activeRequests = 0;
let recycleOnNextUse = true;
let idleHandler = null;

export function setFirebaseIdleHandler(handler) {
  idleHandler = typeof handler === 'function' ? handler : null;
}

export function trackFirebaseRequest(res) {
  if (!res || res.__firebaseTracked) return;
  res.__firebaseTracked = true;
  activeRequests += 1;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0) {
      recycleOnNextUse = true;
      try { idleHandler?.(); } catch { /* conexão já encerrada */ }
    }
  };
  if (typeof res.once === 'function') {
    res.once('finish', done);
    res.once('close', done);
  }
}

/** Retorna true uma única vez por rajada: o chamador deve reciclar a conexão. */
export function consumeConnectionRecycle() {
  if (!recycleOnNextUse) return false;
  recycleOnNextUse = false;
  return true;
}

export function firebaseSessionState() {
  return { activeRequests, recycleOnNextUse };
}
