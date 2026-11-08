import {
  logResponseError,
  startRequestLog,
} from '../observability/logger.js';
import { trackFirebaseRequest } from '../infrastructure/firebase-session.js';
import { isTransientFirebaseError } from '../infrastructure/rtdb-transaction.js';

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0] || 'unknown';
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
}

export function applyApiSecurityHeaders(res, req) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

  if (req) {
    startRequestLog(req, res);
    // Uma conexão RTDB nova por rajada de requisições (ver firebase-admin.js).
    trackFirebaseRequest(res);
  }
}

// Erros do SDK do Firebase não carregam status HTTP. Sem esta classificação
// uma queda momentânea de conexão aparecia como "Erro interno do servidor".
function classifyError(error) {
  if (error?.status) return error;
  if (isTransientFirebaseError(error)) {
    const mapped = new Error('A conexão com o banco de dados oscilou e a operação não foi confirmada. Nenhuma alteração foi aplicada; tente novamente em alguns segundos.');
    mapped.status = 503;
    mapped.code = 'DATABASE_UNAVAILABLE';
    mapped.retryAfterSeconds = 3;
    mapped.cause = error;
    mapped.stack = error?.stack;
    return mapped;
  }
  const firebaseCode = String(error?.code || error?.errorInfo?.code || '');
  if (/^auth\/(id-token-expired|id-token-revoked|argument-error|invalid-id-token|user-disabled|user-not-found)$/.test(firebaseCode)) {
    const mapped = new Error('Sua sessão expirou. Entre novamente no sistema.');
    mapped.status = 401;
    mapped.code = 'SESSION_EXPIRED';
    mapped.cause = error;
    return mapped;
  }
  if (/permission[_-]denied/i.test(firebaseCode) || /permission[_ ]denied/i.test(String(error?.message || ''))) {
    const mapped = new Error('Permissão negada pelo banco de dados para esta operação.');
    mapped.status = 403;
    mapped.code = 'PERMISSION_DENIED';
    mapped.cause = error;
    return mapped;
  }
  return error;
}

export function assertMethod(req, method) {
  if (req.method !== method) { const e=new Error('Método não permitido.');e.status=405;e.code='METHOD_NOT_ALLOWED';throw e; }
}

export function assertJsonBody(req, { maxBytes = 32 * 1024 } = {}) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    const e = new Error('Content-Type inválido.'); e.status = 415; e.code = 'UNSUPPORTED_MEDIA_TYPE'; throw e;
  }
  const length = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(length) && length > maxBytes) {
    const e = new Error('Corpo da requisição excede o limite permitido.'); e.status = 413; e.code = 'PAYLOAD_TOO_LARGE'; throw e;
  }
  if (req.body == null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    const e = new Error('JSON inválido.'); e.status = 400; e.code = 'INVALID_JSON'; throw e;
  }
}

export function sendError(
  res,
  rawError,
) {
  applyApiSecurityHeaders(res);

  const error = classifyError(rawError);

  if (error?.retryAfterSeconds && typeof res.setHeader === 'function') {
    try { res.setHeader('Retry-After', String(error.retryAfterSeconds)); } catch { /* headers já enviados */ }
  }

  const status =
    Number(
      error?.status || 500,
    );

  logResponseError(
    res,
    error,
  );

  res.status(status).json({
    code:
      error?.code ||
      (
        status >= 500
          ? 'INTERNAL_ERROR'
          : 'REQUEST_ERROR'
      ),

    message:
      status >= 500
        ? 'Erro interno do servidor.'
        : (
            error?.message ||
            'Erro na requisição.'
          ),

    ...(
      error?.retryAfterSeconds
        ? {
            retryAfterSeconds:
              error.retryAfterSeconds,
          }
        : {}
    ),
  });
}

export function assertSameOrigin(req, { required = false } = {}) {
  const origin = req.headers.origin;
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    const e=new Error('Origem não permitida.');e.status=403;e.code='BAD_ORIGIN';throw e;
  }
  if (!origin) {
    if (required) { const e=new Error('Origem ausente.');e.status=403;e.code='BAD_ORIGIN';throw e; }
    return;
  }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  try {
    if (!host || new URL(origin).host !== host) { const e=new Error('Origem não permitida.');e.status=403;e.code='BAD_ORIGIN';throw e; }
  } catch (error) {
    if (error?.status) throw error;
    const e=new Error('Origem inválida.');e.status=403;e.code='BAD_ORIGIN';throw e;
  }
}
