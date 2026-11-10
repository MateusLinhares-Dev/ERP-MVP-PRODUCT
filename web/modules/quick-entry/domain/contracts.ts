export type EntryKind = 'compra' | 'venda';
export type SpokenKind = EntryKind | 'indefinido';

export interface Party {
  cod: string;
  nome: string;
}

export type PriceTable = Record<string, Record<string, number>>;

export interface QuickLimits {
  items: number;
  attachments: number;
  attachmentBytes: number;
  text: number;
}

export interface QuickOptions {
  suppliers: Party[];
  customers: Party[];
  materials: string[];
  supplierPrices: PriceTable;
  customerPrices: PriceTable;
  today: string;
  user: { login: string; admin: boolean };
  aiEnabled: boolean;
  limits?: Partial<QuickLimits>;
}

export interface InterpretedItem {
  material: string | null;
  materialFalado: string;
  quantidadeKg: number | null;
  precoKg: number | null;
}

export interface Interpretation {
  fonte: 'ia' | 'aparelho';
  tipo: SpokenKind;
  tipoFalado?: EntryKind | '';
  parte: Party | null;
  itens: InterpretedItem[];
  data: string | null;
  vencimento: string | null;
  nf: string | null;
  observacao: string | null;
  duvidas: string[];
}

export interface AttachmentRef {
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  dono: string;
}

export interface EntryItemSummary {
  material: string;
  quantidadeKg: number;
  precoKg: number;
  total: number;
}

export interface QuickEntry {
  id: string;
  tipo: EntryKind;
  referencia: string;
  parte: string;
  total: number;
  itens: EntryItemSummary[];
  data: string;
  vencimento: string;
  observacao: string;
  textoFalado: string;
  anexos: AttachmentRef[];
  criadoEm: number;
  criadoPor: string;
  nf?: string;
  situacao?: string;
}

export interface EntryResult {
  entry: QuickEntry;
  alreadyCommitted: boolean;
}

export interface HistoryResult {
  entries: QuickEntry[];
  viewAll: boolean;
}

export interface SaveLine {
  material: string;
  quantidadeKg: number | null;
  precoKg: number | null;
}

interface SaveBodyBase {
  operationId: string;
  data: string;
  vencimento: string;
  observacao: string;
  textoFalado: string;
  itens: SaveLine[];
  anexos: string[];
}

export interface PurchaseBody extends SaveBodyBase {
  fornecedorCod: string;
}

export interface SaleBody extends SaveBodyBase {
  cliente: string;
  nf: string;
}

export type SaveBody = PurchaseBody | SaleBody;

export interface AttachmentUpload {
  nome: string;
  tipo: string;
  conteudo: string;
}
