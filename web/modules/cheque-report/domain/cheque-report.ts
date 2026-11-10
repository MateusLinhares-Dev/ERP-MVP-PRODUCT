import { foldAccents } from '../../../shared/domain/text.js';

export interface ChequeRow {
  origem?: string;
  id?: string;
  adiantamento?: string;
  empresa: string;
  cliente: string;
  numero: string;
  data: string;
  vencimento?: string;
  valor: number;
  situacao?: string;
}

export interface ChequeCriteria {
  customer?: string;
  company?: string;
  year?: string;
  month?: string;
  from?: string;
  to?: string;
  status?: string;
}

export interface ChequeSummary {
  count: number;
  total: number;
}

export const CHEQUE_STATUSES: readonly string[] = ['A compensar', 'Compensado', 'Cancelado', 'Devolvido'];
export const MONTHS: readonly string[] = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

const normalize = (value: unknown): string => foldAccents(value).trim();
const cents = (value: unknown): number => Math.round(Number(value || 0) * 100);

export function isoDate(value: unknown): string {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text.split('/').reverse().join('-');
  return '';
}

export function formatAmount(value: unknown): string {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function chequeNumber(row: Pick<ChequeRow, 'numero'>): string {
  return String(row.numero ?? '').trim() || 'não informado';
}

export function usableCheques(items: unknown): ChequeRow[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is ChequeRow => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<ChequeRow>;
    return Boolean(String(row.cliente ?? '').trim()) && Number.isFinite(row.valor) && Number(row.valor) > 0;
  });
}

export function filterCheques(items: readonly ChequeRow[], criteria: ChequeCriteria = {}): ChequeRow[] {
  const customer = normalize(criteria.customer);
  const company = normalize(criteria.company);
  const year = String(criteria.year || '');
  const month = String(criteria.month || '');
  const from = String(criteria.from || '');
  const to = String(criteria.to || '');
  const status = String(criteria.status || '');
  return items
    .filter((item) => {
      const date = isoDate(item.data);
      return (
        (!customer || normalize(item.cliente).includes(customer)) &&
        (!company || normalize(item.empresa).includes(company)) &&
        (!year || date.slice(0, 4) === year) &&
        (!month || date.slice(5, 7) === month) &&
        (!from || date >= from) &&
        (!to || date <= to) &&
        (!status || item.situacao === status)
      );
    })
    .sort(
      (a, b) =>
        isoDate(b.data).localeCompare(isoDate(a.data)) ||
        String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true }),
    );
}

export function chequesSummary(items: readonly ChequeRow[]): ChequeSummary {
  return { count: items.length, total: items.reduce((sum, item) => sum + cents(item.valor), 0) / 100 };
}

export function availableYears(items: readonly ChequeRow[]): string[] {
  return [...new Set(items.map((row) => isoDate(row.data).slice(0, 4)).filter(Boolean))].sort().reverse();
}

function csvCell(value: unknown): string {
  let text = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (/^[=+@\-\t]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function chequesCsv(items: readonly ChequeRow[]): string {
  const lines = [['CHEQUE', 'EMPRESA', 'CLIENTE', 'NÚMERO', 'DATA', 'VALOR']];
  for (const item of items) {
    lines.push([
      'CHEQUE',
      item.empresa,
      item.cliente,
      chequeNumber(item),
      item.data,
      'R$ ' + formatAmount(item.valor),
    ]);
  }
  lines.push(['TOTAL', '', '', '', '', 'R$ ' + formatAmount(chequesSummary(items).total)]);
  return '﻿' + lines.map((cells) => cells.map(csvCell).join(';')).join('\r\n');
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

const PRINT_STYLE =
  '@page{size:A4 landscape;margin:12mm}body{font:12px Arial,sans-serif;margin:20px;color:#222}h1{font-size:17px;margin:0 0 14px}' +
  'table{border-collapse:collapse;width:100%;table-layout:auto}th,td{border:1px solid #555;padding:5px 7px;text-align:left;overflow-wrap:anywhere}' +
  'th,tfoot td{background:#fff35b;font-weight:700}td:last-child,th:last-child{text-align:right;white-space:nowrap}tr{break-inside:avoid}' +
  'button{margin-bottom:14px;background:#245b41;color:white;border:0;border-radius:5px;padding:9px 14px;cursor:pointer}' +
  '@media print{button{display:none}body{margin:0}thead{display:table-header-group}tfoot{display:table-footer-group}}';

export function chequesPrintHtml(items: readonly ChequeRow[]): string {
  const rows = items
    .map(
      (c) =>
        '<tr><td>CHEQUE</td><td>' +
        escapeHtml(c.empresa || '—') +
        '</td><td>' +
        escapeHtml(c.cliente) +
        '</td><td>' +
        escapeHtml(chequeNumber(c)) +
        '</td><td>' +
        escapeHtml(c.data) +
        '</td><td>R$ ' +
        formatAmount(c.valor) +
        '</td></tr>',
    )
    .join('');
  const table =
    '<table><thead><tr><th>CHEQUE</th><th>EMPRESA</th><th>CLIENTE</th><th>NÚMERO</th><th>DATA</th><th>VALOR</th></tr></thead><tbody>' +
    rows +
    '</tbody><tfoot><tr><td><b>TOTAL</b></td><td></td><td></td><td></td><td></td><td><b>R$ ' +
    formatAmount(chequesSummary(items).total) +
    '</b></td></tr></tfoot></table>';
  const script =
    '<' + 'script>window.addEventListener("load",function(){window.focus();window.print()})</' + 'script>';
  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relação de cheques</title><style>' +
    PRINT_STYLE +
    '</style></head><body><button type="button" onclick="window.print()">Imprimir</button><h1>Relação de cheques</h1>' +
    table +
    script +
    '</body></html>'
  );
}
