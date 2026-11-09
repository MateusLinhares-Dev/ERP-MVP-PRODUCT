import type { App } from 'firebase-admin/app';
import type { Database } from 'firebase-admin/database';
import { fail, errorMessage } from '../../../shared/errors/app-error.js';
import { acquireLease, releaseLease } from '../../../shared/firebase/rtdb-transaction.js';
import { supplierOptions, supplierTombstones } from '../../suppliers/domain/supplier-directory.js';
import {
  cleanLine,
  normalizeName,
  type Catalog,
  type EntryKind,
  type Party,
  type PriceTable,
  type QuickEntry,
  type UploadRecord,
} from '../domain/quick-entry.js';
import type {
  Clock,
  IdGenerator,
  QuickEntryRepository,
  ReceivableRecord,
  SaleRecord,
} from '../application/ports.js';

export type ChildKeyReader = (db: Database, path: string) => Promise<string[]>;

interface CustomerRecord {
  cod?: unknown;
  nome?: unknown;
  id?: unknown;
  ativo?: unknown;
  excluido?: unknown;
}

const ENTRY_LOCK_TTL_MS = 90000;

function objectRows(raw: unknown): Array<[string, Record<string, unknown>]> {
  return Object.entries(raw && typeof raw === 'object' ? raw : {}).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1]),
  );
}

function priceTable(raw: unknown): PriceTable {
  const table: PriceTable = {};
  for (const [owner, prices] of objectRows(raw)) {
    const row: Record<string, number> = {};
    for (const [material, price] of Object.entries(prices)) {
      const value = Number(price);
      if (!material.startsWith('_') && Number.isFinite(value) && value > 0) {
        row[material] = Math.round(value * 10000) / 10000;
      }
    }
    if (Object.keys(row).length) table[owner] = row;
  }
  return table;
}

