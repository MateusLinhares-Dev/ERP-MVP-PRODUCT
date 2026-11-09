import { isIsoDate } from '../../../shared/domain/business-date.js';
import { QUICK_LIMITS, normalizeName, type Catalog, type Party } from './quick-entry.js';

export type SpokenKind = 'compra' | 'venda' | 'indefinido';

export interface InterpretedItem {
  material: string | null;
  materialFalado: string;
  quantidadeKg: number | null;
  precoKg: number | null;
}

export interface SpeechInterpretation {
  fonte: 'ia';
  tipo: SpokenKind;
  parte: Party | null;
  itens: InterpretedItem[];
  data: string | null;
  vencimento: string | null;
  nf: string | null;
  observacao: string | null;
  duvidas: string[];
}

interface RawInterpretation {
  tipo?: unknown;
  parte?: unknown;
  itens?: unknown;
  data?: unknown;
  vencimento?: unknown;
  nf?: unknown;
  observacao?: unknown;
  duvidas?: unknown;
}

interface RawItem {
  material?: unknown;
  materialFalado?: unknown;
  quantidadeKg?: unknown;
  precoKg?: unknown;
}

function shortText(value: unknown, max: number): string | null {
  if (value == null) return null;
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max) || null;
}

function positive(value: unknown, max: number): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? number : null;
}

function validDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return isIsoDate(text) ? text : null;
}

function kindOf(value: unknown, hint: string): SpokenKind {
  if (value === 'compra' || value === 'venda') return value;
  if (hint === 'compra' || hint === 'venda') return hint;
  return 'indefinido';
}

export function sanitizeInterpretation(raw: unknown, catalog: Catalog, hint: string): SpeechInterpretation {
  const result = (raw && typeof raw === 'object' ? raw : {}) as RawInterpretation;
  const tipo = kindOf(result.tipo, hint);
  const parties: Party[] = tipo === 'venda' ? catalog.customers : tipo === 'compra' ? catalog.suppliers : [];
  const party = result.parte
    ? parties.find((row) => normalizeName(row.nome) === normalizeName(result.parte))
    : null;
  const knownMaterials = new Map(catalog.materials.map((name) => [normalizeName(name), name]));
  const duvidas = (Array.isArray(result.duvidas) ? result.duvidas : [])
    .map((text) => shortText(text, 300))
    .filter((text): text is string => Boolean(text))
    .slice(0, 10);
  if (result.parte && !party) {
    duvidas.push(
      `Confira o ${tipo === 'venda' ? 'cliente' : 'fornecedor'}: "${shortText(result.parte, 80)}" não está no cadastro.`,
    );
  }
  const itens = (Array.isArray(result.itens) ? (result.itens as RawItem[]) : [])
    .slice(0, QUICK_LIMITS.items)
    .map(
      (item): InterpretedItem => ({
        material: item?.material ? (knownMaterials.get(normalizeName(item.material)) ?? null) : null,
        materialFalado: shortText(item?.materialFalado, 80) ?? '',
        quantidadeKg: positive(item?.quantidadeKg, 10_000_000),
        precoKg: positive(item?.precoKg, 1_000_000),
      }),
    )
    .filter((item) => item.material || item.materialFalado || item.quantidadeKg || item.precoKg);
  return {
    fonte: 'ia',
    tipo,
    parte: party ? { nome: party.nome, cod: party.cod || '' } : null,
    itens,
    data: validDate(result.data),
    vencimento: validDate(result.vencimento),
    nf: shortText(result.nf, 40),
    observacao: shortText(result.observacao, 500),
    duvidas,
  };
}
