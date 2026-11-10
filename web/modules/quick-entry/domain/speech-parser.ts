import { foldAccents, nameKey } from '../../../shared/domain/text.js';
import type { EntryKind, InterpretedItem, Interpretation, Party } from './contracts.js';

export interface SpeechContext {
  materials?: readonly string[];
  suppliers?: readonly Party[];
  customers?: readonly Party[];
  kind?: EntryKind | '';
  today?: string;
}

interface WordValue {
  value: number;
  order: number;
}

interface IndexedMaterial {
  name: string;
  tokens: string[];
}

interface MaterialMention {
  kind: 'material';
  pos: number;
  end: number;
  material: string | null;
  spoken: string;
  candidates: string[];
}

interface QuantityFact {
  kind: 'quantity';
  pos: number;
  end: number;
  value: number;
}

interface PriceFact {
  kind: 'price';
  pos: number;
  end: number;
  value: number;
  perTon: boolean;
  total: boolean;
}

interface NumberFact {
  kind: 'number';
  pos: number;
  end: number;
  value: number;
}

type Fact = QuantityFact | PriceFact | NumberFact;
type SpeechEvent = MaterialMention | Fact;

interface ItemBuilder {
  material: string | null;
  materialFalado: string;
  quantidadeKg: number | null;
  precoKg: number | null;
  total: number | null;
  assumedKg: boolean;
  candidates: string[];
}

const UNITS = new Map<string, number>(
  Object.entries({
    zero: 0,
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
    onze: 11,
    doze: 12,
    treze: 13,
    catorze: 14,
    quatorze: 14,
    quinze: 15,
    dezesseis: 16,
    dezasseis: 16,
    dezessete: 17,
    dezoito: 18,
    dezenove: 19,
  }),
);
const TEENS = new Set([
  'dez',
  'onze',
  'doze',
  'treze',
  'catorze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezasseis',
  'dezessete',
  'dezoito',
  'dezenove',
]);
const TENS = new Map<string, number>(
  Object.entries({
    vinte: 20,
    trinta: 30,
    quarenta: 40,
    cinquenta: 50,
    sessenta: 60,
    setenta: 70,
    oitenta: 80,
    noventa: 90,
  }),
);
const HUNDREDS = new Map<string, number>(
  Object.entries({
    cem: 100,
    cento: 100,
    duzentos: 200,
    duzentas: 200,
    trezentos: 300,
    trezentas: 300,
    quatrocentos: 400,
    quatrocentas: 400,
    quinhentos: 500,
    quinhentas: 500,
    seiscentos: 600,
    seiscentas: 600,
    setecentos: 700,
    setecentas: 700,
    oitocentos: 800,
    oitocentas: 800,
    novecentos: 900,
    novecentas: 900,
  }),
);

const STOP_WORDS = new Set([
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
  'A',
  'O',
  'AS',
  'OS',
  'EM',
  'NO',
  'NA',
  'PARA',
  'PRA',
  'PRO',
  'COM',
  'LTDA',
  'ME',
  'EPP',
  'EIRELI',
  'SA',
  'S',
  'COMERCIO',
  'COMERCIAL',
  'INDUSTRIA',
  'METAIS',
  'METAL',
  'SUCATA',
  'SUCATAS',
  'RECICLAGEM',
  'RECICLAVEIS',
]);

const KG_UNIT = /^(kg|kgs|quilo|quilos|kilo|kilos|quilograma|quilogramas)$/;
const TON_UNIT = /^(t|ton|tonelada|toneladas)$/;
const UNIT_PRICE_MARK = /^(a|preco)$/;
const TOTAL_PRICE_MARK = /^(por|valor|total|deu|pago|paguei|cobrei|custou|ficou|fica|vale)$/;
const CURRENCY = /^(real|reais|r\$)$/;
const PRICE_FILLER = /^(o|a|por|cada|de|do|da)$/;
const INVOICE_WORDS = new Set(['fiscal', 'numero', 'n', 'no', 'nf']);
const PURCHASE_WORDS = /\b(compr\w*|peguei|pegamos|recebi|recebemos|entrou)\b/;
const SALE_WORDS = /\b(vend\w*|entreguei|entregamos|saiu)\b/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function wordValue(word: string): WordValue | null {
  const unit = UNITS.get(word);
  if (unit !== undefined) return { value: unit, order: TEENS.has(word) ? 2 : 1 };
  const ten = TENS.get(word);
  if (ten !== undefined) return { value: ten, order: 2 };
  const hundred = HUNDREDS.get(word);
  if (hundred !== undefined) return { value: hundred, order: 3 };
  return null;
}

