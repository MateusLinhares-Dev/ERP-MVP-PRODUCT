export { queryAuditLog, type AuditLogQuery } from './application/audit-log.js';
export { recordClientTelemetry } from './application/client-telemetry.js';
export {
  AuditRepository,
  pseudonymizeIp,
  recordAuditSafely,
  type AuditEvent,
} from './infrastructure/audit-repository.js';
