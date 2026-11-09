import { randomUUID } from 'node:crypto';
import { asErrorLike } from '../errors/app-error.js';
import { ensureOpenTelemetry } from './otel.js';

const SERVICE = 'manuela-metais-erp';

type LogLevel = 'info' | 'warn' | 'error';

export interface LoggableRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface LoggableResponse {
  statusCode?: number;
  setHeader(name: string, value: string): unknown;
  once?(event: 'finish', listener: () => void): unknown;
}

interface RequestLogContext {
  requestId: string;
  method: string;
  path: string;
  actor: string | null;
  vercelRequestId: string | undefined;
  region: string | undefined;
  commit: string | undefined;
}

const contexts = new WeakMap<object, RequestLogContext>();

function environmentName(): string {
  return process.env.VERCEL_ENV || process.env.APP_ENV || process.env.NODE_ENV || 'local';
}

function requestPath(req: LoggableRequest): string {
  try {
    return new URL(String(req.url ?? '/'), 'http://localhost').pathname;
  } catch {
    return String(req.url ?? '/').split('?')[0] ?? '/';
  }
}

function normalize(value: unknown, max = 500): string | undefined {
  if (value == null) return undefined;
  const text = String(value);
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function logLine(level: LogLevel, data: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: SERVICE,
    environment: environmentName(),
    ...data,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function levelFromStatus(status: number): LogLevel {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export function startRequestLog(req: LoggableRequest, res: LoggableResponse): RequestLogContext {
  ensureOpenTelemetry();
  const existing = contexts.get(req);
  if (existing) return existing;
  const startedAt = process.hrtime.bigint();
  const context: RequestLogContext = {
    requestId: randomUUID(),
    method: String(req.method ?? ''),
    path: requestPath(req),
    actor: null,
    vercelRequestId: normalize(req.headers?.['x-vercel-id'], 200),
    region: process.env.VERCEL_REGION || undefined,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12) : undefined,
  };
  contexts.set(req, context);
  contexts.set(res, context);
  res.setHeader('X-Request-Id', context.requestId);
  logLine('info', {
    event: 'http.request.start',
    requestId: context.requestId,
    method: context.method,
    path: context.path,
    vercelRequestId: context.vercelRequestId,
    region: context.region,
    commit: context.commit,
  });
  res.once?.('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const status = Number(res.statusCode ?? 200);
    logLine(levelFromStatus(status), {
      event: 'http.request.finish',
      requestId: context.requestId,
      method: context.method,
      path: context.path,
      status,
      durationMs: Number(durationMs.toFixed(2)),
      actor: context.actor ?? undefined,
      vercelRequestId: context.vercelRequestId,
      region: context.region,
      commit: context.commit,
    });
  });
  return context;
}

export function setRequestActor(req: object, actor: string | { erpUser?: unknown } | null | undefined): void {
  const context = contexts.get(req);
  if (!context) return;
  const value = typeof actor === 'string' ? actor : actor?.erpUser;
  if (value) context.actor = normalize(value, 120) ?? null;
}

export function logRequestEvent(
  req: object,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const context = contexts.get(req);
  logLine(level, {
    event,
    requestId: context?.requestId,
    method: context?.method,
    path: context?.path,
    actor: context?.actor ?? undefined,
    ...fields,
  });
}

export function logResponseError(res: object, error: unknown): void {
  const context = contexts.get(res);
  const details = asErrorLike(error);
  const status = Number(details.status ?? 500);
  logLine(levelFromStatus(status), {
    event: 'http.request.error',
    requestId: context?.requestId,
    method: context?.method,
    path: context?.path,
    actor: context?.actor ?? undefined,
    status,
    errorCode: normalize(details.code ?? 'INTERNAL_ERROR', 100),
    errorName: normalize(details.name, 100),
    errorMessage: normalize(details.message, 500),
    stack: status >= 500 ? normalize(details.stack, 3000) : undefined,
  });
}
