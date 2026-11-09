import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';
import { asErrorLike, errorMessage } from '../errors/app-error.js';

const tracer = trace.getTracer('manuela-metais-erp');

function attributes(values: Record<string, unknown> = {}): Attributes {
  const result: Attributes = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      result[key] = value;
  }
  return result;
}

export async function withSpan<T>(
  name: string,
  attrs: Record<string, unknown>,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attributes(attrs) }, async (span) => {
    const startedAt = performance.now();
    try {
      const result = await operation(span);
      span.setAttribute('app.duration_ms', Number((performance.now() - startedAt).toFixed(2)));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const details = asErrorLike(error);
      span.recordException(error instanceof Error ? error : String(error));
      span.setAttribute('error.type', String(details.code ?? details.name ?? 'Error'));
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(error) });
      throw error;
    } finally {
      span.end();
    }
  });
}
