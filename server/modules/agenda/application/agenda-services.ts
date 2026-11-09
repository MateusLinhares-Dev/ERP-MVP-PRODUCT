import type { Reference } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { fail } from '../../../shared/errors/app-error.js';
import { recordAuditSafely } from '../../audit/infrastructure/audit-repository.js';
import {
  agendaServiceCatalog,
  mutateAgendaServiceCatalog,
  normalizeAgendaServiceName,
  validateAgendaServiceId,
} from '../domain/service-catalog.js';

export const canUseDeliveryAgenda = (identity: Identity): boolean =>
  Boolean(identity.canDeliveryAgenda || identity.canCoordination || identity.admin);

function assertAccess(identity: Identity): void {
  if (!canUseDeliveryAgenda(identity)) fail(403, 'AGENDA_FORBIDDEN', 'Sem acesso à Agenda de Entregas.');
}

export async function listAgendaServices(catalog: Reference, identity: Identity) {
  assertAccess(identity);
  return { services: agendaServiceCatalog((await catalog.get()).val()) };
}

export async function changeAgendaServices(
  catalog: Reference,
  identity: Identity,
  body: Record<string, unknown>,
) {
  assertAccess(identity);
  const action = String(body.action || '');
  if (action !== 'add' && action !== 'delete') fail(400, 'AGENDA_INVALID_ACTION', 'Ação inválida.');
  const name = action === 'add' ? normalizeAgendaServiceName(body.name) : null;
  const id = action === 'delete' ? validateAgendaServiceId(body.id) : null;
  const result = await mutateAgendaServiceCatalog(catalog, {
    action,
    name,
    id,
    actor: String(identity.erpUser),
  });
  if (result.changed) {
    await recordAuditSafely({
      actorUid: identity.uid,
      actorLogin: identity.erpUser,
      action: action === 'add' ? 'agenda_service_created' : 'agenda_service_deleted',
      module: 'agenda_entregas',
      entityType: 'service',
      entityId: id || name,
    });
  }
  return { ok: true, changed: result.changed, services: result.items };
}
