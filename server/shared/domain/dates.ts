const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const pad = (value: number): string => String(value).padStart(2, '0');

export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isISODate(value: unknown): value is string {
  const match = ISO.exec(String(value ?? ''));
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

export function toISODate(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (isISODate(text.slice(0, 10))) return text.slice(0, 10);
  const match = BR.exec(text);
  if (!match) return '';
  const iso = `${match[3]}-${pad(Number(match[2]))}-${pad(Number(match[1]))}`;
  return isISODate(iso) ? iso : '';
}

export function toBRDate(value: unknown): string {
  const iso = toISODate(value);
  return iso ? iso.split('-').reverse().join('/') : '';
}

export function addDays(iso: string, days: number): string {
  const base = isISODate(iso) ? new Date(`${iso}T12:00:00`) : new Date();
  base.setDate(base.getDate() + Math.trunc(days));
  return todayISO(base);
}

export function daysBetween(from: string, to: string): number {
  if (!isISODate(from) || !isISODate(to)) return 0;
  const start = new Date(`${from}T12:00:00`).getTime();
  const end = new Date(`${to}T12:00:00`).getTime();
  return Math.round((end - start) / 86_400_000);
}
