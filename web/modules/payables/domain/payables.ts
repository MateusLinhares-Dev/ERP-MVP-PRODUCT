import { installmentDueDates } from '../../../../server/modules/payables/domain/payable-rules.js';
import { toISODate } from '../../../shared/domain/dates.js';
import { parseDecimal } from '../../../shared/domain/decimal.js';
import { fromCents, toCents } from '../../../shared/domain/money.js';
import { foldAccents } from '../../../shared/domain/text.js';

type Raw = Record<string, unknown>;

const text = (value: unknown): string => (value == null ? '' : String(value).trim());
const isRaw = (value: unknown): value is Raw =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const entries = (value: unknown): Raw[] =>
  (Array.isArray(value) ? value : isRaw(value) ? Object.values(value) : []).filter(isRaw);
const paymentsOf = (value: unknown): PaymentEntry[] =>
  entries(value).map((payment) => ({
    date: text(payment.data),
    amount: fromCents(toCents(payment.valor)),
    advance: fromCents(toCents(payment.adt)),
    bank: text(payment.banco),
    notes: text(payment.obs),
    movementId: text(payment.movBancoId),
  }));

export type PayableKind = 'compra' | 'despesa';

export interface PaymentEntry {
  date: string;
  amount: number;
  advance: number;
  bank: string;
  notes: string;
  movementId: string;
}

export interface PayableRow {
  id: string;
  status: string;
  paymentList: PaymentEntry[];
  supplier: string;
  description: string;
  category: string;
  bankName: string;
  bankCode: string;
  company: string;
  kind: PayableKind;
  due: string;
  amount: number;
  paidAmount: number;
  paid: boolean;
  overdue: boolean;
  partial: boolean;
  payments: number;
  plannedMethod: string;
  groupId: string;
  installments: number;
  fromPurchase: boolean;
  notes: string;
  update: number | null;
}

export interface RowContext {
  today: string;
  companyOf(raw: Raw): string;
  fromPurchase(raw: Raw): boolean;
  onlyPurchases?: boolean;
}

export function payableRows(raw: unknown, context: RowContext): PayableRow[] {
  const list = (Array.isArray(raw) ? raw : []).filter(
    (item): item is Raw => isRaw(item) && Boolean(text(item.id)),
  );
  return list
    .filter((item) => !context.onlyPurchases || text(item.tipoForn) === 'compra')
    .map((item) => {
      const paid = text(item.status) === 'Pago';
      const due = toISODate(item.venc);
      const paymentList = paymentsOf(item.pagamentos);
      const payments = paymentList.length;
      const settled = toCents(item.valorPago) + toCents(item.adtCompensado);
      return {
        id: text(item.id),
        status: text(item.status) || 'Pendente',
        paymentList,
        supplier: text(item.cred),
        description: text(item.desc),
        category: text(item.cat),
        bankName: text(item.bancoNome),
        bankCode: text(item.bancoCod),
        company: context.companyOf(item),
        kind: text(item.tipoForn) === 'compra' ? 'compra' : 'despesa',
        due,
        amount: fromCents(toCents(item.valor)),
        paidAmount: fromCents(settled || (paid ? toCents(item.valor) : 0)),
        paid,
        overdue: !paid && Boolean(due) && due < context.today,
        partial: !paid && payments > 0,
        payments,
        plannedMethod: text(item.formaPrevista),
        groupId: text(item.grupoId),
        installments: Number(item.totalParcelas) || 0,
        fromPurchase: context.fromPurchase(item),
        notes: text(item.obs),
        update: item._upd == null ? null : Number(item._upd),
      } satisfies PayableRow;
    })
    .sort(
      (a, b) =>
        (a.due || '9999').localeCompare(b.due || '9999') || a.supplier.localeCompare(b.supplier, 'pt-BR'),
    );
}

export type StatusOption = 'aberto' | 'quitados' | 'atrasadas' | 'todas';
export type KindOption = 'todos' | PayableKind;

export interface PayableFilter {
  kind: KindOption;
  month: string;
  company: string;
  status: StatusOption;
  category: string;
  bank: string;
  min: string;
  max: string;
  query: string;
  from: string;
  to: string;
  day: string;
}

export const emptyFilter = (today: string): PayableFilter => ({
  kind: 'todos',
  month: today.slice(0, 7),
  company: '',
  status: 'aberto',
  category: '',
  bank: '',
  min: '',
  max: '',
  query: '',
  from: '',
  to: '',
  day: '',
});

