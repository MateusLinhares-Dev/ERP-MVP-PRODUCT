import type { SessionUser } from '../auth/firebase-session.js';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, code: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ApiClientOptions {
  currentUser(): SessionUser | null;
  onSignedOut(): void;
  messages: Readonly<Record<string, string>>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  download(path: string, failureMessage: string): Promise<Blob>;
}

interface ErrorBody {
  code?: unknown;
  message?: unknown;
  retryAfterSeconds?: unknown;
}

const SESSION_EXPIRED_REDIRECT_MS = 2500;
const SERVER_ERROR = 'O servidor não respondeu direito. Tente de novo em alguns segundos.';
const GENERIC_ERROR = 'Não foi possível concluir.';
const NETWORK_ERROR = 'NETWORK_ERROR';

export function createApiClient(options: ApiClientOptions): ApiClient {
  async function token(forceRefresh = false): Promise<string> {
    const user = options.currentUser();
    if (!user) {
      options.onSignedOut();
      throw new ApiError('Sessão encerrada.', 'NO_SESSION', 0);
    }
    return user.getIdToken(forceRefresh);
  }

  async function send(path: string, init: RequestInit, forceRefresh: boolean): Promise<Response> {
    const authorization = `Bearer ${await token(forceRefresh)}`;
    try {
      return await fetch(path, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: authorization },
      });
    } catch {
      throw new ApiError(options.messages[NETWORK_ERROR] ?? GENERIC_ERROR, NETWORK_ERROR, 0);
    }
  }

  function failure(response: Response, data: ErrorBody): ApiError {
    const code = typeof data.code === 'string' && data.code ? data.code : `HTTP_${response.status}`;
    const serverMessage = typeof data.message === 'string' && data.message ? data.message : GENERIC_ERROR;
    const message = options.messages[code] ?? (response.status >= 500 ? SERVER_ERROR : serverMessage);
    if (code === 'SESSION_EXPIRED') window.setTimeout(options.onSignedOut, SESSION_EXPIRED_REDIRECT_MS);
    return new ApiError(message, code, response.status, Number(data.retryAfterSeconds) || null);
  }

  async function request<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
    const init: RequestInit = {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    let response = await send(path, init, false);
    if (response.status === 401) response = await send(path, init, true);
    const data = (await response.json().catch(() => ({}))) as ErrorBody;
    if (!response.ok) throw failure(response, data);
    return data as T;
  }

  async function download(path: string, failureMessage: string): Promise<Blob> {
    const response = await send(path, { method: 'GET' }, false);
    if (!response.ok) throw new ApiError(failureMessage, `HTTP_${response.status}`, response.status);
    return response.blob();
  }

  return { request, download };
}
