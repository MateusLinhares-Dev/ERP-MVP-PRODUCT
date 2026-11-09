export interface SupplierOption {
  cod: string;
  nome: string;
}

interface SupplierRecord {
  cod?: unknown;
  nome?: unknown;
  id?: unknown;
  ativo?: unknown;
  excluido?: unknown;
  status?: unknown;
}

const INACTIVE_STATUS = new Set(['inativo', 'desativado', 'excluido', 'excluído']);

const text = (value: unknown, max = 120): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

export function supplierTombstones(raw: unknown): Set<string> {
  if (Array.isArray(raw)) return new Set(raw.filter((value) => value != null).map(String));
  if (!raw || typeof raw !== 'object') return new Set();
  return new Set(
    Object.entries(raw)
      .filter(([, value]) => value === true || value === 1 || value === 'true')
      .map(([key]) => key),
  );
}

export function supplierOptions(
  raw: unknown,
  deletedCodes: ReadonlySet<string>,
  deletedIds: ReadonlySet<string>,
): SupplierOption[] {
  const byCode = new Map<string, SupplierOption>();
  for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const supplier = value as SupplierRecord;
    const cod = text(supplier.cod);
    const nome = text(supplier.nome, 240);
    const id = text(supplier.id || key);
    const status = String(supplier.status ?? '')
      .trim()
      .toLocaleLowerCase('pt-BR');
    const removed =
      deletedCodes.has(cod) ||
      deletedCodes.has(id) ||
      deletedIds.has(id) ||
      deletedIds.has(cod) ||
      deletedIds.has(key);
    if (
      !cod ||
      !nome ||
      supplier.ativo === false ||
      supplier.excluido === true ||
      INACTIVE_STATUS.has(status) ||
      removed
    ) {
      continue;
    }
    if (!byCode.has(cod)) byCode.set(cod, { cod, nome });
  }
  return [...byCode.values()].sort(
    (a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }) || a.cod.localeCompare(b.cod, 'pt-BR'),
  );
}
