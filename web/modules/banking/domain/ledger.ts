export type Raw = Record<string, unknown>;
export type Money = number | string;

export interface StatementRow {
  entry: Raw;
  index: number;
  date: string;
  incoming: boolean;
  amount: Money;
  balance: Money;
}

export interface Statement {
  openingBalance: Money;
  closingBalance: Money;
  credits: Money;
  debits: Money;
  hasUnsafeLegacyValues: boolean;
  invalidValues: number;
  rows: StatementRow[];
}

const UNSAFE = Number.MAX_SAFE_INTEGER;

export function isoDate(value: unknown): string {
  const text = String(value ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : br
      ? [Number(br[3]), Number(br[2]), Number(br[1])]
      : null;
  if (!parts) return '';
  const [year = 0, month = 0, day = 0] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day)
    return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function toCents(value: unknown): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new RangeError('Valor monetário não finito');
  let raw = String(value)
    .trim()
    .replace(/\s|R\$/gi, '');
  if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new TypeError('Valor monetário inválido');
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400)
    throw new RangeError('Expoente monetário não suportado');
  const fraction = match[3] ?? '';
  const digits = BigInt((match[2] ?? '0') + fraction);
  const offset = exponent - fraction.length + 2;
  const cents =
    offset >= 0
      ? digits * 10n ** BigInt(offset)
      : (digits + 5n * 10n ** BigInt(-offset - 1)) / 10n ** BigInt(-offset);
  return match[1] === '-' ? -cents : cents;
}

const SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function fromCents(cents: bigint): Money {
  if (cents <= SAFE_CENTS && cents >= -SAFE_CENTS) return Number(cents) / 100;
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, '0');
  return (negative ? '-' : '') + digits.slice(0, -2) + '.' + digits.slice(-2);
}

export function brl(value: unknown): string {
  let cents = 0n;
  try {
    cents = toCents(value);
  } catch {
    cents = 0n;
  }
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negative ? '-' : '') + whole + ',' + digits.slice(-2);
}

export function sign(value: unknown): -1 | 0 | 1 {
  let cents = 0n;
  try {
    cents = toCents(value);
  } catch {
    cents = 0n;
  }
  return cents > 0n ? 1 : cents < 0n ? -1 : 0;
}

export function addMoney(values: readonly unknown[]): Money {
  return fromCents(
    values.reduce<bigint>((sum, value) => {
      try {
        return sum + toCents(value);
      } catch {
        return sum;
      }
    }, 0n),
  );
}

export const isIncoming = (entry: Raw): boolean => entry.tipo === 'Entrada' || entry.tipo === 'Crédito';

export function statement(openingBalance: unknown, bankCode: string, entries: readonly unknown[]): Statement {
  const matches = entries
    .map((entry, index) => ({ entry: entry as Raw, index }))
    .filter(
      ({ entry }) =>
        Boolean(entry) && typeof entry === 'object' && String(entry.bancoCod ?? '') === String(bankCode),
    );
  matches.sort((a, b) => {
    const left = isoDate(a.entry.data);
    const right = isoDate(b.entry.data);
    if (left !== right) return !left ? 1 : !right ? -1 : left.localeCompare(right);
    return a.index - b.index;
  });
  let invalidValues = 0;
  let opening = 0n;
  try {
    opening = toCents(openingBalance);
  } catch {
    invalidValues++;
  }
  let balance = opening;
  let credit = 0n;
  let debit = 0n;
  let hasUnsafeLegacyValues = typeof openingBalance === 'number' && Math.abs(openingBalance) * 100 > UNSAFE;
  const rows = matches.map(({ entry, index }) => {
    let amount = 0n;
    try {
      amount = toCents(entry.valor);
    } catch {
      invalidValues++;
    }
    const magnitude = amount < 0n ? -amount : amount;
    const incoming = isIncoming(entry);
    balance += incoming ? magnitude : -magnitude;
    if (incoming) credit += magnitude;
    else debit += magnitude;
    if (typeof entry.valor === 'number' && Math.abs(entry.valor) * 100 > UNSAFE) hasUnsafeLegacyValues = true;
    return {
      entry,
      index,
      date: isoDate(entry.data),
      incoming,
      amount: fromCents(magnitude),
      balance: fromCents(balance),
    };
  });
  return {
    openingBalance: fromCents(opening),
    closingBalance: fromCents(balance),
    credits: fromCents(credit),
    debits: fromCents(debit),
    hasUnsafeLegacyValues,
    invalidValues,
    rows,
  };
}
