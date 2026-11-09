import type { Identity } from '../../../shared/auth/identity.js';
import { businessTodayISO, isIsoDate, isoToBrazilianDate } from '../../../shared/domain/business-date.js';
import { asErrorLike, fail } from '../../../shared/errors/app-error.js';
import {
  ATTACHMENT_EXTENSIONS,
  QUICK_LIMITS,
  centsToMoney,
  cleanLine,
  cleanText,
  detectAttachmentType,
  normalizeName,
  parseEntryLines,
  situationOf,
  summarize,
  totalCentsOf,
  type AttachmentRef,
  type Catalog,
  type EntryLine,
  type PriceTable,
  type QuickEntry,
} from '../domain/quick-entry.js';
import { bumpTicket, nextTicketNumber } from '../domain/ticket-number.js';
import { sanitizeInterpretation, type SpeechInterpretation } from '../domain/speech-interpretation.js';
import type {
  AttachmentStorage,
  Clock,
  IdGenerator,
  PurchaseOrderGateway,
  PurchaseOrderResult,
  QuickEntryRepository,
  ReceivableRecord,
  SaleRecord,
  SpeechInterpreter,
} from './ports.js';

export interface QuickEntryDependencies {
  repository: QuickEntryRepository;
  storage: AttachmentStorage;
  purchases: PurchaseOrderGateway;
  interpreter: SpeechInterpreter | null;
  clock: Clock;
  ids: IdGenerator;
}

export interface QuickEntryOptions extends Catalog {
  supplierPrices: PriceTable;
  customerPrices: PriceTable;
  today: string;
  user: { login: string; admin: boolean };
  aiEnabled: boolean;
  limits: typeof QUICK_LIMITS;
}

export interface EntryResult {
  entry: QuickEntry;
  alreadyCommitted: boolean;
}

export interface AttachmentFile {
  buffer: Buffer;
  tipo: string;
  nome: string;
}

type Input = Record<string, unknown>;

const OPERATION_ID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const SAFE_KEY = /^[\w-]{1,80}$/;
const ATTACHMENT_ID = /^[\w-]{1,60}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_TICKET_ATTEMPTS = 8;

export class QuickEntryService {
  constructor(private readonly deps: QuickEntryDependencies) {}

  async options(identity: Identity): Promise<QuickEntryOptions> {
    assertQuickEntryAccess(identity);
    const [catalog, prices] = await Promise.all([
      this.deps.repository.loadCatalog(),
      this.deps.repository.loadPriceTables(),
    ]);
    return {
      ...catalog,
      ...prices,
      today: businessTodayISO(this.deps.clock.now()),
      user: { login: cleanLine(identity.erpUser, 80), admin: identity.admin === true },
      aiEnabled: this.deps.interpreter !== null,
      limits: QUICK_LIMITS,
    };
  }

  async createPurchase(identity: Identity, rawInput: unknown): Promise<EntryResult> {
    assertQuickEntryAccess(identity);
    const input = requireObject(rawInput);
    const operationId = operationIdOf(input);
    const key = entryKey(identity, operationId);
    const existing = await this.deps.repository.findEntry(key);
    if (existing) return reuse(existing, 'compra');
    const today = businessTodayISO(this.deps.clock.now());
    const date = isoDate(input.data, today, 'Data da compra');
    const due = isoDate(input.vencimento, date, 'Data de vencimento');
    if (due < date) fail(422, 'INVALID_DUE_DATE', 'O vencimento não pode ser antes da data da compra.');
    const notes = cleanText(input.observacao, 1000);
    const spoken = cleanText(input.textoFalado, QUICK_LIMITS.text);
    const catalog = await this.deps.repository.loadCatalog();
    const supplierCode = cleanLine(input.fornecedorCod, 80);
    const supplier = catalog.suppliers.find((row) => row.cod === supplierCode);
    if (!supplier) fail(422, 'SUPPLIER_NOT_FOUND', 'Escolha um fornecedor da lista.');
    const lines = parseEntryLines(input.itens, catalog.materials);
    const attachments = await this.reserveAttachments(identity, input.anexos);

    return this.deps.repository.withEntryLock(key, async () => {
      const again = await this.deps.repository.findEntry(key);
      if (again) return { entry: again, alreadyCommitted: true };
      const order = await this.createPurchaseOrder(identity, {
        key,
        operationId,
        supplier,
        lines,
        date,
        due,
        notes,
        attachments,
      });
      const saved = order.result.ticket ?? {};
      const entry: QuickEntry = {
        id: key,
        tipo: 'compra',
        referencia: String(saved.ticket || order.ticketNo),
        parte: supplier.nome,
        parteCod: supplier.cod,
        total: Number(saved.totalGeral) || centsToMoney(totalCentsOf(lines)),
        itens: summarize(lines),
        data: date,
        vencimento: due,
        observacao: notes,
        textoFalado: spoken,
        anexos: attachments,
        contaPagar: order.result.payable?.id || '',
        criadoEm: this.deps.clock.now(),
        criadoPor: cleanLine(identity.erpUser, 80),
      };
      await this.deps.repository.savePurchaseEntry(entry);
      return { entry, alreadyCommitted: Boolean(order.result.alreadyCommitted) };
    });
  }

