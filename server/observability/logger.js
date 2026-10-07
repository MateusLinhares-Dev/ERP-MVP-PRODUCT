import { randomUUID } from 'node:crypto';

const SERVICE = 'manuela-metais-erp';

function environmentName() {
  return (
    process.env.VERCEL_ENV ||
    process.env.APP_ENV ||
    process.env.NODE_ENV ||
    'local'
  );
}

function requestPath(req) {
  try {
    return new URL(
      String(req?.url || '/'),
      'http://localhost',
    ).pathname;
  } catch {
    return String(req?.url || '/').split('?')[0];
  }
}

function normalize(value, max = 500) {
  if (value == null) return undefined;

  const text = String(value);

  if (text.length <= max) return text;

  return `${text.slice(0, max)}...`;
}

function logLine(level, data) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    service: SERVICE,
    environment: environmentName(),
    ...data,
  };

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

function levelFromStatus(status) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export function startRequestLog(req, res) {
  if (req.__requestLog) {
    return req.__requestLog;
  }

  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  const context = {
    requestId,
    method: String(req.method || ''),
    path: requestPath(req),
    actor: null,
    vercelRequestId: normalize(
      req.headers?.['x-vercel-id'],
      200,
    ),
    region:
      process.env.VERCEL_REGION ||
      undefined,
    commit:
      process.env.VERCEL_GIT_COMMIT_SHA
        ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)
        : undefined,
  };

  req.__requestLog = context;
  res.__requestLog = context;

  res.setHeader(
    'X-Request-Id',
    requestId,
  );

  logLine('info', {
    event: 'http.request.start',
    requestId,
    method: context.method,
    path: context.path,
    vercelRequestId: context.vercelRequestId,
    region: context.region,
    commit: context.commit,
  });

  const finish = () => {
    const elapsed =
      process.hrtime.bigint() -
      startedAt;

    const durationMs =
      Number(elapsed) / 1_000_000;

    const status =
      Number(res.statusCode || 200);

    logLine(
      levelFromStatus(status),
      {
        event: 'http.request.finish',
        requestId,
        method: context.method,
        path: context.path,
        status,
        durationMs:
          Number(durationMs.toFixed(2)),
        actor:
          context.actor ||
          undefined,
        vercelRequestId:
          context.vercelRequestId,
        region:
          context.region,
        commit:
          context.commit,
      },
    );
  };

  if (typeof res.once === 'function') {
    res.once('finish', finish);
  }

  return context;
}

export function setRequestActor(
  req,
  actor,
) {
  const context =
    req?.__requestLog;

  if (!context) return;

  const value =
    typeof actor === 'string'
      ? actor
      : actor?.erpUser;

  if (!value) return;

  context.actor =
    normalize(value, 120);
}

export function logRequestEvent(
  req,
  level,
  event,
  fields = {},
) {
  const context =
    req?.__requestLog;

  logLine(level, {
    event,
    requestId:
      context?.requestId,
    method:
      context?.method,
    path:
      context?.path,
    actor:
      context?.actor ||
      undefined,
    ...fields,
  });
}

export function logResponseError(
  res,
  error,
) {
  const context =
    res?.__requestLog;

  const status =
    Number(error?.status || 500);

  logLine(
    levelFromStatus(status),
    {
      event: 'http.request.error',
      requestId:
        context?.requestId,
      method:
        context?.method,
      path:
        context?.path,
      actor:
        context?.actor ||
        undefined,
      status,
      errorCode:
        normalize(
          error?.code ||
          'INTERNAL_ERROR',
          100,
        ),
      errorName:
        normalize(
          error?.name,
          100,
        ),
      errorMessage:
        normalize(
          error?.message,
          500,
        ),
      stack:
        status >= 500
          ? normalize(
              error?.stack,
              3000,
            )
          : undefined,
    },
  );
}