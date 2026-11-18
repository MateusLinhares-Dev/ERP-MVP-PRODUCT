import { toBRDate } from '../../../shared/domain/dates.js';
import { hasControlChars } from '../../../shared/domain/text.js';
import { chequeIdentity, normalizeChequeBank } from '../../advances/domain/advance-rules.js';
import { centsOf, isRow, type Problem, type Row } from './bank-ledger-rules.js';

export const FORM_STATUSES = ['A', 'C', 'X'] as const;
export const MAX_BATCH = 200;
export const MAX_IMPORT = 400;

export interface ChequeFields {
  b: string;
  n: string;
  c: string;
  v: number;
  d: string;
  venc: string;
  cd: string;
  s: (typeof FORM_STATUSES)[number];
}

const problem = (code: string, message: string): Problem => ({ code, message });

function textField(value: unknown, max: number): string | null {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > max || hasControlChars(text)) return null;
  return text;
}

function dateField(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return toBRDate(raw) || null;
}

export function cleanCheque(input: unknown): { fields: ChequeFields; problem: Problem | null } {
  const source = isRow(input) ? input : {};
  const empty: ChequeFields = { b: '', n: '', c: '', v: 0, d: '', venc: '', cd: '', s: 'A' };
  const b = textField(source.b, 80);
  if (!b) return { fields: empty, problem: problem('CHEQUE_BANK_REQUIRED', 'Informe o banco do cheque.') };
  const n = textField(source.n, 30);
  if (!n || /[.#$[\]/]/.test(n))
    return { fields: empty, problem: problem('CHEQUE_NUMBER_REQUIRED', 'Preencha o número do cheque.') };
  const c = textField(source.c, 160);
  if (c === null) return { fields: empty, problem: problem('INVALID_TEXT', 'O cliente/destino é inválido.') };
  const cents = centsOf(typeof source.v === 'number' ? source.v : Number.NaN, { allowZero: true });
  if (cents === null)
    return {
      fields: empty,
      problem: problem('INVALID_AMOUNT', 'Valor do cheque inválido. Use no máximo duas casas decimais.'),
    };
  const d = dateField(source.d);
  const venc = dateField(source.venc);
  const cd = dateField(source.cd);
  if (d === null || venc === null || cd === null)
    return { fields: empty, problem: problem('INVALID_DATE', 'Data inválida. Use dd/mm/aaaa.') };
  const s = String(source.s ?? 'A');
  if (!(FORM_STATUSES as readonly string[]).includes(s))
    return { fields: empty, problem: problem('INVALID_STATUS', 'Situação do cheque inválida.') };
  return { fields: { b, n, c, v: cents / 100, d, venc, cd, s: s as ChequeFields['s'] }, problem: null };
}

export function chequeSlug(bank: string, hint: unknown): string {
  const given = String(hint ?? '').trim();
  if (/^[A-Za-z0-9]{1,12}$/.test(given)) return given;
  return (
    bank
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 8)
      .toUpperCase() || 'XX'
  );
}

export function nextChequeId(taken: ReadonlySet<string>, slug: string, number: string): string {
  const base = 'CC' + slug + number.replace(/[^A-Za-z0-9]/g, '');
  let id = base;
  let k = 1;
  while (taken.has(id)) id = base + '_' + ++k;
  return id;
}

export function duplicateOf(
  cheques: readonly [string, Row][],
  bank: string,
  number: string,
  ignoreId = '',
): Row | null {
  const identity = chequeIdentity(bank, number);
  if (!identity) return null;
  const found = cheques.find(
    ([id, cheque]) => id !== ignoreId && chequeIdentity(cheque.b, cheque.n) === identity,
  );
  return found ? found[1] : null;
}

export function financialChange(existing: Row, fields: ChequeFields): boolean {
  const cents = (value: unknown) => Math.round((Number(value) || 0) * 100);
  return (
    normalizeChequeBank(existing.b) !== normalizeChequeBank(fields.b) ||
    String(existing.n ?? '').trim() !== fields.n ||
    cents(existing.v) !== cents(fields.v) ||
    String(existing.s || 'A') !== fields.s ||
    String(existing.cd ?? '') !== fields.cd
  );
}

const DESTINATION_FIELDS = ['clienteNome', 'clienteCod', 'fornecedorNome', 'fornecedorCod', 'dest'] as const;

const withoutDestination = (record: Row): Row =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !(DESTINATION_FIELDS as readonly string[]).includes(key)),
  );

export function applyDestination(record: Row, previous: Row | null, input: unknown): Row {
  const sameName =
    previous != null &&
    normalizeChequeBank(previous.c) === normalizeChequeBank(record.c) &&
    String(previous.c ?? '') !== '';
  let next: Row = sameName ? { ...record } : withoutDestination(record);
  const target = isRow(input) ? input : null;
  const kind = String(target?.tipo ?? '');
  const code = textField(target?.cod, 60) ?? '';
  const name = textField(target?.nome, 160) ?? '';
  if (target && name && normalizeChequeBank(name) === normalizeChequeBank(record.c)) {
    next = withoutDestination(next);
    if (kind === 'Cliente') Object.assign(next, { clienteNome: name, clienteCod: code });
    else if (kind.startsWith('Fornecedor'))
      Object.assign(next, { fornecedorNome: name, fornecedorCod: code, dest: String(record.c ?? '') });
  }
  return next;
}
