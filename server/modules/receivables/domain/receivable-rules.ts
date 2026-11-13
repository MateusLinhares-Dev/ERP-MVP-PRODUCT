import { isISODate, toBRDate, toISODate } from '../../../shared/domain/dates.js';
import { parseDecimal } from '../../../shared/domain/decimal.js';
import { fromCents, toCents } from '../../../shared/domain/money.js';
import { hasControlChars } from '../../../shared/domain/text.js';

export type Row = Record<string, unknown>;

export interface Problem {
  code: string;
  message: string;
}

export const RECEIVED = 'Recebido';
export const CREDIT_FORMS = new Set(['Adiantamento', 'Cheque']);
export const MAX_CHEQUES = 30;
const OPEN_CHEQUE = 'Pendente';

const text = (value: unknown, max = 500): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

const isRow = (value: unknown): value is Row =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const listOf = (value: unknown): Row[] =>
  (Array.isArray(value) ? value : isRow(value) ? Object.values(value) : []).filter(isRow);

export function money(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : parseDecimal(value);
  if (parsed == null || !Number.isFinite(parsed)) return null;
  return fromCents(toCents(parsed));
}

export interface ReceivableFields {
  cli?: string;
  nf?: string;
  valor?: number;
  venc?: string;
  obs?: string;
  forma?: string;
  fiscalPartyId?: string;
}

export function cleanFields(
  input: unknown,
  requireAll: boolean,
): { fields: ReceivableFields; problem?: Problem } {
  const source = isRow(input) ? input : {};
  const fields: ReceivableFields = {};
  const fail = (code: string, message: string) => ({ fields, problem: { code, message } });
  for (const [field, max] of [
    ['cli', 160],
    ['nf', 40],
    ['obs', 500],
    ['forma', 40],
    ['fiscalPartyId', 120],
  ] as const) {
    if (!(field in source)) continue;
    const value = text(source[field], max + 1);
    if (value.length > max) return fail('FIELD_TOO_LONG', `O campo ${field} passou do tamanho permitido.`);
    if (hasControlChars(value.replace(/[\r\n\t]/g, ' ')))
      return fail('INVALID_TEXT', `O campo ${field} tem caracteres inválidos.`);
    fields[field] = field === 'cli' ? value.replace(/\s+/g, ' ') : value;
  }
  if ('valor' in source) {
    const value = money(source.valor);
    if (value == null || value <= 0 || value > 1e10)
      return fail('INVALID_AMOUNT', 'Informe um valor maior que zero.');
    fields.valor = value;
  }
  if ('venc' in source) {
    const due = toISODate(source.venc);
    if (!due) return fail('INVALID_DATE', 'Informe o vencimento.');
    fields.venc = toBRDate(due);
  }
  if (requireAll) {
    if (!fields.cli) return fail('CLIENT_REQUIRED', 'Informe o cliente.');
    if (fields.valor == null) return fail('INVALID_AMOUNT', 'Informe um valor maior que zero.');
    if (!fields.venc) return fail('INVALID_DATE', 'Informe o vencimento.');
  }
  return { fields };
}

export interface ChequeInput {
  num: string;
  banco: string;
  valor: number;
  bomPara: string;
}

export function cleanCheques(input: unknown): { cheques: ChequeInput[]; problem?: Problem } {
  const rows = Array.isArray(input) ? input.filter(isRow) : [];
  if (rows.length > MAX_CHEQUES)
    return {
      cheques: [],
      problem: { code: 'TOO_MANY_CHEQUES', message: `Máximo de ${MAX_CHEQUES} cheques por baixa.` },
    };
  const cheques: ChequeInput[] = [];
  for (const [index, row] of rows.entries()) {
    const num = text(row.num, 30);
    const valor = money(row.valor);
    const bomPara = text(row.bomPara, 10);
    if (!num || valor == null || valor <= 0)
      return {
        cheques: [],
        problem: { code: 'INVALID_CHEQUE', message: `Preencha número e valor do cheque ${index + 1}.` },
      };
    if (bomPara && !isISODate(bomPara))
      return {
        cheques: [],
        problem: { code: 'INVALID_CHEQUE', message: `Data "bom para" inválida no cheque ${index + 1}.` },
      };
    cheques.push({ num, banco: text(row.banco, 60), valor, bomPara });
  }
  const repeated = cheques.find(
    (cheque, index) => cheques.findIndex((other) => other.num === cheque.num) !== index,
  );
  if (repeated)
    return {
      cheques: [],
      problem: { code: 'INVALID_CHEQUE', message: `O cheque nº ${repeated.num} foi informado duas vezes.` },
    };
  return { cheques };
}

export function chequeRecords(
  cheques: readonly ChequeInput[],
  receivable: Row,
  dateISO: string,
  crId: string,
): Row[] {
  const nf = text(receivable.nf, 40);
  return cheques.map((cheque) => ({
    num: cheque.num,
    data: toBRDate(dateISO),
    bomPara: cheque.bomPara ? toBRDate(cheque.bomPara) : '',
    valor: cheque.valor,
    banco: cheque.banco,
    tipo: 'Recebimento',
    vinculo: nf,
    emitente: text(receivable.cli, 160),
    obs: 'Recebimento de conta a receber' + (nf ? ' — NF ' + nf : ''),
    status: OPEN_CHEQUE,
    motivoDevolucao: '',
    contaReceberId: crId,
  }));
}

export function removableCheques(list: readonly Row[], receivable: Row): { keep: Row[]; blocked: string[] } {
  const id = text(receivable.id, 120);
  const nums = new Set(
    (Array.isArray(receivable.chequesRecebimento) ? receivable.chequesRecebimento : []).map((item) =>
      text(item),
    ),
  );
  const mine = (row: Row): boolean =>
    text(row.contaReceberId, 120) === id || (nums.has(text(row.num)) && text(row.tipo) === 'Recebimento');
  const blocked = list
    .filter((row) => mine(row) && text(row.status) !== OPEN_CHEQUE)
    .map((row) => text(row.num));
  return { keep: list.filter((row) => !mine(row)), blocked };
}

export function chequeSummary(cheques: readonly ChequeInput[]): string {
  const total = cheques.reduce((sum, cheque) => sum + toCents(cheque.valor), 0);
  return `${cheques.length} cheque(s) — R$ ${fromCents(total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}
