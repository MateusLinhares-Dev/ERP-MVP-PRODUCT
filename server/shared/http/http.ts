import type { IncomingHttpHeaders } from 'node:http';
import { AppError, asErrorLike, type ErrorLike } from '../errors/app-error.js';
import { trackFirebaseRequest } from '../firebase/firebase-session.js';
import { isTransientFirebaseError } from '../firebase/rtdb-transaction.js';
import { logResponseError, startRequestLog } from '../observability/logger.js';

export interface ApiRequest {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export interface ApiResponse {
  statusCode?: number;
  setHeader(name: string, value: string): unknown;
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
  send(body: unknown): unknown;
  once?(event: 'finish' | 'close', listener: () => void): unknown;
}

const SESSION_ERROR =
  /^auth\/(id-token-expired|id-token-revoked|argument-error|invalid-id-token|user-disabled|user-not-found)$/;

export function clientIp(req: ApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0] || 'unknown';
  if (forwarded) return String(forwarded).split(',')[0]?.trim() || 'unknown';
  return String(req.headers['x-real-ip'] ?? req.socket?.remoteAddress ?? 'unknown');
}

export function applyApiSecurityHeaders(res: ApiResponse, req?: ApiRequest): void {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (req) {
    startRequestLog(req, res);
    trackFirebaseRequest(res);
  }
}

function classifyError(error: unknown): ErrorLike {
  const details = asErrorLike(error);
  if (details.status) return details;
  if (isTransientFirebaseError(error)) {
    const mapped = new AppError(
      503,
      'DATABASE_UNAVAILABLE',
      'A conexão com o banco de dados oscilou e a operação não foi confirmada. Nenhuma alteração foi aplicada; tente novamente em alguns segundos.',
      { retryAfterSeconds: 3, cause: error },
    );
    if (details.stack) mapped.stack = details.stack;
    return mapped;
  }
  const firebaseCode = String(details.code ?? details.errorInfo?.code ?? '');
  if (SESSION_ERROR.test(firebaseCode)) {
    return new AppError(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente no sistema.', {
      cause: error,
    });
  }
  if (
    /permission[_-]denied/i.test(firebaseCode) ||
    /permission[_ ]denied/i.test(String(details.message ?? ''))
  ) {
    return new AppError(
      403,
      'PERMISSION_DENIED',
      'Permissão negada pelo banco de dados para esta operação.',
      {
        cause: error,
      },
    );
  }
  return details;
}

export function assertMethod(req: ApiRequest, method: string): void {
  if (req.method !== method) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
}

export function assertJsonBody(req: ApiRequest, { maxBytes = 32 * 1024 } = {}): void {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type inválido.');
  }
  const length = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(length) && length > maxBytes) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição excede o limite permitido.');
  }
  if (req.body == null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new AppError(400, 'INVALID_JSON', 'JSON inválido.');
  }
}

export function assertSameOrigin(req: ApiRequest, { required = false } = {}): void {
  const origin = req.headers.origin;
  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') {
    throw new AppError(403, 'BAD_ORIGIN', 'Origem não permitida.');
  }
  if (!origin) {
    if (required) throw new AppError(403, 'BAD_ORIGIN', 'Origem ausente.');
    return;
  }
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    ?.trim();
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError(403, 'BAD_ORIGIN', 'Origem inválida.');
  }
  if (!host || originHost !== host) throw new AppError(403, 'BAD_ORIGIN', 'Origem não permitida.');
}

function attempt(action: () => unknown): void {
  try {
    action();
  } catch {
    return;
  }
}

export function sendError(res: ApiResponse, rawError: unknown): void {
  applyApiSecurityHeaders(res);
  const error = classifyError(rawError);
  if (error.retryAfterSeconds) attempt(() => res.setHeader('Retry-After', String(error.retryAfterSeconds)));
  const status = Number(error.status ?? 500);
  logResponseError(res, error);
  res.status(status).json({
    code: error.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
    message: status >= 500 ? 'Erro interno do servidor.' : error.message || 'Erro na requisição.',
    ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
  });
}