export function filterPayables(rows: readonly PayableRow[], filter: PayableFilter): PayableRow[] {
  const min = parseDecimal(filter.min);
  const max = parseDecimal(filter.max);
  const words = foldAccents(filter.query).split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.kind !== 'todos' && row.kind !== filter.kind) return false;
    if (filter.month && row.due.slice(0, 7) !== filter.month) return false;
    if (filter.company && row.company !== filter.company) return false;
    if (filter.status === 'aberto' && row.paid) return false;
    if (filter.status === 'quitados' && !row.paid) return false;
    if (filter.status === 'atrasadas' && !row.overdue) return false;
    if (filter.category && row.category !== filter.category) return false;
    if (filter.bank && row.bankName !== filter.bank) return false;
    if (min != null && row.amount < min) return false;
    if (max != null && row.amount > max) return false;
    if (filter.from && row.due && row.due < filter.from) return false;
    if (filter.to && row.due && row.due > filter.to) return false;
    if (filter.day && row.due !== filter.day) return false;
    if (!words.length) return true;
    const haystack = foldAccents([row.supplier, row.description].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

const sum = (rows: readonly PayableRow[], pick: (row: PayableRow) => number): number =>
  fromCents(rows.reduce((total, row) => total + toCents(pick(row)), 0));

export const totalOf = (rows: readonly PayableRow[]): number => sum(rows, (row) => row.amount);

export interface PayableKpis {
  month: string;
  open: number;
  openCount: number;
  dueToday: number;
  dueTodayCount: number;
  overdue: number;
  overdueCount: number;
  paid: number;
  paidCount: number;
}

export function payableKpis(rows: readonly PayableRow[], filter: PayableFilter, today: string): PayableKpis {
  const month = filter.month || today.slice(0, 7);
  const base = rows.filter((row) => !filter.company || row.company === filter.company);
  const inMonth = base.filter((row) => row.due.startsWith(month));
  const open = inMonth.filter((row) => !row.paid);
  const paid = inMonth.filter((row) => row.paid);
  const todays = base.filter((row) => !row.paid && row.due === today);
  const overdue = base.filter((row) => row.overdue);
  return {
    month,
    open: totalOf(open),
    openCount: open.length,
    dueToday: totalOf(todays),
    dueTodayCount: todays.length,
    overdue: totalOf(overdue),
    overdueCount: overdue.length,
    paid: sum(paid, (row) => row.paidAmount),
    paidCount: paid.length,
  };
}

export const dueTodayRows = (rows: readonly PayableRow[], today: string): PayableRow[] =>
  rows.filter((row) => !row.paid && row.due === today);

export interface DayGroup {
  due: string;
  total: number;
  today: boolean;
  overdue: boolean;
  rows: PayableRow[];
}

export interface CompanyGroup {
  company: string;
  total: number;
  count: number;
  days: DayGroup[];
}

function daysOf(rows: readonly PayableRow[], all: readonly PayableRow[], today: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.due === row.due) last.rows.push(row);
    else
      groups.push({
        due: row.due,
        total: totalOf(all.filter((item) => item.due === row.due)),
        today: row.due === today,
        overdue: Boolean(row.due) && row.due < today,
        rows: [row],
      });
  }
  return groups;
}

export function groupPayables(
  page: readonly PayableRow[],
  all: readonly PayableRow[],
  options: { byCompany: boolean; companies: readonly string[]; today: string },
): CompanyGroup[] {
  if (!options.byCompany)
    return [{ company: '', total: totalOf(all), count: all.length, days: daysOf(page, all, options.today) }];
  const name = (row: PayableRow) => row.company || 'Sem empresa';
  const rank = (company: string) => {
    const at = options.companies.indexOf(company);
    if (at >= 0) return at;
    return company === 'Sem empresa' ? 999 : 500;
  };
  const names = [...new Set(page.map(name))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'pt-BR'));
  return names.map((company) => {
    const inCompany = all.filter((row) => name(row) === company);
    return {
      company,
      total: totalOf(inCompany),
      count: inCompany.length,
      days: daysOf(
        page.filter((row) => name(row) === company),
        inCompany,
        options.today,
      ),
    };
  });
}

export function dayChips(rows: readonly PayableRow[], filter: PayableFilter, today: string) {
  const days = [...new Set(filterPayables(rows, { ...filter, day: '' }).map((row) => row.due))]
    .filter(Boolean)
    .sort();
  if (!days.length || days.length > 60) return [];
  return days.map((iso) => ({ iso, today: iso === today, overdue: iso < today }));
}

