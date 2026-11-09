import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { hasControlChars, hasMarkup } from '../../../shared/domain/text.js';
import { fail } from '../../../shared/errors/app-error.js';
import {
  companyDirectoryResponse,
  companyKey,
  getCompanyDirectory,
  transactCompanyDirectory,
  type CompanyDirectoryResponse,
} from '../domain/company-directory.js';

export interface CompanyDirectoryChange {
  name?: unknown;
  action?: unknown;
  expectedRevision?: unknown;
}

export async function readCompanyDirectory(db: Database): Promise<CompanyDirectoryResponse> {
  return companyDirectoryResponse(await getCompanyDirectory(db));
}

export async function changeCompanyDirectoryEntry(
  db: Database,
  actor: Identity,
  input: CompanyDirectoryChange,
): Promise<CompanyDirectoryResponse> {
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  const action = String(input.action || 'create');
  const expectedRevision = input.expectedRevision;
  if (
    !name ||
    name.length > 80 ||
    hasMarkup(name) ||
    hasControlChars(name, { allowDelete: true }) ||
    !['create', 'delete'].includes(action) ||
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    fail(400, 'INVALID_COMPANY', 'Informe nome, operação e versão válidos.');
  }
  const ref = db.ref('erp/companyDirectory');
  const result = await transactCompanyDirectory(db, ref, action, name, expectedRevision);
  if (!result.committed) {
    const latest = await getCompanyDirectory(db);
    const changed = latest.revision !== expectedRevision;
    const registered = latest.companies.some((item) => companyKey(item) === companyKey(name));
    const message = changed
      ? 'O cadastro foi atualizado em outra sessão. A lista será recarregada.'
      : action === 'create' && registered
        ? 'Esta empresa já está cadastrada.'
        : action === 'delete' && !registered
          ? 'Esta empresa já não está no cadastro.'
          : 'A operação não foi aceita pelo cadastro de empresas.';
    fail(409, changed ? 'COMPANY_REVISION_CONFLICT' : 'COMPANY_OPERATION_CONFLICT', message);
  }
  const state = companyDirectoryResponse(result.snapshot?.val());
  try {
    await db.ref('erpAudit').push({
      action: 'company-' + action,
      module: 'companyDirectory',
      actorLogin: actor.erpUser,
      company: name,
      revision: state.revision,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Falha ao registrar auditoria de empresa', error);
  }
  return state;
}
