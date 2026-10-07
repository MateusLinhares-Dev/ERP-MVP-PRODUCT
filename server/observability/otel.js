import {
  registerOTel,
} from '@vercel/otel';

let initialized = false;

export function ensureOpenTelemetry() {
  if (initialized) return;

  registerOTel({
    serviceName:
      'manuela-metais-erp',
  });

  initialized = true;
}