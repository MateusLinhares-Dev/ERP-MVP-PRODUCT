import { isIsoDate, isoToBrazilianDate } from '../../../shared/domain/business-date.js';
import { fail } from '../../../shared/errors/app-error.js';

export const MAX_INSTALLMENTS = 36;

export const PAYMENT_FORMS = Object.freeze([
  'PIX',
  'TED',
  'Boleto',
  'Dinheiro',
  'Cheque',
  'Depósito',
  'Transferência',
]);

export interface Installment {
  numero: number;
  dias: number;
  vencimento: string;
  valor: number;
  forma: string;
  obs: string;
}

export interface InstallmentContext {
  balanceCents: number;
  purchaseDate: string;
  defaultDueDate: string;
}

interface RawInstallment {
  vencimento?: unknown;
  valor?: unknown;
  forma?: unknown;
  obs?: unknown;
}

const DAY_MS = 86_400_000;

const toMoney = (cents: number): number => Math.round(cents) / 100;

const formatMoney = (cents: number): string =>
  toMoney(cents).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T12:00:00.000Z`);
  const to = Date.parse(`${toIso}T12:00:00.000Z`);
  return Math.round((to - from) / DAY_MS);
}

function paymentForm(value: unknown, line: number): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const known = PAYMENT_FORMS.find(
    (form) => form.toLocaleLowerCase('pt-BR') === text.toLocaleLowerCase('pt-BR'),
  );
  if (!known) fail(422, 'INVALID_INSTALLMENT_FORM', `Forma de pagamento da parcela ${line} inválida.`);
  return known;
}

function centsOf(value: unknown, line: number): number {
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || cents <= 0 || Math.abs(amount * 100 - cents) > 1e-6 || amount > 1e9) {
    fail(422, 'INVALID_INSTALLMENT_VALUE', `Informe um valor válido na parcela ${line}.`);
  }
  return cents;
}

function singleInstallment({
  balanceCents,
  purchaseDate,
  defaultDueDate,
}: InstallmentContext): Installment[] {
  return [
    {
      numero: 1,
      dias: Math.max(0, daysBetween(purchaseDate, defaultDueDate)),
      vencimento: defaultDueDate,
      valor: toMoney(balanceCents),
      forma: '',
      obs: '',
    },
  ];
}

export function normalizeInstallments(raw: unknown, context: InstallmentContext): Installment[] {
  if (context.balanceCents <= 0) return [];
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) return singleInstallment(context);
  if (!Array.isArray(raw)) fail(422, 'INVALID_INSTALLMENTS', 'Parcelas inválidas.');
  if (raw.length > MAX_INSTALLMENTS)
    fail(422, 'TOO_MANY_INSTALLMENTS', `Máximo de ${MAX_INSTALLMENTS} parcelas.`);
  const lastIndex = raw.length - 1;
  let othersCents = 0;
  const installments = raw.map((value: unknown, index): Installment => {
    const line = index + 1;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(422, 'INVALID_INSTALLMENTS', `Parcela ${line} inválida.`);
    }
    const row = value as RawInstallment;
    const vencimento = String(row.vencimento ?? '').trim();
    if (!isIsoDate(vencimento))
      fail(422, 'INVALID_INSTALLMENT_DATE', `Data de vencimento da parcela ${line} inválida.`);
    if (vencimento < context.purchaseDate) {
      fail(422, 'INVALID_INSTALLMENT_DATE', `A parcela ${line} vence antes da data da compra.`);
    }
    const cents = index === lastIndex ? 0 : centsOf(row.valor, line);
    othersCents += cents;
    return {
      numero: line,
      dias: daysBetween(context.purchaseDate, vencimento),
      vencimento,
      valor: toMoney(cents),
      forma: paymentForm(row.forma, line),
      obs: String(row.obs ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200),
    };
  });
  const lastCents = context.balanceCents - othersCents;
  const last = installments[lastIndex];
  if (!last || lastCents <= 0) {
    fail(
      422,
      'INSTALLMENTS_TOTAL_MISMATCH',
      `As parcelas (R$ ${formatMoney(othersCents)}) passam do saldo a pagar (R$ ${formatMoney(context.balanceCents)}). A última parcela é o saldo restante: ajuste os valores.`,
    );
  }
  last.valor = toMoney(lastCents);
  return installments;
}

export function installmentPayableIds(ticketNo: string, count: number): string[] {
  if (count <= 1) return [`CPPO_${ticketNo}`];
  return Array.from({ length: count }, (_, index) => `CPPO_${ticketNo}-${index + 1}`);
}

export function isInstallmentPayableId(ticketNo: string, id: string): boolean {
  return id === `CPPO_${ticketNo}` || new RegExp(`^CPPO_${ticketNo}-\\d{1,2}$`).test(id);
}

export function installmentSignature(installments: readonly Installment[] | null | undefined): string {
  return JSON.stringify(
    (installments ?? []).map((row) => [
      row.vencimento,
      Math.round(Number(row.valor) * 100),
      row.forma ?? '',
      row.obs ?? '',
    ]),
  );
}

export interface InstallmentPayable {
  id: string;
  ticket: string;
  fornCod: string;
  cred: string;
  desc: string;
  cat: 'Compra de Sucata';
  tipoForn: 'compra';
  lancto: string;
  venc: string;
  valor: number;
  status: 'Pendente';
  dataPgto: '';
  bancoCod: '';
  bancoNome: '';
  obs: string;
  formaPrevista?: string;
  parcela?: number;
  parcelas?: number;
}

export interface InstallmentPayableInput {
  ticketNo: string;
  supplierCode: string;
  supplierName: string;
  descriptionName: string;
  purchaseDate: string;
  installments: readonly Installment[];
}

export function installmentPayables(input: InstallmentPayableInput): InstallmentPayable[] {
  const count = input.installments.length;
  const ids = installmentPayableIds(input.ticketNo, count);
  return input.installments.map((parcel, index) => {
    const suffix = count > 1 ? ` — parcela ${index + 1}/${count}` : '';
    const payable: InstallmentPayable = {
      id: ids[index] ?? `CPPO_${input.ticketNo}-${index + 1}`,
      ticket: input.ticketNo,
      fornCod: input.supplierCode,
      cred: input.supplierName,
      desc: `Compra de Sucata — ${input.descriptionName} — ${input.ticketNo}${suffix}`,
      cat: 'Compra de Sucata',
      tipoForn: 'compra',
      lancto: isoToBrazilianDate(input.purchaseDate),
      venc: isoToBrazilianDate(parcel.vencimento),
      valor: parcel.valor,
      status: 'Pendente',
      dataPgto: '',
      bancoCod: '',
      bancoNome: '',
      obs: parcel.obs || `Gerado automaticamente — Pedido ${input.ticketNo}`,
    };
    if (parcel.forma) payable.formaPrevista = parcel.forma;
    if (count > 1) {
      payable.parcela = index + 1;
      payable.parcelas = count;
    }
    return payable;
  });
}
