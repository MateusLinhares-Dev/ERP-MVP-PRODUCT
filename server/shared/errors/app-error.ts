export interface AppErrorOptions {
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function fail(status: number, code: string, message: string, options?: AppErrorOptions): never {
  throw new AppError(status, code, message, options);
}

export interface ErrorLike {
  status?: number;
  code?: string;
  message?: string;
  name?: string;
  stack?: string;
  retryAfterSeconds?: number;
  errorInfo?: { code?: string };
}

export function asErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === 'object') return error as ErrorLike;
  return { message: String(error) };
}

export function errorMessage(error: unknown): string {
  return String(asErrorLike(error).message ?? error);
}
