import { parseDecimal, toFieldText } from '../../../shared/domain/decimal.js';
import { nameKey } from '../../../shared/domain/text.js';
import type {
  AttachmentRef,
  EntryKind,
  InterpretedItem,
  Interpretation,
  Party,
  QuickOptions,
  SaveBody,
} from './contracts.js';

export type IdFactory = () => string;
export type ItemField = 'material' | 'kg' | 'price';

export interface ItemDraft {
  id: string;
  material: string;
  kgText: string;
  priceText: string;
  spokenMaterial: string;
  fromSpeech: boolean;
}

export interface AttachmentDraft {
  localId: string;
  nome: string;
  status: string;
  preview: string;
  failed: boolean;
  ref: AttachmentRef | null;
}

export interface EntryDraft {
  kind: EntryKind;
  operationId: string;
  party: Party | null;
  items: ItemDraft[];
  attachments: AttachmentDraft[];
  spokenText: string;
  date: string;
  dueDate: string;
  invoice: string;
  note: string;
  doubts: string[];
  speechFilled: string[];
  invalid: string[];
}

export interface Validation {
  problems: string[];
  invalid: string[];
}

export const PARTY_FIELD = 'party';
export const DATE_FIELD = 'date';
export const DUE_DATE_FIELD = 'dueDate';
export const INVOICE_FIELD = 'invoice';
export const NOTE_FIELD = 'note';
export const PARTY_RESULTS_LIMIT = 60;
export const DEFAULT_ATTACHMENT_LIMIT = 8;

const FORM_FIELDS: readonly string[] = [DATE_FIELD, DUE_DATE_FIELD, INVOICE_FIELD, NOTE_FIELD];
const SCREEN_KIND_DOUBT = /^Você falou em (compra|venda), mas está na tela/;
const TRANSIENT_SAVE_CODES = new Set([
  'NETWORK_ERROR',
  'DATABASE_UNAVAILABLE',
  'QUICK_ENTRY_IN_PROGRESS',
  'PURCHASE_IN_PROGRESS',
]);

export const itemField = (itemId: string, field: ItemField): string => `${itemId}:${field}`;
export const isPurchase = (kind: EntryKind): boolean => kind === 'compra';
export const partyLabel = (kind: EntryKind): string => (isPurchase(kind) ? 'fornecedor' : 'cliente');

export function emptyItem(nextId: IdFactory): ItemDraft {
  return { id: nextId(), material: '', kgText: '', priceText: '', spokenMaterial: '', fromSpeech: false };
}

export function createDraft(kind: EntryKind, today: string, nextId: IdFactory): EntryDraft {
  return {
    kind,
    operationId: nextId(),
    party: null,
    items: [emptyItem(nextId)],
    attachments: [],
    spokenText: '',
    date: today,
    dueDate: today,
    invoice: '',
    note: '',
    doubts: [],
    speechFilled: [],
    invalid: [],
  };
}

export function reopenDraft(draft: EntryDraft): EntryDraft {
  return {
    ...draft,
    doubts: [],
    invalid: [],
    speechFilled: draft.speechFilled.filter((field) => !FORM_FIELDS.includes(field)),
  };
}

export const itemQuantity = (item: ItemDraft): number | null => parseDecimal(item.kgText);
export const itemPrice = (item: ItemDraft): number | null => parseDecimal(item.priceText);

export function itemTotal(item: ItemDraft): number {
  const quantity = itemQuantity(item) ?? 0;
  const price = itemPrice(item) ?? 0;
  return quantity > 0 && price > 0 ? Math.round(quantity * price * 100) / 100 : 0;
}

export function draftTotal(draft: EntryDraft): number {
  return draft.items.reduce((sum, item) => sum + itemTotal(item), 0);
}

const isBlankItem = (item: ItemDraft): boolean => !item.material && !itemQuantity(item) && !itemPrice(item);

export function hasContent(draft: EntryDraft): boolean {
  return Boolean(
    draft.party ||
      draft.attachments.length ||
      draft.spokenText.trim() ||
      draft.items.some((item) => !isBlankItem(item)),
  );
}

export function partiesFor(options: QuickOptions, kind: EntryKind): Party[] {
  return isPurchase(kind) ? options.suppliers : options.customers;
}

export function searchParties(parties: readonly Party[], term: string): Party[] {
  const key = nameKey(term);
  const words = key ? key.split(' ') : [];
  return parties
    .filter((party) => {
      const name = nameKey(party.nome);
      return words.every((word) => name.includes(word));
    })
    .slice(0, PARTY_RESULTS_LIMIT);
}