export function wordsToNumbers(text: string): string {
  const tokens = foldAccents(text)
    .replace(/(\d)\s*kg\b/g, '$1 kg')
    .split(/\s+/)
    .filter(Boolean);
  const output: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (!wordValue(token) && token !== 'mil') {
      output.push(token);
      index++;
      continue;
    }
    let total = 0;
    let group = 0;
    let lastOrder = 99;
    let cursor = index;
    let consumed = index;
    while (cursor < tokens.length) {
      const current = tokens[cursor] ?? '';
      if (current === 'mil') {
        total += (group || 1) * 1000;
        group = 0;
        lastOrder = 99;
        cursor++;
        consumed = cursor;
        continue;
      }
      if (/^(milhao|milhoes)$/.test(current)) {
        total = (total + (group || 1)) * 1000000;
        group = 0;
        lastOrder = 99;
        cursor++;
        consumed = cursor;
        continue;
      }
      const word = wordValue(current);
      if (word && word.order < lastOrder) {
        group += word.value;
        lastOrder = word.order;
        cursor++;
        consumed = cursor;
        continue;
      }
      if (current === 'e' && cursor + 1 < tokens.length) {
        const next = wordValue(tokens[cursor + 1] ?? '');
        if (next && next.order < lastOrder) {
          cursor++;
          continue;
        }
      }
      break;
    }
    output.push(String(total + group));
    index = consumed;
  }
  return output.join(' ');
}

function spokenNumber(token: string): number | null {
  let value = token.replace(/^r\$/, '');
  if (!/^\d[\d.,]*$/.test(value)) return null;
  if (value.includes(',')) value = value.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g, '');
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let mistakes = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++mistakes > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return mistakes + (a.length - i) + (b.length - j) <= 1;
}

function findParties(
  tokens: readonly string[],
  parties: readonly Party[],
  materialWords: ReadonlySet<string>,
) {
  const present = [...new Set(tokens.map((token) => nameKey(token)).filter(Boolean))];
  const mentioned = (word: string) => present.some((candidate) => isSimilar(candidate, word));
  let best: Party[] = [];
  let bestScore = 0;
  for (const party of parties) {
    const words = nameKey(party.nome)
      .split(' ')
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !materialWords.has(word));
    if (!words.length) continue;
    const hits = words.filter(mentioned).length;
    if (!hits) continue;
    const score = hits + (hits === words.length ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = [party];
    } else if (score === bestScore) best.push(party);
  }
  return best;
}

function indexMaterials(materials: readonly string[]): IndexedMaterial[] {
  return materials
    .map((name) => ({ name, tokens: nameKey(name).split(' ').filter(Boolean) }))
    .filter((material) => material.tokens.length);
}

function materialMentions(
  tokens: readonly string[],
  index: readonly IndexedMaterial[],
  skip: ReadonlySet<number>,
): MaterialMention[] {
  const upper = tokens.map((token) => token.toUpperCase());
  const mentions: MaterialMention[] = [];
  for (let i = 0; i < upper.length; ) {
    if (skip.has(i)) {
      i++;
      continue;
    }
    let found: IndexedMaterial | null = null;
    for (const material of index) {
      const matches = material.tokens.every((token, k) => upper[i + k] === token && !skip.has(i + k));
      if (matches && (!found || material.tokens.length > found.tokens.length)) found = material;
    }
    if (found) {
      const end = i + found.tokens.length;
      mentions.push({
        kind: 'material',
        pos: i,
        end,
        material: found.name,
        spoken: tokens.slice(i, end).join(' '),
        candidates: [found.name],
      });
      i = end;
      continue;
    }
    const word = upper[i] ?? '';
    if (word.length >= 3 && !STOP_WORDS.has(word)) {
      const candidates = index
        .filter((material) => material.tokens[0] === word)
        .map((material) => material.name);
      if (candidates.length) {
        const exact = candidates.find((name) => nameKey(name) === word);
        mentions.push({
          kind: 'material',
          pos: i,
          end: i + 1,
          material: exact || (candidates.length === 1 ? (candidates[0] ?? null) : null),
          spoken: tokens[i] ?? '',
          candidates,
        });
      }
    }
    i++;
  }
  return mentions;
}

