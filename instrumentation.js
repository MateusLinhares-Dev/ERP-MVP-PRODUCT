import {
  registerOTel,
} from '@vercel/otel';

registerOTel({
  serviceName:
    'manuela-metais-erp',
});