function customersFrom(raw: unknown, deleted: ReadonlySet<string>): Party[] {
  const byName = new Map<string, Party>();
  for (const [key, row] of objectRows(raw)) {
    const customer = row as CustomerRecord;
    const nome = cleanLine(customer.nome, 240);
    const id = cleanLine(customer.id || key, 120);
    const removed = deleted.has(id) || deleted.has(key) || deleted.has(cleanLine(customer.cod));
    if (!nome || customer.ativo === false || customer.excluido === true || removed) continue;
    const normalized = normalizeName(nome);
    if (!byName.has(normalized)) byName.set(normalized, { cod: cleanLine(customer.cod, 60), nome });
  }
  return [...byName.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

function materialsFrom(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : Object.values(raw && typeof raw === 'object' ? raw : {});
  const seen = new Map<string, string>();
  for (const item of list) {
    const value =
      typeof item === 'string'
        ? item
        : (item as { nome?: unknown; mat?: unknown })?.nome || (item as { mat?: unknown })?.mat;
    const name = cleanLine(value, 120);
    if (name && !seen.has(normalizeName(name))) seen.set(normalizeName(name), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export const shallowChildKeys: ChildKeyReader = async (db, path) => {
  const emulator = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  try {
    const base = new URL(String((db.app as unknown as App).options.databaseURL ?? ''));
    let url: string;
    let authorization: string;
    if (emulator) {
      const namespace = base.searchParams.get('ns') || base.hostname.split('.')[0] || '';
      url = `http://${emulator}/${path}.json?shallow=true&ns=${encodeURIComponent(namespace)}`;
      authorization = 'Bearer owner';
    } else {
      const credential = (db.app as unknown as App).options.credential;
      if (!credential) throw new Error('Credencial ausente.');
      url = `${base.origin}/${path}.json?shallow=true`;
      authorization = `Bearer ${(await credential.getAccessToken()).access_token}`;
    }
    const response = await fetch(url, { headers: { Authorization: authorization } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Object.keys(((await response.json()) as Record<string, unknown> | null) ?? {});
  } catch (error) {
    console.warn('quick.entry.shallow_keys_fallback', { path, reason: errorMessage(error) });
    return Object.keys(((await db.ref(path).get()).val() as Record<string, unknown> | null) ?? {});
  }
};

export class RtdbQuickEntryRepository implements QuickEntryRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly childKeys: ChildKeyReader = shallowChildKeys,
  ) {}

  private async read<T = unknown>(path: string): Promise<T | null> {
    return (await this.db.ref(path).get()).val() as T | null;
  }

  async loadCatalog(): Promise<Catalog> {
    const paths = [
      'erp/fornecedores',
      'erp/fornDeleted',
      'erp/fornDeletedV2',
      'erp/fornecedoresDeleted',
      'erp/fornecedoresDeletedV2',
      'erp/clientes',
      'erp/clientesDeleted',
      'erp/metais',
    ];
    const [
      suppliers,
      fornDeleted,
      fornDeletedV2,
      suppliersDeleted,
      suppliersDeletedV2,
      customers,
      customersDeleted,
      materials,
    ] = await Promise.all(paths.map((path) => this.read(path)));
    const deletedCodes = new Set([...supplierTombstones(fornDeleted), ...supplierTombstones(fornDeletedV2)]);
    const deletedIds = new Set([
      ...supplierTombstones(suppliersDeleted),
      ...supplierTombstones(suppliersDeletedV2),
    ]);
    return {
      suppliers: supplierOptions(suppliers, deletedCodes, deletedIds),
      customers: customersFrom(customers, supplierTombstones(customersDeleted)),
      materials: materialsFrom(materials),
    };
  }

  async loadPriceTables(): Promise<{ supplierPrices: PriceTable; customerPrices: PriceTable }> {
    const [supplierPrices, customerPrices] = await Promise.all([
      this.read('erp/precosForn'),
      this.read('erp/precosCli'),
    ]);
    return { supplierPrices: priceTable(supplierPrices), customerPrices: priceTable(customerPrices) };
  }

  findEntry(key: string): Promise<QuickEntry | null> {
    return this.read<QuickEntry>(`erp/quickEntries/${key}`);
  }

  async listEntries(): Promise<QuickEntry[]> {
    const all = (await this.read<Record<string, QuickEntry>>('erp/quickEntries')) ?? {};
    return Object.values(all).filter((entry) => entry && typeof entry === 'object');
  }

  findRecordStatus(kind: EntryKind, reference: string): Promise<{ status?: unknown } | null> {
    return this.read(`${kind === 'compra' ? 'erp/tickets/' : 'erp/vendas/'}${reference}`);
  }

  async findPurchaseReceiptTicket(key: string): Promise<string | null> {
    const receipt = await this.read<{ ticket?: { ticket?: unknown } }>(`erp/purchaseCreateOperations/${key}`);
    return receipt?.ticket?.ticket ? String(receipt.ticket.ticket) : null;
  }

  async listUsedTicketNumbers(): Promise<string[]> {
    const [tickets, deletedV2, legacyDeleted] = await Promise.all([
      this.childKeys(this.db, 'erp/tickets'),
      this.read<Record<string, unknown>>('erp/ticketsDeletedV2'),
      this.read<unknown>('erp/ticketsDeleted'),
    ]);
    const legacy = Array.isArray(legacyDeleted)
      ? legacyDeleted.map(String)
      : Object.values(legacyDeleted && typeof legacyDeleted === 'object' ? legacyDeleted : {}).map(String);
    return [...tickets, ...Object.keys(deletedV2 ?? {}), ...legacy];
  }

  findUpload(owner: string, id: string): Promise<UploadRecord | null> {
    return this.read<UploadRecord>(`erp/quickUploads/${owner}/${id}`);
  }

  async saveUpload(record: UploadRecord): Promise<void> {
    await this.db.ref(`erp/quickUploads/${record.dono}/${record.id}`).set(record);
  }

  async savePurchaseEntry(entry: QuickEntry): Promise<void> {
    const updates: Record<string, unknown> = { [`erp/quickEntries/${entry.id}`]: entry };
    for (const file of entry.anexos)
      updates[`erp/quickUploads/${file.dono}/${file.id}/lancamento`] = entry.id;
    await this.db.ref().update(updates);
  }

  async commitSale(
    sale: SaleRecord,
    receivable: ReceivableRecord,
    entry: QuickEntry,
    at: number,
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      [`erp/vendas/${sale.id}`]: sale,
      [`erp/contasReceber/${receivable.id}`]: receivable,
      [`erp/quickEntries/${entry.id}`]: entry,
      'erp/_ts': at,
    };
    for (const file of entry.anexos)
      updates[`erp/quickUploads/${file.dono}/${file.id}/lancamento`] = entry.id;
    await this.db.ref().update(updates);
  }

  async withEntryLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const ref = this.db.ref(`erpQuickLocks/${key}`);
    const owner = this.ids.uuid();
    const now = (): number => this.clock.now();
    if (!(await acquireLease(ref, owner, { now, ttlMs: ENTRY_LOCK_TTL_MS, meta: { kind: 'quick-entry' } }))) {
      fail(
        409,
        'QUICK_ENTRY_IN_PROGRESS',
        'Este lançamento já está sendo gravado. Aguarde alguns segundos e confira em "Meus lançamentos".',
        { retryAfterSeconds: 5 },
      );
    }
    try {
      return await work();
    } finally {
      await releaseLease(ref, owner, { label: 'quick.entry.lock.release' });
    }
  }
}