  async createSale(identity: Identity, rawInput: unknown): Promise<EntryResult> {
    assertQuickEntryAccess(identity);
    const input = requireObject(rawInput);
    const operationId = operationIdOf(input);
    const key = entryKey(identity, operationId);
    const existing = await this.deps.repository.findEntry(key);
    if (existing) return reuse(existing, 'venda');
    const today = businessTodayISO(this.deps.clock.now());
    const date = isoDate(input.data, today, 'Data da venda');
    const due = isoDate(input.vencimento, date, 'Data de vencimento');
    if (due < date) fail(422, 'INVALID_DUE_DATE', 'O vencimento não pode ser antes da data da venda.');
    const notes = cleanText(input.observacao, 1000);
    const invoice = cleanLine(input.nf, 40);
    const spoken = cleanText(input.textoFalado, QUICK_LIMITS.text);
    const catalog = await this.deps.repository.loadCatalog();
    const customer = catalog.customers.find(
      (row) => normalizeName(row.nome) === normalizeName(input.cliente),
    );
    if (!customer) {
      fail(
        422,
        'CUSTOMER_NOT_FOUND',
        'Escolha um cliente da lista. Cliente novo precisa ser cadastrado no ERP.',
      );
    }
    const lines = parseEntryLines(input.itens, catalog.materials);
    const attachments = await this.reserveAttachments(identity, input.anexos);

    return this.deps.repository.withEntryLock(key, async () => {
      const again = await this.deps.repository.findEntry(key);
      if (again) return { entry: again, alreadyCommitted: true };
      const at = this.deps.clock.now();
      const suffix = this.deps.ids.uuid().replace(/-/g, '').slice(0, 6).toUpperCase();
      const saleId = `VD-${at}-${suffix}`;
      const receivableId = `CR${at.toString(36)}${suffix.toLowerCase()}`;
      const total = centsToMoney(totalCentsOf(lines));
      const dateBR = isoToBrazilianDate(date);
      const dueBR = isoToBrazilianDate(due);
      const sale: SaleRecord = {
        id: saleId,
        nf: invoice,
        data: dateBR,
        cliente: customer.nome,
        itens: lines.map((line) => ({
          mat: line.material,
          matBase: line.material,
          ident: '',
          qt: line.quantity,
          pr: line.unitPrice,
          total: centsToMoney(line.totalCents),
        })),
        subtotal: total,
        desconto: 0,
        descontoTipo: 'R$',
        descontoInput: 0,
        acrescimo: 0,
        total,
        venc: dueBR,
        status: 'Pendente',
        obs: notes,
        origemLancamento: 'celular',
        lancadoPor: cleanLine(identity.erpUser, 80),
        ...(attachments.length ? { anexosCelular: attachments } : {}),
      };
      const receivable: ReceivableRecord = {
        id: receivableId,
        data: dateBR,
        cli: customer.nome,
        nf: invoice,
        valor: total,
        forma: '—',
        banco: '—',
        venc: dueBR,
        status: 'Pendente',
        dataReceb: '',
        obs: `Venda lançada pelo celular${invoice ? ` – NF ${invoice}` : ''}`,
        vendaId: saleId,
      };
      const entry: QuickEntry = {
        id: key,
        tipo: 'venda',
        referencia: saleId,
        parte: customer.nome,
        parteCod: customer.cod,
        total,
        itens: summarize(lines),
        data: date,
        vencimento: due,
        nf: invoice,
        observacao: notes,
        textoFalado: spoken,
        anexos: attachments,
        contaReceber: receivableId,
        criadoEm: at,
        criadoPor: cleanLine(identity.erpUser, 80),
      };
      await this.deps.repository.commitSale(sale, receivable, entry, at);
      return { entry, alreadyCommitted: false };
    });
  }

