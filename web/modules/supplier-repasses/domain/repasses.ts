import { parseDecimal } from '../../../shared/domain/decimal.js';

export interface RepassePayment {
  id: string;
  data: string;
  valor: number;
  bancoNome: string;
  comprovante: string;
}

export interface RepasseRecord {
  id: string;
  operationId: string;
  data: string;
  valor: number;
  valorPago: number;
  saldo: number;
  status: string;
  versao: number;
  obs: string;
  pagamentos: RepassePayment[];
}

export interface BankOption {
  cod: string;
  banco: string;
}

export interface RepasseList {
  records: RepasseRecord[];
  banks: BankOption[];
  totalEmAberto: number;
}

export interface SummaryRow {
  fornCod: string;
  nome: string;
  data: string;
  saldo: number;
}

export interface RepasseSummary {
  totalEmAberto: number;
  rows: SummaryRow[];
  months: Record<string, { entradas: number; saidas: number }>;
}

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === 'object') : [];
const text = (value: unknown): string => String(value ?? '');
const money = (value: unknown): number => Math.round((Number(value) || 0) * 100) / 100;

export function repasseList(raw: unknown): RepasseList {
  const data = raw && typeof raw === 'object' ? (raw as Row) : {};
  return {
    records: rows(data.records).map((record) => ({
      id: text(record.id),
      operationId: text(record.operationId),
      data: text(record.data),
      valor: money(record.valor),
      valorPago: money(record.valorPago),
      saldo: money(record.saldo),
      status: text(record.status),
      versao: Number(record.versao) || 0,
      obs: text(record.obs),
      pagamentos: rows(record.pagamentos).map((payment) => ({
        id: text(payment.id),
        data: text(payment.data),
        valor: money(payment.valor),
        bancoNome: text(payment.bancoNome),
        comprovante: text(payment.comprovante),
      })),
    })),
    banks: rows(data.banks)
      .map((bank) => ({ cod: text(bank.cod), banco: text(bank.banco) }))
      .filter((bank) => bank.cod && bank.banco),
    totalEmAberto: money(data.totalEmAberto),
  };
}

export function repasseSummary(raw: unknown): RepasseSummary {
  const data = raw && typeof raw === 'object' ? (raw as Row) : {};
  const months: RepasseSummary['months'] = {};
  const source = data.months && typeof data.months === 'object' ? (data.months as Row) : {};
  for (const [month, value] of Object.entries(source)) {
    const entry = value && typeof value === 'object' ? (value as Row) : {};
    months[month] = { entradas: money(entry.entradas), saidas: money(entry.saidas) };
  }
  return {
    totalEmAberto: money(data.totalEmAberto),
    rows: rows(data.rows).map((row) => ({
      fornCod: text(row.fornCod),
      nome: text(row.nome),
      data: text(row.data),
      saldo: money(row.saldo),
    })),
    months,
  };
}

export function openBalance(records: readonly RepasseRecord[]): number {
  return records.reduce((sum, record) => sum + Math.round(record.saldo * 100), 0) / 100;
}

export function flowTotal(
  summary: RepasseSummary | null,
  month: number,
  year: number,
  kind: 'entradas' | 'saidas',
): number {
  return summary?.months[`${year}-${String(month).padStart(2, '0')}`]?.[kind] ?? 0;
}

const exactCents = (value: number): boolean => Math.abs(Math.round(value * 100) - value * 100) < 0.001;

export type Checked = { ok: true; value: number } | { ok: false; message: string };

export function checkReceipt(input: string): Checked {
  const value = parseDecimal(input);
  if (value === null || value <= 0 || !exactCents(value))
    return { ok: false, message: 'Informe um valor monetário válido.' };
  return { ok: true, value: Math.round(value * 100) / 100 };
}

export function checkPayment(input: string, balance: number): Checked {
  const value = parseDecimal(input);
  if (value === null || value <= 0 || !exactCents(value) || value > balance + 0.001) {
    return {
      ok: false,
      message:
        'Valor do repasse inválido, máximo ' +
        balance.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) +
        '.',
    };
  }
  return { ok: true, value: Math.round(value * 100) / 100 };
}

export function amountField(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const receiptFingerprint = (supplier: string, date: string, value: number, obs: string): string =>
  JSON.stringify([supplier, date, value, obs]);

export const paymentFingerprint = (
  supplier: string,
  record: RepasseRecord,
  date: string,
  value: number,
  bankCode: string,
  proof: string,
): string => JSON.stringify([supplier, record.id, record.versao, date, value, bankCode, proof]);
