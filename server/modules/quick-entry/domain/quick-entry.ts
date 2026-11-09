import { fail } from '../../../shared/errors/app-error.js';
import type { SupplierOption } from '../../suppliers/domain/supplier-directory.js';

export type EntryKind = 'compra' | 'venda';

export const QUICK_LIMITS = Object.freeze({
  items: 30,
  attachments: 8,
  attachmentBytes: 3 * 1024 * 1024,
  text: 2000,
});

export const ATTACHMENT_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
});

export interface Party {
  cod: string;
  nome: string;
}

export interface Catalog {
  suppliers: SupplierOption[];
  customers: Party[];
  materials: string[];
}

export type PriceTable = Record<string, Record<string, number>>;

export interface EntryLine {
  material: string;
  quantity: number;
  unitPrice: number;
  totalCents: number;
}

export interface EntryItemSummary {
  material: string;
  quantidadeKg: number;
  precoKg: number;
  total: number;
}

export interface AttachmentRef {
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  dono: string;
}

export interface UploadRecord extends AttachmentRef {
  caminho: string;
  criadoEm: number;
  lancamento?: string;
}

export interface QuickEntry {
  id: string;
  tipo: EntryKind;
  referencia: string;
  parte: string;
  parteCod: string;
  total: number;
  itens: EntryItemSummary[];
  data: string;
  vencimento: string;
  observacao: string;
  textoFalado: string;
  anexos: AttachmentRef[];
  criadoEm: number;
  criadoPor: string;
  contaPagar?: string;
  contaReceber?: string;
  nf?: string;
  situacao?: string;
}

const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
const TAB = 9;
const LINE_FEED = 10;

function replaceControlChars(value: string, keep: ReadonlySet<number> = new Set()): string {
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return (code < 32 || code === 127) && !keep.has(code) ? ' ' : char;
  }).join('');
}

export function cleanLine(value: unknown, max = 200): string {
  return replaceControlChars(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function cleanText(value: unknown, max: number): string {
  return replaceControlChars(String(value ?? ''), new Set([TAB, LINE_FEED]))
    .trim()
    .slice(0, max);
}

export function normalizeName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLocaleUpperCase('pt-BR')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export const centsToMoney = (cents: number): number => Math.round(cents) / 100;

export function parseEntryLines(raw: unknown, materials: readonly string[]): EntryLine[] {
  if (!Array.isArray(raw) || !raw.length) fail(422, 'ITEMS_REQUIRED', 'Informe pelo menos um material.');
  if (raw.length > QUICK_LIMITS.items) {
    fail(422, 'TOO_MANY_ITEMS', `Máximo de ${QUICK_LIMITS.items} materiais por lançamento.`);
  }
  const known = new Map(materials.map((name) => [normalizeName(name), name]));
  return raw.map((row: unknown, index): EntryLine => {
    const line = index + 1;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      fail(422, 'INVALID_ITEM', `Material da linha ${line} inválido.`);
    }
    const item = row as { material?: unknown; quantidadeKg?: unknown; precoKg?: unknown };
    const material = known.get(normalizeName(item.material));
    if (!material) {
      fail(
        422,
        'UNKNOWN_MATERIAL',
        `Material da linha ${line} não está cadastrado no ERP: ${cleanLine(item.material, 60)}.`,
      );
    }
    const kg = Number(item.quantidadeKg);
    const price = Number(item.precoKg);
    if (!Number.isFinite(kg) || kg <= 0 || kg > 10_000_000) {
      fail(422, 'INVALID_QUANTITY', `Informe o peso (kg) da linha ${line}.`);
    }
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
      fail(422, 'INVALID_PRICE', `Informe o preço por kg da linha ${line}.`);
    }
    const quantity = Math.round(kg * 1000) / 1000;
    const unitPrice = Math.round(price * 10000) / 10000;
    const totalCents = Math.round(quantity * unitPrice * 100);
    if (totalCents <= 0) fail(422, 'INVALID_TOTAL', `O valor da linha ${line} ficou zerado.`);
    return { material, quantity, unitPrice, totalCents };
  });
}

export function totalCentsOf(lines: readonly EntryLine[]): number {
  return lines.reduce((sum, line) => sum + line.totalCents, 0);
}

export function summarize(lines: readonly EntryLine[]): EntryItemSummary[] {
  return lines.map((line) => ({
    material: line.material,
    quantidadeKg: line.quantity,
    precoKg: line.unitPrice,
    total: centsToMoney(line.totalCents),
  }));
}

export function situationOf(kind: EntryKind, record: { status?: unknown } | null): string {
  if (!record) return 'Excluído no ERP';
  if (kind === 'compra') {
    if (record.status === 'Pago') return 'Pago';
    if (record.status === 'Parcial') return 'Pago em parte';
    return 'A pagar';
  }
  if (record.status === 'Pago') return 'Recebido';
  if (record.status === 'Permuta') return 'Permuta';
  return 'A receber';
}

export function detectAttachmentType(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(png)) return 'image/png';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return '';
}