  async listEntries(identity: Identity, limit = 60): Promise<{ entries: QuickEntry[]; viewAll: boolean }> {
    assertQuickEntryAccess(identity);
    const viewAll = identity.admin === true;
    const login = cleanLine(identity.erpUser, 80);
    const entries = (await this.deps.repository.listEntries())
      .filter((entry) => viewAll || entry.criadoPor === login)
      .sort((a, b) => Number(b.criadoEm || 0) - Number(a.criadoEm || 0))
      .slice(0, limit);
    await Promise.all(
      entries.map(async (entry) => {
        const reference = String(entry.referencia || '');
        entry.situacao = SAFE_KEY.test(reference)
          ? situationOf(entry.tipo, await this.deps.repository.findRecordStatus(entry.tipo, reference))
          : '—';
      }),
    );
    return { entries, viewAll };
  }

  async uploadAttachment(identity: Identity, rawInput: unknown): Promise<{ anexo: AttachmentRef }> {
    assertQuickEntryAccess(identity);
    const input = requireObject(rawInput, 'Arquivo inválido.');
    const declared = cleanLine(input.tipo, 40);
    const extension = ATTACHMENT_EXTENSIONS[declared];
    if (!extension) fail(415, 'UNSUPPORTED_FILE', 'Envie foto (JPG/PNG) ou PDF.');
    const content = String(input.conteudo ?? '');
    const maxEncoded = Math.ceil((QUICK_LIMITS.attachmentBytes * 4) / 3) + 8;
    if (!content || content.length > maxEncoded || !BASE64.test(content)) {
      fail(413, 'FILE_TOO_LARGE', 'Arquivo inválido ou maior que 3 MB.');
    }
    const buffer = Buffer.from(content, 'base64');
    if (!buffer.length || buffer.length > QUICK_LIMITS.attachmentBytes) {
      fail(413, 'FILE_TOO_LARGE', 'O arquivo precisa ter até 3 MB.');
    }
    if (detectAttachmentType(buffer) !== declared) {
      fail(415, 'UNSUPPORTED_FILE', 'O conteúdo do arquivo não corresponde a uma foto JPG/PNG ou PDF.');
    }
    const owner = ownerKey(identity);
    const now = this.deps.clock.now();
    const id = `AX${now.toString(36)}${this.deps.ids.uuid().replace(/-/g, '').slice(0, 10)}`;
    const path = attachmentPath(owner, id, declared);
    const name = cleanLine(input.nome, 120).replace(/[\\/]/g, '_') || `anexo.${extension}`;
    await this.deps.storage.save(path, buffer, declared);
    const record = {
      id,
      nome: name,
      tipo: declared,
      tamanho: buffer.length,
      caminho: path,
      dono: owner,
      criadoEm: now,
    };
    await this.deps.repository.saveUpload(record);
    return { anexo: { id, nome: name, tipo: declared, tamanho: buffer.length, dono: owner } };
  }

  async readAttachment(identity: Identity, owner: string, id: string): Promise<AttachmentFile> {
    assertQuickEntryAccess(identity);
    const cleanOwner = cleanLine(owner, 80);
    const cleanId = cleanLine(id, 60);
    if (!SAFE_KEY.test(cleanOwner) || !ATTACHMENT_ID.test(cleanId))
      fail(422, 'INVALID_ATTACHMENT', 'Anexo inválido.');
    if (identity.admin !== true && cleanOwner !== ownerKey(identity)) {
      fail(403, 'ATTACHMENT_FORBIDDEN', 'Este anexo pertence a outro usuário.');
    }
    const record = await this.deps.repository.findUpload(cleanOwner, cleanId);
    if (!record?.caminho || record.caminho !== attachmentPath(cleanOwner, cleanId, record.tipo)) {
      fail(404, 'ATTACHMENT_NOT_FOUND', 'Anexo não encontrado.');
    }
    const buffer = await this.deps.storage.read(record.caminho);
    return {
      buffer,
      tipo: ATTACHMENT_EXTENSIONS[record.tipo] ? record.tipo : 'application/octet-stream',
      nome: cleanLine(record.nome, 120) || cleanId,
    };
  }

