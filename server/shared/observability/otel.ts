import { registerOTel } from '@vercel/otel';

let initialized = false;

export function ensureOpenTelemetry(): void {
  if (initialized) return;
  registerOTel({ serviceName: 'manuela-metais-erp' });
  initialized = true;
}