export function tablePrice(
  options: QuickOptions,
  kind: EntryKind,
  party: Party | null,
  material: string,
): number | null {
  if (!party || !material) return null;
  const tables = isPurchase(kind) ? options.supplierPrices : options.customerPrices;
  const owner = isPurchase(kind)
    ? party.cod
    : Object.keys(tables).find((name) => nameKey(name) === nameKey(party.nome));
  const table = owner ? tables[owner] : undefined;
  if (!table) return null;
  const key = Object.keys(table).find((name) => nameKey(name) === nameKey(material));
  const price = key ? table[key] : undefined;
  return typeof price === 'number' && price > 0 ? price : null;
}

export function withoutMarks(draft: EntryDraft, ...fields: string[]): EntryDraft {
  const keep = (field: string) => !fields.includes(field);
  return { ...draft, speechFilled: draft.speechFilled.filter(keep), invalid: draft.invalid.filter(keep) };
}

export function chooseParty(draft: EntryDraft, party: Party | null): EntryDraft {
  const cleared = withoutMarks(draft, PARTY_FIELD);
  return { ...cleared, party: party ? { nome: party.nome, cod: party.cod || '' } : null };
}

export function editItem(draft: EntryDraft, itemId: string, field: ItemField, value: string): EntryDraft {
  const cleared = withoutMarks(draft, itemField(itemId, field));
  const items = draft.items.map((item) => {
    if (item.id !== itemId) return item;
    if (field === 'material') return { ...item, material: value, spokenMaterial: '' };
    return field === 'kg' ? { ...item, kgText: value } : { ...item, priceText: value };
  });
  return { ...cleared, items };
}

export function applyTablePrice(draft: EntryDraft, itemId: string, price: number): EntryDraft {
  return editItem(draft, itemId, 'price', toFieldText(price));
}

export function addItem(draft: EntryDraft, nextId: IdFactory): EntryDraft {
  return { ...draft, items: [...draft.items, emptyItem(nextId)] };
}

export function removeItem(draft: EntryDraft, itemId: string, nextId: IdFactory): EntryDraft {
  const items = draft.items.filter((item) => item.id !== itemId);
  const prefix = `${itemId}:`;
  const keep = (field: string) => !field.startsWith(prefix);
  return {
    ...draft,
    items: items.length ? items : [emptyItem(nextId)],
    speechFilled: draft.speechFilled.filter(keep),
    invalid: draft.invalid.filter(keep),
  };
}

export function usableItems(result: Interpretation): InterpretedItem[] {
  return (result.itens ?? []).filter(
    (item) => item.material || item.materialFalado || item.quantidadeKg || item.precoKg,
  );
}

export function isUnderstood(result: Interpretation): boolean {
  return usableItems(result).length > 0 || Boolean(result.parte);
}

export function spokenKindOf(result: Interpretation): EntryKind | null {
  const spoken = result.tipoFalado || (result.fonte === 'ia' ? result.tipo : '');
  return spoken === 'compra' || spoken === 'venda' ? spoken : null;
}

function exampleSentence(options: QuickOptions, kind: EntryKind): string {
  const material = options.materials[0];
  if (isPurchase(kind)) {
    return `Comprei 100 quilos de ${material || 'cobre'} do ${options.suppliers[0]?.nome || 'fornecedor'} a 40 reais`;
  }
  return `Vendi 1 tonelada de ${material || 'ferro'} para ${options.customers[0]?.nome || 'o cliente'} a 2 reais`;
}