function readFacts(tokens: readonly string[], skip: ReadonlySet<number>): Fact[] {
  const at = (position: number): string => tokens[position] ?? '';
  const centsAfter = (position: number): boolean =>
    at(position) === 'e' &&
    /^\d{1,2}$/.test(at(position + 1)) &&
    !KG_UNIT.test(at(position + 2)) &&
    !TON_UNIT.test(at(position + 2));
  const facts: Fact[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (skip.has(i)) continue;
    const token = at(i);
    if (token === 'meia' && TON_UNIT.test(at(i + 1))) {
      facts.push({ kind: 'quantity', pos: i, end: i + 2, value: 500 });
      i++;
      continue;
    }
    let value = spokenNumber(token);
    if (value == null) continue;
    let end = i + 1;
    const before = at(i - 1);
    const after = at(i + 1);
    if (KG_UNIT.test(after)) {
      facts.push({ kind: 'quantity', pos: i, end: i + 2, value });
      i++;
      continue;
    }
    if (TON_UNIT.test(after)) {
      facts.push({ kind: 'quantity', pos: i, end: i + 2, value: value * 1000 });
      i++;
      continue;
    }
    let markPosition = i - 1;
    while (markPosition >= 0 && /^(r\$|de)$/.test(at(markPosition))) markPosition--;
    const mark = at(markPosition);
    const totalMark = TOTAL_PRICE_MARK.test(mark);
    let isPrice = totalMark || UNIT_PRICE_MARK.test(mark) || before === 'r$' || token.startsWith('r$');
    if (CURRENCY.test(after)) {
      isPrice = true;
      end = i + 2;
    }
    if (isPrice) {
      if (centsAfter(end)) {
        const cents = at(end + 1);
        value += Number(cents) / (cents.length === 1 ? 10 : 100);
        end += 2;
        if (at(end) === 'centavos') end++;
      }
      let unit = '';
      for (let k = end; k < Math.min(tokens.length, end + 3); k++) {
        if (TON_UNIT.test(at(k))) {
          unit = 't';
          end = k + 1;
          break;
        }
        if (KG_UNIT.test(at(k))) {
          unit = 'kg';
          end = k + 1;
          break;
        }
        if (!PRICE_FILLER.test(at(k))) break;
      }
      facts.push({
        kind: 'price',
        pos: i,
        end,
        value: unit === 't' ? value / 1000 : value,
        perTon: unit === 't',
        total: totalMark && !unit,
      });
      i = end - 1;
      continue;
    }
    facts.push({ kind: 'number', pos: i, end, value });
  }
  return facts;
}

function skippedPositions(tokens: readonly string[], party: Party | null): Set<number> {
  const at = (position: number): string => tokens[position] ?? '';
  const skip = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const token = at(i);
    const next = at(i + 1);
    if (token === 'dia' && /^\d{1,2}$/.test(next)) {
      skip.add(i);
      skip.add(i + 1);
    }
    if (/^\d{1,3}$/.test(token) && /^dias?$/.test(next)) {
      skip.add(i);
      skip.add(i + 1);
    }
    if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(token)) skip.add(i);
    if (token === 'placa' && next) skip.add(i + 1);
    if (token === 'nota') {
      let k = i + 1;
      while (INVOICE_WORDS.has(at(k))) k++;
      if (/^\d{1,10}$/.test(at(k))) for (let x = i; x <= k; x++) skip.add(x);
    }
  }
  if (party) {
    const name = nameKey(party.nome).split(' ').filter(Boolean);
    const upper = tokens.map((token) => token.toUpperCase());
    for (let i = 0; i + name.length <= upper.length; i++) {
      if (name.length > 1 && name.every((token, k) => upper[i + k] === token)) {
        for (let k = 0; k < name.length; k++) skip.add(i + k);
      }
    }
  }
  return skip;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfMonth(isoDate: string, day: number): string | null {
  const [year = 0, month = 1] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCMonth() === month - 1 ? date.toISOString().slice(0, 10) : null;
}

