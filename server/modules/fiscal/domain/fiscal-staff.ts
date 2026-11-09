import { fail } from '../../../shared/errors/app-error.js';

export interface FiscalStaffMember {
  mat: string;
  nome: string;
  sal: number;
}

interface RawStaff {
  mat?: unknown;
  nome?: unknown;
  sal?: unknown;
}

export function fiscalStaffPublicView(raw: unknown): FiscalStaffMember[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : Object.values(raw && typeof raw === 'object' ? raw : {});
  if (items.length > 5000)
    fail(413, 'STAFF_TOO_LARGE', 'Cadastro de funcionários excede o limite de consulta.');
  return items
    .filter((item): item is RawStaff => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const salary = Number(item.sal);
      return {
        mat: String(item.mat || '').slice(0, 40),
        nome: String(item.nome || '').slice(0, 150),
        sal: Number.isFinite(salary) && salary >= 0 && salary < 1e9 ? salary : 0,
      };
    })
    .filter((member) => member.mat && member.nome)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