  async interpretSpeech(identity: Identity, rawInput: unknown): Promise<SpeechInterpretation> {
    assertQuickEntryAccess(identity);
    const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Input;
    const text = String(input.texto ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) fail(422, 'EMPTY_TEXT', 'Fale ou digite o lançamento antes de pedir para preencher.');
    if (text.length > QUICK_LIMITS.text) {
      fail(422, 'TEXT_TOO_LONG', 'Fale um lançamento de cada vez (texto muito longo).');
    }
    const hint = input.tipo === 'compra' || input.tipo === 'venda' ? input.tipo : '';
    const interpreter = this.deps.interpreter;
    if (!interpreter) {
      fail(
        503,
        'AI_NOT_CONFIGURED',
        'Interpretação por IA não configurada; usando o interpretador do aparelho.',
      );
    }
    const catalog = await this.deps.repository.loadCatalog();
    const raw = await interpreter.interpret({
      text,
      catalogs: {
        hoje: businessTodayISO(this.deps.clock.now()),
        tipoEscolhidoNaTela: hint || 'não escolhido',
        materiais: catalog.materials,
        ...(hint !== 'venda' ? { fornecedores: catalog.suppliers.map((row) => row.nome) } : {}),
        ...(hint !== 'compra' ? { clientes: catalog.customers.map((row) => row.nome) } : {}),
      },
    });
    return sanitizeInterpretation(raw, catalog, hint);
  }

  private async reserveAttachments(identity: Identity, raw: unknown): Promise<AttachmentRef[]> {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.length > QUICK_LIMITS.attachments) {
      fail(422, 'TOO_MANY_ATTACHMENTS', `Máximo de ${QUICK_LIMITS.attachments} anexos por lançamento.`);
    }
    const owner = ownerKey(identity);
    const ids = [...new Set(raw.map((id) => cleanLine(id, 60)))];
    const records = await Promise.all(
      ids.map(async (id) => {
        if (!ATTACHMENT_ID.test(id)) fail(422, 'INVALID_ATTACHMENT', 'Anexo inválido.');
        const record = await this.deps.repository.findUpload(owner, id);
        if (!record) {
          fail(409, 'ATTACHMENT_NOT_FOUND', 'Um dos anexos não foi encontrado. Envie o arquivo novamente.');
        }
        return record;
      }),
    );
    return records.map((row) => ({
      id: cleanLine(row.id, 60),
      nome: cleanLine(row.nome, 120),
      tipo: cleanLine(row.tipo, 40),
      tamanho: Number(row.tamanho) || 0,
      dono: owner,
    }));
  }

  private async createPurchaseOrder(
    identity: Identity,
    order: PurchaseDraft,
  ): Promise<{ result: PurchaseOrderResult; ticketNo: string }> {
    const receiptTicket = await this.deps.repository.findPurchaseReceiptTicket(order.key);
    let ticketNo = receiptTicket || nextTicketNumber(await this.deps.repository.listUsedTicketNumbers());
    const purchaser: Identity = { ...identity, canPurchasing: true };
    for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.deps.purchases.create(purchaser, {
          ticketNo,
          fornecedorCod: order.supplier.cod,
          operationId: order.operationId,
          ticket: purchaseTicket(identity, ticketNo, order),
          advanceCodes: [],
          chequeIds: [],
          sourceTicketKeys: [],
        });
        return { result, ticketNo };
      } catch (error) {
        if (asErrorLike(error).code !== 'TICKET_EXISTS' || receiptTicket) throw error;
        ticketNo = bumpTicket(ticketNo);
      }
    }
    return fail(
      409,
      'TICKET_NUMBER_UNAVAILABLE',
      'Não foi possível reservar um número de compra. Tente novamente.',
    );
  }
}

interface PurchaseDraft {
  key: string;
  operationId: string;
  supplier: { cod: string; nome: string };
  lines: EntryLine[];
  date: string;
  due: string;
  notes: string;
  attachments: AttachmentRef[];
}