function nextMonthDay(isoDate: string, day: number): string {
  const [year = 0, month = 1] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month, day, 12)).toISOString().slice(0, 10);
}

const formatPlain = (value: number): string => value.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

function newItem(): ItemBuilder {
  return {
    material: null,
    materialFalado: '',
    quantidadeKg: null,
    precoKg: null,
    total: null,
    assumedKg: false,
    candidates: [],
  };
}

function buildItems(events: readonly SpeechEvent[], doubts: string[]): ItemBuilder[] {
  const items: ItemBuilder[] = [];
  let current: ItemBuilder | null = null;
  const start = (): ItemBuilder => {
    const item = newItem();
    items.push(item);
    return item;
  };
  for (const event of events) {
    if (event.kind === 'material') {
      if (!current || current.material || current.materialFalado) current = start();
      current.material = event.material;
      current.materialFalado = event.spoken;
      current.candidates = event.candidates;
    } else if (event.kind === 'quantity') {
      if (!current || (current.quantidadeKg != null && (current.material || current.materialFalado))) {
        current = start();
      }
      current.quantidadeKg = event.value;
    } else if (event.kind === 'price') {
      if (!current) current = start();
      if (current.precoKg != null || current.total != null) current = start();
      if (event.total) current.total = event.value;
      else current.precoKg = event.value;
      if (event.perTon)
        doubts.push(`Preço por tonelada convertido para R$ ${formatPlain(event.value)} por kg.`);
    } else {
      if (!current) current = start();
      if (current.quantidadeKg == null) {
        current.quantidadeKg = event.value;
        current.assumedKg = true;
      } else if (current.precoKg == null) current.precoKg = event.value;
      else {
        current = start();
        current.quantidadeKg = event.value;
        current.assumedKg = true;
      }
    }
  }
  return items;
}

function resolveTotals(items: readonly ItemBuilder[], doubts: string[]): void {
  for (const item of items) {
    if (item.total == null) continue;
    const quantity = item.quantidadeKg ?? 0;
    if (quantity > 0) {
      item.precoKg = Math.round((item.total / quantity) * 10000) / 10000;
      doubts.push(
        `Calculei R$ ${formatPlain(item.precoKg)} por kg (total de R$ ${formatPlain(item.total)} ÷ ${formatPlain(quantity)} kg). Confira.`,
      );
    } else if (item.material || item.materialFalado) {
      doubts.push(
        `Você disse o valor total de R$ ${formatPlain(item.total)}${item.material ? ` do ${item.material}` : ''}, mas não o peso. Informe o peso e o preço por kg.`,
      );
    } else {
      doubts.push(`Entendi o valor de R$ ${formatPlain(item.total)}, mas não qual material nem o peso.`);
    }
  }
}

function finishItems(items: readonly ItemBuilder[], doubts: string[]): InterpretedItem[] {
  return items
    .filter((item) => item.material || item.materialFalado || item.quantidadeKg != null)
    .map((item) => {
      if (!item.material && item.candidates.length > 1) {
        doubts.push(
          `Qual material para "${item.materialFalado}"? ${item.candidates.slice(0, 6).join(' / ')}.`,
        );
      } else if (!item.material && item.materialFalado) {
        doubts.push(`Material "${item.materialFalado}" não encontrado no cadastro. Escolha na lista.`);
      } else if (!item.material) {
        const quantity =
          item.quantidadeKg != null ? `${formatPlain(item.quantidadeKg)} kg` : 'o valor informado';
        doubts.push(`Escolha o material da linha com ${quantity}.`);
      }
      if (item.assumedKg && item.quantidadeKg != null) {
        doubts.push(
          `Considerei ${formatPlain(item.quantidadeKg)} como quilos${item.materialFalado ? ` de ${item.materialFalado}` : ''}. Confira.`,
        );
      }
      if (item.precoKg == null && (item.material || item.materialFalado)) {
        doubts.push(`Falta o preço por kg${item.material ? ` de ${item.material}` : ''}.`);
      }
      return {
        material: item.material,
        materialFalado: item.materialFalado,
        quantidadeKg: item.quantidadeKg,
        precoKg: item.precoKg,
      };
    });
}

