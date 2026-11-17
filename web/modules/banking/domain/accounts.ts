import { parseDecimal } from '../../../shared/domain/decimal.js';
import { foldAccents } from '../../../shared/domain/text.js';
import { addMoney, isoDate, sign, statement } from './ledger.js';
import type { Money, Raw } from './ledger.js';

export const ACCOUNT_TYPES = ['Conta Corrente', 'Poupança', 'Caixa', 'Aplicação', 'Conta Terceiro'] as const;

export interface AccountRow {
  index: number;
  id: string;
  cod: string;
  banco: string;
  tipo: string;
  titular: string;
  cpfcnpj: string;
  agencia: string;
  conta: string;
  pix: string;
  obs: string;
  company: string;
  openingBalance: number;
  createdAt: string;
  balance: Money;
  balanceSign: -1 | 0 | 1;
  flagged: boolean;
  raw: Raw;
}

export interface AccountContext {
  companyOf(raw: Raw): string;
  createdAt(raw: Raw): string;
}

const text = (value: unknown): string => String(value ?? '').trim();

function list(value: unknown): Raw[] {
  if (Array.isArray(value))
    return value.filter((item): item is Raw => Boolean(item) && typeof item === 'object');
  if (value && typeof value === 'object')
    return Object.values(value).filter((item): item is Raw => Boolean(item) && typeof item === 'object');
  return [];
}

export function accountRows(banks: unknown, entries: unknown, context: AccountContext): AccountRow[] {
  const ledger = list(entries);
  const byCode = new Map<string, Raw[]>();
  for (const entry of ledger) {
    const code = text(entry.bancoCod);
    const bucket = byCode.get(code);
    if (bucket) bucket.push(entry);
    else byCode.set(code, [entry]);
  }
  return list(banks).map((raw, index) => {
    const cod = text(raw.cod);
    const summary = statement(raw.saldo ?? 0, cod, byCode.get(cod) ?? []);
    return {
      index,
      id: text(raw.id) || cod,
      cod,
      banco: text(raw.banco),
      tipo: text(raw.tipo) || 'Conta Corrente',
      titular: text(raw.titular),
      cpfcnpj: text(raw.cpfcnpj),
      agencia: text(raw.agencia),
      conta: text(raw.conta),
      pix: text(raw.pix),
      obs: text(raw.obs),
      company: context.companyOf(raw),
      openingBalance: Number(raw.saldo ?? 0) || 0,
      createdAt: context.createdAt(raw),
      balance: summary.closingBalance,
      balanceSign: sign(summary.closingBalance),
      flagged: summary.hasUnsafeLegacyValues || summary.invalidValues > 0,
      raw,
    };
  });
}

export function bankKpis(rows: readonly AccountRow[]): { count: number; total: Money; flagged: boolean } {
  return {
    count: rows.length,
    total: addMoney(rows.map((row) => row.balance)),
    flagged: rows.some((row) => row.flagged),
  };
}

export function duplicateNames(rows: readonly AccountRow[]): { name: string; count: number }[] {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const key = row.banco.toUpperCase();
    if (key) groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].filter(([, count]) => count > 1).map(([name, count]) => ({ name, count }));
}

export function searchAccounts(rows: readonly AccountRow[], query: string): AccountRow[] {
  const wanted = foldAccents(query).trim();
  if (!wanted) return [...rows];
  return rows.filter((row) =>
    foldAccents(
      [
        row.cod,
        row.banco,
        row.agencia,
        row.conta,
        row.tipo,
        row.titular,
        row.cpfcnpj,
        row.pix,
        row.obs,
        row.company,
      ].join(' '),
    ).includes(wanted),
  );
}

export function movementCount(entries: unknown, code: string): number {
  return code ? list(entries).filter((entry) => text(entry.bancoCod) === code).length : 0;
}

export interface AccountForm {
  empresa: string;
  banco: string;
  tipo: string;
  titular: string;
  cpfcnpj: string;
  agencia: string;
  conta: string;
  pix: string;
  endereco: string;
  saldo: string;
  data: string;
  obs: string;
  cod: string;
}

const moneyText = (value: unknown): string =>
  (Number(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function accountForm(
  raw: Raw | null,
  defaults: { company: string; holder: string; address(company: string): string },
): AccountForm {
  if (!raw)
    return {
      empresa: defaults.company,
      banco: '',
      tipo: 'Conta Corrente',
      titular: '',
      cpfcnpj: '',
      agencia: '',
      conta: '',
      pix: '',
      endereco: defaults.address(defaults.company),
      saldo: '0,00',
      data: '',
      obs: '',
      cod: '',
    };
  return {
    empresa: text(raw.empresa) || defaults.company,
    banco: text(raw.banco),
    tipo: text(raw.tipo) || 'Conta Corrente',
    titular: text(raw.titular),
    cpfcnpj: text(raw.cpfcnpj),
    agencia: text(raw.agencia),
    conta: text(raw.conta),
    pix: text(raw.pix),
    endereco: text(raw.endereco),
    saldo: moneyText(raw.saldo),
    data: isoDate(String(raw.criadoEm ?? '').slice(0, 10)),
    obs: text(raw.obs),
    cod: text(raw.cod),
  };
}

export type AccountRequest =
  | { ok: true; payload: Record<string, unknown>; summary: { banco: string; saldo: number } }
  | { ok: false; message: string };

export function accountRequest(form: AccountForm, original: Raw | null, holder: string): AccountRequest {
  const banco = form.banco.replace(/\s+/g, ' ').trim();
  if (!banco) return { ok: false, message: 'Informe o nome do banco.' };
  const saldo = parseDecimal(form.saldo || '0');
  if (saldo === null || Math.abs(Math.round(saldo * 100) - saldo * 100) > 0.000001)
    return { ok: false, message: 'Saldo inicial inválido. Exemplo: 1.524.205,97' };
  const tipo = (ACCOUNT_TYPES as readonly string[]).includes(form.tipo) ? form.tipo : 'Conta Corrente';
  const account: Record<string, unknown> = {
    empresa: form.empresa.trim(),
    banco,
    tipo,
    titular: form.titular.trim() || (original ? '' : holder),
    cpfcnpj: tipo === 'Conta Terceiro' ? form.cpfcnpj.trim() : '',
    agencia: form.agencia.trim(),
    conta: form.conta.trim(),
    pix: form.pix.trim(),
    endereco: form.endereco.trim(),
    saldo,
    obs: form.obs.trim(),
  };
  if (form.data) account.criadoEm = form.data;
  if (!original)
    return { ok: true, payload: { action: 'create-account', account }, summary: { banco, saldo } };
  const code = form.cod.trim();
  if (code && code !== text(original.cod)) account.cod = code;
  const payload: Record<string, unknown> = {
    action: 'update-account',
    id: text(original.id) || text(original.cod),
    account,
  };
  if (original._upd != null) payload.expectedUpdate = Number(original._upd);
  return { ok: true, payload, summary: { banco, saldo } };
}