function purchaseTicket(identity: Identity, ticketNo: string, order: PurchaseDraft): Record<string, unknown> {
  const total = centsToMoney(totalCentsOf(order.lines));
  const ticket: Record<string, unknown> = {
    ticket: ticketNo,
    numeroPedido: ticketNo,
    data: order.date,
    dataCompra: order.date,
    vencimentoSaldo: order.due,
    fornecedor: order.supplier.nome,
    fornecedorNome: order.supplier.nome,
    fornecedorCod: order.supplier.cod,
    itens: order.lines.map((line) => ({
      mat: line.material,
      matBase: line.material,
      ident: '',
      descricaoDetalhada: '',
      descricao: '',
      obs: '',
      unidade: 'kg',
      quantidade: line.quantity,
      pesoBruto: line.quantity,
      pesoLiq: line.quantity,
      preco: line.unitPrice,
      subtotal: centsToMoney(line.totalCents),
      total: centsToMoney(line.totalCents),
    })),
    totalKg: Math.round(order.lines.reduce((sum, line) => sum + line.quantity, 0) * 1000) / 1000,
    totalProdutos: total,
    totalGeral: total,
    descontoCompra: 0,
    freteCompra: 0,
    acrescimo: 0,
    acrescimos: [],
    adiantamento: 0,
    saldoPagar: total,
    status: 'Pendente',
    ordemCompra: '',
    observacoesPedido: order.notes,
    _balFinalizado: false,
    _consolidado: true,
    _purchaseOperationId: order.operationId,
    pedidoCompra: {
      versao: 1,
      numero: ticketNo,
      ordemCompra: '',
      dataCompra: order.date,
      vencimentoSaldo: order.due,
      observacoes: order.notes,
      desconto: 0,
      frete: 0,
      totalProdutos: total,
      totalPedido: total,
    },
    origemLancamento: 'celular',
    lancadoPor: cleanLine(identity.erpUser, 80),
  };
  if (order.attachments.length) ticket.anexosCelular = order.attachments;
  return ticket;
}

export function assertQuickEntryAccess(identity: Identity | null | undefined): asserts identity is Identity {
  if (identity?.erpAccess !== true || (identity.canQuickEntry !== true && identity.admin !== true)) {
    fail(
      403,
      'QUICK_ENTRY_FORBIDDEN',
      'Seu usuário não tem acesso ao Lançamento rápido. Peça para liberar em Usuários e entre novamente.',
    );
  }
}

function requireObject(raw: unknown, message = 'Dados inválidos.'): Input {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(400, 'INVALID_INPUT', message);
  return raw as Input;
}

function reuse(existing: QuickEntry, kind: QuickEntry['tipo']): EntryResult {
  if (existing.tipo !== kind)
    fail(409, 'OPERATION_REUSED', 'Esta operação já foi usada em outro lançamento.');
  return { entry: existing, alreadyCommitted: true };
}

function ownerKey(identity: Identity): string {
  const key = String(identity.erpUser || identity.uid || '')
    .replace(/[^\w-]/g, '_')
    .slice(0, 80);
  if (!key) fail(403, 'QUICK_ENTRY_FORBIDDEN', 'Sessão sem usuário identificado.');
  return key;
}

function operationIdOf(input: Input): string {
  const id = cleanLine(input.operationId, 40);
  if (!OPERATION_ID.test(id))
    fail(422, 'INVALID_OPERATION', 'Identificador da operação inválido. Recarregue a página.');
  return id;
}

function entryKey(identity: Identity, operationId: string): string {
  const actor = String(identity.uid || identity.erpUser || 'operador').replace(/[^\w-]/g, '_');
  if (!SAFE_KEY.test(actor)) fail(403, 'QUICK_ENTRY_FORBIDDEN', 'Sessão sem usuário identificado.');
  return `${actor}_${operationId}`;
}

function isoDate(value: unknown, fallback: string, label: string): string {
  const text = cleanLine(value, 10) || fallback;
  if (!isIsoDate(text)) fail(422, 'INVALID_DATE', `${label} inválida.`);
  return text;
}

function attachmentPath(owner: string, id: string, type: string): string {
  return `lancamento-rapido/${owner}/${id}.${ATTACHMENT_EXTENSIONS[type] ?? ''}`;
}