function readDates(base: string, joined: string, today: string | undefined) {
  if (!today || !ISO_DATE.test(today)) return { date: null, dueDate: null };
  const date = /\bontem\b/.test(base) ? addDays(today, -1) : null;
  const reference = date || today;
  let dueDate: string | null = null;
  const term = /\b(?:para|pra|em|com)\s+(\d{1,3})\s+dias\b/.exec(joined);
  if (term) dueDate = addDays(reference, Number(term[1]));
  const dueDay = /\b(?:vence|vencimento|pagar|pagamento)\b(?:\s+\w+){0,2}?\s+dia\s+(\d{1,2})\b/.exec(joined);
  if (!dueDate && dueDay) {
    const day = Number(dueDay[1]);
    dueDate = dayOfMonth(today, day);
    if (dueDate && dueDate < reference) dueDate = nextMonthDay(today, day);
  }
  if (!dueDate && /\b(?:vence|pagar|pagamento|vencimento)\s+amanha\b/.test(base)) dueDate = addDays(today, 1);
  return { date, dueDate };
}

export function interpretSpeech(text: string, context: SpeechContext = {}): Interpretation {
  const { materials = [], suppliers = [], customers = [], kind = '', today } = context;
  const doubts: string[] = [];
  const base = foldAccents(String(text || '').trim())
    .replace(/r\$\s*/g, 'r$ ')
    .replace(/(\d)\s*(kg|t)\b/g, '$1 $2')
    .replace(/[;:!?()"]/g, ' ')
    .replace(/(\D)[.,](\s|$)/g, '$1 $2')
    .replace(/,(\s)/g, ' $1');
  const tokens = wordsToNumbers(base)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/^r\$(\d)/, '$1'));
  const wordTokens = tokens.filter((token) => !/^\d/.test(token));

  const soundsLikePurchase = PURCHASE_WORDS.test(base);
  const soundsLikeSale = SALE_WORDS.test(base);
  const spokenKind: EntryKind | '' =
    soundsLikePurchase && !soundsLikeSale ? 'compra' : soundsLikeSale && !soundsLikePurchase ? 'venda' : '';
  const finalKind = kind === 'compra' || kind === 'venda' ? kind : spokenKind || 'indefinido';
  if (kind && spokenKind && kind !== spokenKind) {
    doubts.push(`Você falou em ${spokenKind}, mas está na tela de ${kind}. Confira.`);
  }

  const index = indexMaterials(materials);
  const materialWords = new Set(index.flatMap((material) => material.tokens));

  let party: Party | null = null;
  const candidates = finalKind === 'venda' ? customers : finalKind === 'compra' ? suppliers : [];
  if (candidates.length) {
    const found = findParties(wordTokens, candidates, materialWords);
    const [first] = found;
    if (found.length === 1 && first) party = { nome: first.nome, cod: first.cod || '' };
    else if (found.length > 1) {
      const label = finalKind === 'venda' ? 'cliente' : 'fornecedor';
      doubts.push(
        `Qual ${label}? ${found
          .slice(0, 5)
          .map((option) => option.nome)
          .join(' / ')}.`,
      );
    }
  }

  const skip = skippedPositions(tokens, party);
  const events: SpeechEvent[] = [...materialMentions(tokens, index, skip), ...readFacts(tokens, skip)].sort(
    (a, b) => a.pos - b.pos,
  );
  const builders = buildItems(events, doubts);
  resolveTotals(builders, doubts);
  const items = finishItems(builders, doubts);

  const joined = tokens.join(' ');
  const { date, dueDate } = readDates(base, joined, today);
  const invoice = /\bnota(?:\s+fiscal)?(?:\s+(?:numero|n|no))?\s+(\d{1,10})\b/.exec(joined);

  return {
    fonte: 'aparelho',
    tipo: finalKind,
    tipoFalado: spokenKind,
    parte: party,
    itens: items,
    data: date,
    vencimento: dueDate,
    nf: invoice?.[1] ?? null,
    observacao: null,
    duvidas: [...new Set(doubts)],
  };
}