export function applyInterpretation(
  draft: EntryDraft,
  result: Interpretation,
  options: QuickOptions,
  nextId: IdFactory,
): EntryDraft {
  const doubts = (result.duvidas ?? []).filter((doubt) => !SCREEN_KIND_DOUBT.test(doubt));
  const marks = new Set(draft.speechFilled);
  let party = draft.party;
  if (result.parte) {
    const spokenName = nameKey(result.parte.nome);
    const match = partiesFor(options, draft.kind).find((option) => nameKey(option.nome) === spokenName);
    if (match) {
      party = { nome: match.nome, cod: match.cod || '' };
      marks.add(PARTY_FIELD);
    }
  } else if (!draft.party) {
    doubts.unshift(
      `Não entendi ${isPurchase(draft.kind) ? 'o fornecedor' : 'o cliente'}. Procure pelo nome abaixo.`,
    );
  }

  const spokenItems = usableItems(result);
  let items = draft.items;
  if (spokenItems.length) {
    for (const item of draft.items) {
      for (const field of ['material', 'kg', 'price'] as const) marks.delete(itemField(item.id, field));
    }
    items = spokenItems.map((spoken) => {
      const item: ItemDraft = {
        id: nextId(),
        material: spoken.material || '',
        kgText: toFieldText(spoken.quantidadeKg),
        priceText: toFieldText(spoken.precoKg),
        spokenMaterial: spoken.material ? '' : spoken.materialFalado || '',
        fromSpeech: true,
      };
      if (spoken.material) marks.add(itemField(item.id, 'material'));
      if (spoken.quantidadeKg != null) marks.add(itemField(item.id, 'kg'));
      if (spoken.precoKg != null) marks.add(itemField(item.id, 'price'));
      return item;
    });
  } else {
    if (draft.items.every((item) => item.fromSpeech || isBlankItem(item))) items = [emptyItem(nextId)];
    doubts.push(
      'Não entendi o material e o peso. Fale o nome do material como está no cadastro, ou escolha abaixo.',
    );
  }
  if (!result.parte && !spokenItems.length) {
    doubts.push(
      `Dica: fale o material, o peso, o preço e o nome. Exemplo: "${exampleSentence(options, draft.kind)}".`,
    );
  }

  let { date, dueDate, invoice, note } = draft;
  if (result.data) {
    date = result.data;
    marks.add(DATE_FIELD);
  }
  if (result.vencimento) {
    dueDate = result.vencimento;
    marks.add(DUE_DATE_FIELD);
  }
  if (result.nf && !isPurchase(draft.kind)) {
    invoice = result.nf;
    marks.add(INVOICE_FIELD);
  }
  if (result.observacao) {
    note = result.observacao;
    marks.add(NOTE_FIELD);
  }
  return {
    ...draft,
    party,
    items,
    date,
    dueDate,
    invoice,
    note,
    doubts,
    speechFilled: [...marks],
    invalid: [],
  };
}

export function validateDraft(draft: EntryDraft): Validation {
  const problems: string[] = [];
  const invalid: string[] = [];
  if (!draft.party) {
    problems.push(`Escolha ${isPurchase(draft.kind) ? 'o fornecedor' : 'o cliente'}.`);
    invalid.push(PARTY_FIELD);
  }
  draft.items.forEach((item, index) => {
    const position = index + 1;
    if (!item.material) {
      problems.push(`Escolha o material ${position}.`);
      invalid.push(itemField(item.id, 'material'));
    }
    if (!((itemQuantity(item) ?? 0) > 0)) {
      problems.push(`Informe o peso do material ${position}.`);
      invalid.push(itemField(item.id, 'kg'));
    }
    if (!((itemPrice(item) ?? 0) > 0)) {
      problems.push(`Informe o preço por kg do material ${position}.`);
      invalid.push(itemField(item.id, 'price'));
    }
  });
  if (!draft.date) problems.push('Informe a data.');
  if (draft.dueDate && draft.date && draft.dueDate < draft.date) {
    problems.push('O vencimento não pode ser antes da data.');
  }
  if (draft.attachments.some((attachment) => !attachment.ref && !attachment.failed)) {
    problems.push('Aguarde terminar de enviar as fotos.');
  }
  return { problems, invalid };
}

export function uploadedAttachments(draft: EntryDraft): AttachmentRef[] {
  return draft.attachments.flatMap((attachment) => (attachment.ref ? [attachment.ref] : []));
}

export function buildSaveBody(draft: EntryDraft): SaveBody {
  const base = {
    operationId: draft.operationId,
    data: draft.date,
    vencimento: draft.dueDate || draft.date,
    observacao: draft.note.trim(),
    textoFalado: draft.spokenText.trim(),
    itens: draft.items.map((item) => ({
      material: item.material,
      quantidadeKg: itemQuantity(item),
      precoKg: itemPrice(item),
    })),
    anexos: uploadedAttachments(draft).map((attachment) => attachment.id),
  };
  if (isPurchase(draft.kind)) return { ...base, fornecedorCod: draft.party?.cod ?? '' };
  return { ...base, cliente: draft.party?.nome ?? '', nf: draft.invoice.trim() };
}

export function isTransientSaveError(code: string, status: number): boolean {
  return TRANSIENT_SAVE_CODES.has(code) || status >= 502;
}

export function retryDelaySeconds(retryAfterSeconds: number | null, attempt: number): number {
  return Math.min(6, Math.max(2, Number(retryAfterSeconds) || attempt * 2));
}

export type EntryStatusTone = 'ok' | 'deleted' | 'open';

export function statusTone(status: string | undefined): EntryStatusTone {
  const value = String(status ?? '');
  if (/^(Pago|Recebido|Permuta)$/.test(value)) return 'ok';
  if (/Excluído/.test(value)) return 'deleted';
  return 'open';
}
