import {
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

const tracer =
  trace.getTracer(
    'manuela-metais-erp',
  );

function attributes(values = {}) {
  const result = {};

  for (
    const [key, value]
    of Object.entries(values)
  ) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[key] = value;
    }
  }

  return result;
}

export async function withSpan(
  name,
  attrs,
  operation,
) {
  return tracer.startActiveSpan(
    name,
    {
      attributes:
        attributes(attrs),
    },
    async (span) => {
      const startedAt =
        performance.now();

      try {
        const result =
          await operation(span);

        span.setAttribute(
          'app.duration_ms',
          Number(
            (
              performance.now() -
              startedAt
            ).toFixed(2),
          ),
        );

        span.setStatus({
          code:
            SpanStatusCode.OK,
        });

        return result;
      } catch (error) {
        span.recordException(error);

        span.setAttribute(
          'error.type',
          String(
            error?.code ||
            error?.name ||
            'Error',
          ),
        );

        span.setStatus({
          code:
            SpanStatusCode.ERROR,
          message:
            String(
              error?.message ||
              error,
            ),
        });

        throw error;
      } finally {
        span.end();
      }
    },
  );
}