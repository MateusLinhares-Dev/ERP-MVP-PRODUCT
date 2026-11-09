import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { fail } from '../../../shared/errors/app-error.js';
import { fiscalStaffPublicView } from '../domain/fiscal-staff.js';

export async function listFiscalStaff(db: Pick<Database, 'ref'>, identity: Identity) {
  if (identity.canPayroll !== true) fail(403, 'PAYROLL_REQUIRED', 'Acesso reservado à Folha de Pagamento.');
  return { staff: fiscalStaffPublicView((await db.ref('erp/funcEdit').get()).val()) };
}
