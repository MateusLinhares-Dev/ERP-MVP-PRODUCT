import type { Identity } from '../../../shared/auth/identity.js';
import type { Catalog, EntryKind, PriceTable, QuickEntry, UploadRecord } from '../domain/quick-entry.js';

export interface Clock {
  now(): number;
}

export interface IdGenerator {
  uuid(): string;
}

export interface SaleRecord {
  id: string;
  nf: string;
  data: string;
  cliente: string;
  itens: Array<{ mat: string; matBase: string; ident: string; qt: number; pr: number; total: number }>;
  subtotal: number;
  desconto: number;
  descontoTipo: string;
  descontoInput: number;
  acrescimo: number;
  total: number;
  venc: string;
  status: string;
  obs: string;
  origemLancamento: string;
  lancadoPor: string;
  anexosCelular?: QuickEntry['anexos'];
}

export interface ReceivableRecord {
  id: string;
  data: string;
  cli: string;
  nf: string;
  valor: number;
  forma: string;
  banco: string;
  venc: string;
  status: string;
  dataReceb: string;
  obs: string;
  vendaId: string;
}

export interface QuickEntryRepository {
  loadCatalog(): Promise<Catalog>;
  loadPriceTables(): Promise<{ supplierPrices: PriceTable; customerPrices: PriceTable }>;
  findEntry(key: string): Promise<QuickEntry | null>;
  listEntries(): Promise<QuickEntry[]>;
  findRecordStatus(kind: EntryKind, reference: string): Promise<{ status?: unknown } | null>;
  findPurchaseReceiptTicket(key: string): Promise<string | null>;
  listUsedTicketNumbers(): Promise<string[]>;
  findUpload(owner: string, id: string): Promise<UploadRecord | null>;
  saveUpload(record: UploadRecord): Promise<void>;
  savePurchaseEntry(entry: QuickEntry): Promise<void>;
  commitSale(sale: SaleRecord, receivable: ReceivableRecord, entry: QuickEntry, at: number): Promise<void>;
  withEntryLock<T>(key: string, work: () => Promise<T>): Promise<T>;
}

export interface AttachmentStorage {
  save(path: string, content: Buffer, contentType: string): Promise<void>;
  read(path: string): Promise<Buffer>;
}

export interface PurchaseOrderInput {
  ticketNo: string;
  fornecedorCod: string;
  operationId: string;
  ticket: Record<string, unknown>;
  advanceCodes: string[];
  chequeIds: string[];
  sourceTicketKeys: string[];
}

export interface PurchaseOrderResult {
  ticket?: { ticket?: string; totalGeral?: number };
  payable?: { id?: string } | null;
  alreadyCommitted?: boolean;
}

export interface PurchaseOrderGateway {
  create(identity: Identity, input: PurchaseOrderInput): Promise<PurchaseOrderResult>;
}

export interface SpeechInterpretationRequest {
  text: string;
  catalogs: Record<string, unknown>;
}

export interface SpeechInterpreter {
  interpret(request: SpeechInterpretationRequest): Promise<unknown>;
}
