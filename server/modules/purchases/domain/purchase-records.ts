import { AppError } from '../../../shared/errors/app-error.js';

export type Row = Record<string, unknown>;

export interface PurchaseTicket {
  ticket?: string;
  numeroPedido?: string;
  fornecedorCod?: string;
  fornCod?: string;
  fornecedor?: string;
  fornecedorNome?: string;
  itens?: (Row | null)[];
  totalProdutos?: number;
  totalGeral?: number;
  totalKg?: number;
  descontoCompra?: number;
  freteCompra?: number;
  acrescimo?: number;
  ordemCompra?: string;
  observacoesPedido?: string;
  dataCompra?: string;
  data?: string;
  vencimentoSaldo?: string;
  status?: string;
  adiantamento?: number;
  saldoAnterior?: number;
  saldoPagar?: number;
  parcelas?: unknown;
  reciboFinanceiro?: unknown;
  pedidoCompra?: Row;
  creditoFornecedorOrigem?: string;
  creditoFornecedorAplicado?: number;
  _consolidado?: boolean;
  _consolidadoEm?: string;
  _balFinalizado?: boolean;
  _pagoUndo?: unknown;
  [field: string]: unknown;
}

export interface PayableRow {
  id?: string;
  ticket?: string;
  fornCod?: string;
  valor?: number;
  status?: string;
  valorPago?: number;
  adtCompensado?: number;
  pagamentos?: unknown[];
  dataPgto?: string;
  movBancoIdCP?: string;
  bancoCod?: string;
  [field: string]: unknown;
}

export interface AdvanceReceiptRow {
  cod?: string;
  data?: string;
  forma?: string;
  bancoNome?: string;
  valorOriginal?: number;
  valorAplicado?: number;
  valorPendente?: number;
  [field: string]: unknown;
}

export interface FinancialReceipt {
  versao?: number;
  total?: number;
  adiantamentos?: AdvanceReceiptRow[];
  cheques?: Row[];
  creditos?: Row[];
  devolucoes?: Row[];
  [field: string]: unknown;
}

export const isRow = (value: unknown): value is Row =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const rowEntries = <T = Row>(value: unknown): [string, T][] =>
  Object.entries(value && typeof value === 'object' ? (value as Row) : {}).filter(
    (entry): entry is [string, T] => isRow(entry[1]),
  );

export function reject(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}

export function cash(value: unknown): number {
  const amount = Number(value);
  if (
    !Number.isFinite(amount) ||
    Math.abs(Math.round(amount * 100) - amount * 100) > 0.00001 ||
    Math.abs(amount) > 1000000000
  ) {
    reject(422, 'INVALID_AMOUNT', 'Valor financeiro inválido.');
  }
  return Math.round(amount * 100);
}

export const round = (value: number): number => Math.round(value) / 100;

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function readRows(raw: unknown): Row | Row[] {
  if (Array.isArray(raw))
    return raw.map((row: unknown) => (row && typeof row === 'object' ? clone(row as Row) : row)) as Row[];
  if (raw && typeof raw === 'object') return clone(raw as Row);
  return [];
}