export interface CalendarDay {
  iso: string;
  day: number;
  count: number;
  total: number;
  today: boolean;
  overdue: boolean;
}

export function calendarMonth(
  rows: readonly PayableRow[],
  month: string,
  today: string,
): (CalendarDay | null)[] {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells: (CalendarDay | null)[] = Array.from({ length: first }, () => null);
  for (let day = 1; day <= last; day++) {
    const iso = `${month}-${String(day).padStart(2, '0')}`;
    const due = rows.filter((row) => !row.paid && row.due === iso);
    cells.push({
      iso,
      day,
      count: due.length,
      total: totalOf(due),
      today: iso === today,
      overdue: due.length > 0 && iso < today,
    });
  }
  return cells;
}

const uniqueSorted = (values: string[]): string[] =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
export const categoriesOf = (rows: readonly PayableRow[]): string[] =>
  uniqueSorted(rows.map((row) => row.category));
export const banksOf = (rows: readonly PayableRow[]): string[] =>
  uniqueSorted(rows.map((row) => row.bankName));

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const absolute = year * 12 + monthNumber - 1 + delta;
  return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}`;
}

export interface PayableForm {
  description: string;
  kind: PayableKind;
  supplier: string;
  company: string;
  category: string;
  bankCode: string;
  amount: string;
  due: string;
  notes: string;
  installments: boolean;
  count: string;
  day: string;
  firstMonth: string;
}

export type FormResult = { ok: true; payload: Record<string, unknown> } | { ok: false; message: string };

export function installmentPlan(
  form: PayableForm,
): { count: number; day: number; firstMonth: string } | null {
  const plan = { count: Number(form.count), day: Number(form.day), firstMonth: form.firstMonth };
  if (!Number.isInteger(plan.count) || plan.count < 1 || plan.count > 600) return null;
  if (!Number.isInteger(plan.day) || plan.day < 1 || plan.day > 31) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.firstMonth)) return null;
  return plan;
}

export function installmentPreview(form: PayableForm): string {
  const plan = installmentPlan(form);
  if (!plan) return '';
  const dates = installmentDueDates(plan);
  return `${plan.count} parcela(s) — 1ª em ${dates[0]} · última em ${dates[dates.length - 1]}`;
}

export function formRequest(form: PayableForm, row: PayableRow | null): FormResult {
  const value = parseDecimal(form.amount);
  if (!form.description.trim()) return { ok: false, message: 'Informe a descrição.' };
  if (!form.company) return { ok: false, message: 'Selecione a empresa responsável por esta conta.' };
  if (!row?.paid && (value == null || value <= 0))
    return { ok: false, message: 'Informe um valor maior que zero.' };
  const payable: Record<string, unknown> = {
    desc: form.description.trim(),
    cred: form.supplier.trim(),
    cat: form.category.trim() || 'Outros',
    empresa: form.company,
    bancoCod: form.bankCode,
    obs: form.notes.trim(),
  };
  if (!row?.paid) payable.valor = value;
  if (row) {
    if (!form.due) return { ok: false, message: 'Informe o vencimento.' };
    payable.venc = form.due;
    return {
      ok: true,
      payload: { action: 'update', id: row.id, payable, expectedUpdate: row.update ?? undefined },
    };
  }
  payable.tipoForn = form.kind;
  if (form.installments) {
    const plan = installmentPlan(form);
    if (!plan) return { ok: false, message: 'Informe o número de parcelas, o dia e o mês da 1ª parcela.' };
    return { ok: true, payload: { action: 'create', payable, installments: plan } };
  }
  if (!form.due) return { ok: false, message: 'Informe o vencimento.' };
  payable.venc = form.due;
  return { ok: true, payload: { action: 'create', payable } };
}

export function groupChoices(rows: readonly PayableRow[], row: PayableRow) {
  if (!row.groupId) return null;
  const group = rows.filter((item) => item.groupId === row.groupId && !item.fromPurchase);
  if (group.length < 2) return null;
  const pending = group.filter((item) => item.id !== row.id && !item.paid && item.payments === 0);
  return {
    size: group.length,
    pending: [row.id, ...pending.map((item) => item.id)],
    all: group.filter((item) => item.payments === 0).map((item) => item.id),
  };
}
