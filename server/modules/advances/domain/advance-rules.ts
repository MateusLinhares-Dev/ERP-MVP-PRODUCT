import { createHash } from 'node:crypto';
import type { Identity } from '../../../shared/auth/identity.js';
import { hasControlChars } from '../../../shared/domain/text.js';
import { AppError } from '../../../shared/errors/app-error.js';

export type Row = Record<string, unknown>;

export interface AdvanceRecord {
  cod?: string;
  data?: string;
  valor?: number;
  status?: string;
  ticket?: string;
  ticketOrigem?: string;
  forma?: string;
  bancoCod?: string;
  bancoNome?: string;
  empresa?: string;
  obs?: string;
  movBancoId?: string;
  chequeIds?: string[];
  chequeFingerprints?: Record<string, string>;
  valorCompensado?: number;
  valorAplicado?: number;
  adiantamentoOrigem?: string;
  origem?: string;
  [field: string]: unknown;
}

export interface ChequeRecord {
  id?: string;
  b?: string;
  n?: string;
  c?: string;
  emitente?: string;
  dest?: string;
  v?: number;
  d?: string;
  venc?: string;
  cd?: string;
  s?: string;
  dc?: boolean;
  origem?: string;
  advanceCode?: string;
  fornCod?: string;
  [field: string]: unknown;
}

export interface BankOption {
  cod: string;
  banco: string;
  empresa: string;
  tipo: string;
  titular: string;
}

export function failure(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}

export function requireFinance(identity: Identity | null | undefined): void {
  if (!identity || identity.erpAccess !== true || identity.canAdvances !== true) {
    failure(403, 'ADVANCES_REQUIRED', 'Sem permissão para Adiantamentos.');
  }
}

export function clean(value: unknown, max = 120): string {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

export function pathKey(value: unknown): string {
  const key = clean(value, 120);
  if (!key || /[.#$[\]/]/.test(key) || hasControlChars(key))
    failure(422, 'INVALID_KEY', 'Identificador inválido.');
  return key;
}

export function amount(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1000000000 ||
    Math.round(value * 100) / 100 !== value
  ) {
    failure(422, 'INVALID_AMOUNT', 'Informe um valor válido em centavos.');
  }
  return value;
}

export function isoDate(value: unknown): string {
  const date = clean(value, 10);
  const parsed = new Date(date + 'T12:00:00.000Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    failure(422, 'INVALID_DATE', 'Data inválida.');
  }
  return date;
}

export const toDisplayDate = (iso: string): string => iso.split('-').reverse().join('/');

export function chequeFingerprint(cheque: ChequeRecord): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        cheque.id,
        cheque.b,
        cheque.n,
        cheque.c,
        cheque.emitente,
        cheque.dest,
        cheque.v,
        cheque.d,
        cheque.venc,
        cheque.cd,
        cheque.s,
        cheque.dc,
        cheque.origem || '',
        cheque.advanceCode,
        cheque.fornCod,
      ]),
    )
    .digest('hex');
}

export function bankEntries(raw: unknown): BankOption[] {
  return Object.entries(raw && typeof raw === 'object' ? (raw as Row) : {})
    .filter(
      (entry): entry is [string, Row] =>
        Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1]),
    )
    .map(([key, bank]) => ({
      cod: clean(bank.cod || bank.codigo || bank.id || key),
      banco: clean(bank.banco || bank.nomeBanco || bank.nome || ''),
      empresa: clean(bank.empresa || ''),
      tipo: clean(bank.tipo || ''),
      titular: clean(bank.titular || ''),
    }))
    .filter((bank) => bank.cod && bank.banco);
}

export function supplierExists(raw: unknown, code: string): boolean {
  return Object.values(raw && typeof raw === 'object' ? (raw as Row) : {}).some(
    (supplier) =>
      Boolean(supplier) && typeof supplier === 'object' && String((supplier as Row).cod || '') === code,
  );
}

export function supplierNamed(raw: unknown, code: string): Row | undefined {
  return Object.values(raw && typeof raw === 'object' ? (raw as Row) : {}).find(
    (supplier): supplier is Row =>
      Boolean(supplier) && typeof supplier === 'object' && String((supplier as Row).cod || '') === code,
  );
}

export function advanceRecords(value: unknown): AdvanceRecord[] {
  if (!value) return [];
  if (Array.isArray(value))
    return value.filter((item): item is AdvanceRecord => Boolean(item) && typeof item === 'object');
  if (typeof value === 'object') {
    return Object.values(value).filter(
      (item): item is AdvanceRecord => Boolean(item) && typeof item === 'object',
    );
  }
  return failure(
    409,
    'INVALID_SUPPLIER_ADVANCES',
    'Cadastro de adiantamentos do fornecedor está inconsistente.',
  );
}

export function assertLinkedBankMovement(advance: AdvanceRecord | null | undefined, movement: unknown): void {
  const movementId = clean(advance?.movBancoId || '');
  if (!movementId || !advance) return;
  const wrong: string[] = [];
  if (!movement || typeof movement !== 'object') {
    wrong.push('ausente');
  } else {
    const record = movement as Row;
    const value = Number(record.valor);
    const advanceValue = Number(advance.valor);
    if (!Number.isFinite(value) || !Number.isFinite(advanceValue) || Math.abs(value - advanceValue) > 0.009)
      wrong.push('valor');
    if (String(record.bancoCod ?? '') !== String(advance.bancoCod ?? '')) wrong.push('conta');
    if (!String(record.descricao || '').startsWith('Adiantamento: ')) wrong.push('origem');
    if (record.advanceCode && String(record.advanceCode) !== String(advance.cod)) wrong.push('identificador');
  }
  if (wrong.length) {
    failure(
      409,
      'BANK_LEDGER_CHANGED',
      'O movimento bancário deste adiantamento está divergente (' +
        wrong.join(', ') +
        '). A exclusão foi impedida para proteger os saldos. É necessária conciliação financeira, não repetição do clique.',
    );
  }
}

const EXPECTED_FIELDS = [
  'cod',
  'valor',
  'data',
  'forma',
  'bancoCod',
  'movBancoId',
  'status',
  'ticket',
  'empresa',
  'obs',
];

export function expectedMatches(previous: AdvanceRecord, expected: unknown): boolean {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return false;
  const reference = expected as Row;
  return EXPECTED_FIELDS.every((field) => String(previous[field] ?? '') === String(reference[field] ?? ''));
}

export function operationKeyOf(identity: Identity, operationId: string): string {
  return (
    pathKey(String(identity.uid || identity.erpUser || 'user').replace(/[^\w-]/g, '_')) + '_' + operationId
  );
}
