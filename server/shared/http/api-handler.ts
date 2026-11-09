import '../config/load-local-env.js';
import type { Identity } from '../auth/identity.js';
import { AppError } from '../errors/app-error.js';
import { requireIdentity, requirementsFor, type AccessLevel } from './auth.js';
import {
  applyApiSecurityHeaders,
  assertJsonBody,
  assertSameOrigin,
  sendError,
  type ApiRequest,
  type ApiResponse,
} from './http.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteContext<TBody> {
  req: ApiRequest;
  res: ApiResponse;
  identity: Identity;
  body: TBody;
}

export interface PublicRouteContext<TBody> {
  req: ApiRequest;
  res: ApiResponse;
  body: TBody;
}

interface RouteBase {
  sameOrigin?: 'required' | 'optional';
  maxBodyBytes?: number;
}

export interface AuthenticatedRoute<TBody = Record<string, unknown>> extends RouteBase {
  access: AccessLevel;
  handle(context: RouteContext<TBody>): Promise<unknown> | unknown;
}

export interface PublicRoute<TBody = Record<string, unknown>> extends RouteBase {
  access: 'public';
  handle(context: PublicRouteContext<TBody>): Promise<unknown> | unknown;
}

export type Route<TBody = Record<string, unknown>> = AuthenticatedRoute<TBody> | PublicRoute<TBody>;

export type RouteTable = Partial<Record<HttpMethod, Route<never>>>;

export const RAW_RESPONSE = Symbol('raw-response');

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => Promise<void>;

function readBody(req: ApiRequest, method: HttpMethod, route: RouteBase): unknown {
  if (method === 'GET' || method === 'DELETE') return {};
  assertJsonBody(req, { maxBytes: route.maxBodyBytes ?? 32 * 1024 });
  return req.body;
}

export function defineApi(routes: RouteTable): ApiHandler {
  return async (req, res) => {
    try {
      applyApiSecurityHeaders(res, req);
      const method = String(req.method ?? 'GET').toUpperCase() as HttpMethod;
      const route = routes[method] as Route<unknown> | undefined;
      if (!route) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
      const defaultOrigin = method === 'GET' ? 'optional' : 'required';
      assertSameOrigin(req, { required: (route.sameOrigin ?? defaultOrigin) === 'required' });
      const body = readBody(req, method, route);
      const result =
        route.access === 'public'
          ? await route.handle({ req, res, body })
          : await route.handle({
              req,
              res,
              body,
              identity: await requireIdentity(req, requirementsFor(route.access)),
            });
      if (result !== RAW_RESPONSE) res.status(200).json(result ?? { ok: true });
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function queryParam(req: ApiRequest, name: string): string {
  const value = req.query?.[name];
  return String(Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
}
