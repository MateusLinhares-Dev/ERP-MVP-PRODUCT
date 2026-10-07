import {
  logResponseError,
  startRequestLog,
} from '../observability/logger.js';

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
  }
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
  error,
) {
  applyApiSecurityHeaders(res);

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
