import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { hasControlChars, hasMarkup } from '../../../shared/domain/text.js';
import { fail } from '../../../shared/errors/app-error.js';

const COMPANY_FIELDS = [
  'nome',
  'razaoSocial',
  'cnpj',
  'ie',
  'endereco',
  'enderecoCurto',
  'financeiro',
  'escritorio',
  'compras',
  'email',
  'responsavel',
] as const;
const BRAND_FIELDS = ['logoPrefix', 'logoAccent', 'tagline', 'title'] as const;

export interface BrandingInput {
  company?: unknown;
  branding?: unknown;
}

function clean<K extends string>(raw: unknown, keys: readonly K[]): Record<K, string> {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = source[key];
    if (
      typeof value !== 'string' ||
      value.length > 256 ||
      hasMarkup(value) ||
      hasControlChars(value, { allowDelete: true })
    ) {
      fail(400, 'INVALID_FIELD', 'Campo inválido: ' + key);
    }
    out[key] = value.trim();
  }
  return out;
}

function companyKey(company: { nome?: string; razaoSocial?: string }): string {
  return String(company.nome || company.razaoSocial || '')
    .trim()
    .slice(0, 120);
}

export function canEditBranding(identity: Identity): boolean {
  return identity.erpUser === 'elaine' || identity.engineer === true;
}

export async function updateBranding(
  db: Database,
  identity: Identity,
  input: BrandingInput,
): Promise<{ ok: true }> {
  if (!canEditBranding(identity))
    fail(403, 'BRANDING_FORBIDDEN', 'Somente Elaine pode alterar os dados institucionais.');
  const companyInput = clean(input.company, COMPANY_FIELDS);
  const brandingInput = clean(input.branding, BRAND_FIELDS);
  if (!companyInput.nome || !companyInput.razaoSocial) {
    fail(400, 'COMPANY_NAME_REQUIRED', 'Informe o nome fantasia e a razão social.');
  }
  const cfg = ((await db.ref('erp/config').get()).val() ?? {}) as Record<string, unknown>;
  const companies =
    cfg.companies && typeof cfg.companies === 'object'
      ? (cfg.companies as Record<string, Record<string, unknown>>)
      : {};
  const primary = String(
    cfg.primaryCompanyKey || Object.keys(companies)[0] || companyKey(companyInput),
  ).trim();
  if (!primary) fail(409, 'PRIMARY_COMPANY_MISSING', 'Não foi possível definir a empresa principal.');
  const branding = { ...((cfg.branding as Record<string, unknown> | undefined) ?? {}), ...brandingInput };
  await db.ref('erp/config').update({
    primaryCompanyKey: primary,
    [`companies/${primary}`]: { ...(companies[primary] ?? {}), ...companyInput },
    branding,
  });
  await db.ref('erpAudit').push({
    action: 'company-branding-updated',
    module: 'config',
    actorLogin: identity.erpUser,
    at: new Date().toISOString(),
  });
  return { ok: true };
}
