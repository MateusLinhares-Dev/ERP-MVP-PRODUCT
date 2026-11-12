import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { todayISO } from '../shared/domain/dates.js';
import { ORDER_PRINT_CSS, openPrintWindow, orderDocumentHtml } from '../shared/print/order-print.js';
import type { OrderCompany } from '../shared/print/order-print.js';
import type { BankOption, SaleOrder } from '../../server/modules/sales/domain/sale-order.js';
import { messageOf } from '../shared/domain/errors.js';

interface SaleReply {
  sale?: { id?: unknown; nf?: unknown; total?: unknown };
  receivables?: unknown[];
}
import { saleDocument } from '../modules/sales/domain/sale-document.js';
import { isRaw } from '../../server/modules/sales/domain/sales.js';
import type { Raw, SalesData } from '../../server/modules/sales/domain/sales.js';
import { SalesWorkspace } from '../modules/sales/ui/SalesWorkspace.js';
import type { SalesCommand, SalesController } from '../modules/sales/ui/SalesWorkspace.js';
import type { ClientOption, SalesPort } from '../modules/sales/ui/ports.js';
import '../modules/sales/ui/sales.css';

interface SalesSnapshot {
  sales: unknown[];
  receivables: unknown[];
  clientAdvances: Record<string, unknown[]>;
  clientCheques: Record<string, unknown[]>;
  tickets: Record<string, unknown>;
  clients: ClientOption[];
  materials: unknown[];
}

interface SalesBridge {
  snapshot(): SalesSnapshot;
  canOperate(): boolean;
  user(): string;
  banks(): { ready: boolean; list: BankOption[] };
  loadBanks(): Promise<unknown>;
  priceOf(client: string, material: string): number;
  stockOf(material: string, saleId: string): number | null;
  save(order: SaleOrder, expectedUpdate?: number): Promise<SaleReply>;
  remove(saleId: string): Promise<boolean>;
  markPaid(saleId: string): Promise<boolean>;
  reopen(saleId: string): Promise<boolean>;
  archiveWeighing(ticket: string): Promise<unknown>;
  client(name: string): Raw | null;
  company(): Omit<OrderCompany, 'logo'>;
}

interface LegacySales {
  erpSalesBridge?: SalesBridge;
  showToast?: (message: string, kind: string, duration?: number) => void;
  abrirFichaCli?: (client: string) => void;
  verCRdaVenda?: (saleId: string) => void;
  rodImprimirRomaneio?: (ticket: string) => void;
  om?: (type: string, ...rest: unknown[]) => unknown;
  switchTab?: (tab: string, ...rest: unknown[]) => unknown;
  erpCanAccessTab?: (tab: string) => boolean;
}

const TAB = 'vendas';
const LIST_CSS = `body{font-family:Arial,Helvetica,sans-serif;margin:20px;color:#151515}h1{font-size:18px;margin:0 0 12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eef2ef}.n{text-align:right;white-space:nowrap}tfoot th{background:#f4f8f5}.print-actions{text-align:center;margin:18px}.print-actions button{padding:10px 22px;border:0;border-radius:7px;background:#1a3a2a;color:#fff;font-weight:700;cursor:pointer}@media print{.print-actions{display:none}}`;

const legacy = (): LegacySales => window as unknown as LegacySales;

const rawList = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter(isRaw) : []);
const rawMap = (value: Record<string, unknown[]> | undefined): Record<string, Raw[]> => {
  const out: Record<string, Raw[]> = {};
  for (const [key, list] of Object.entries(value ?? {})) out[key] = rawList(list);
  return out;
};

function logoUrl(): string {
  try {
    return new URL('assets/branding/manuela-metais-logo.webp', window.location.href).href;
  } catch {
    return 'assets/branding/manuela-metais-logo.webp';
  }
}

export function installSales(): void {
  let handler: ((command: SalesCommand) => void) | null = null;
  const pending: SalesCommand[] = [];
  const controller: SalesController = {
    register(next) {
      handler = next;
      for (const command of pending.splice(0)) next(command);
      return () => {
        if (handler === next) handler = null;
      };
    },
  };
  let root: Root | null = null;
  let host: Element | null = null;
  let bankLoad: Promise<unknown> | null = null;

  const bridge = (): SalesBridge | undefined => legacy().erpSalesBridge;

  const notify = (message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    const toast = legacy().showToast;
    if (toast) toast(message, kind, kind === 'error' ? 8000 : 4500);
    else window.alert(message);
  };

  function data(source: SalesBridge): { data: SalesData; snapshot: SalesSnapshot } {
    const snapshot = source.snapshot();
    const tickets: Record<string, Raw> = {};
    for (const [key, ticket] of Object.entries(snapshot.tickets ?? {}))
      if (isRaw(ticket)) tickets[key] = ticket;
    return {
      snapshot,
      data: {
        sales: rawList(snapshot.sales),
        receivables: rawList(snapshot.receivables),
        clientAdvances: rawMap(snapshot.clientAdvances),
        clientCheques: rawMap(snapshot.clientCheques),
        tickets,
      },
    };
  }

  function port(source: SalesBridge, current: SalesData, snapshot: SalesSnapshot): SalesPort {
    const banks = source.banks();
    return {
      canOperate: source.canOperate(),
      user: source.user(),
      clients: snapshot.clients,
      materials: snapshot.materials.map((item) => String(item ?? '').trim()).filter(Boolean),
      banks: banks.list,
      banksReady: banks.ready,
      today: () => todayISO(),
      loadBanks: () => {
        if (bankLoad) return;
        bankLoad = source
          .loadBanks()
          .catch(() => undefined)
          .finally(() => {
            render();
            window.setTimeout(() => {
              bankLoad = null;
            }, 30_000);
          });
      },
      priceOf: (client, material) => Number(source.priceOf(client, material)) || 0,
      stockOf: (material, saleId) => {
        const value = source.stockOf(material, saleId);
        return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
      },
      save: async (order, expectedUpdate) => {
        const reply = await source.save(order, expectedUpdate);
        return {
          sale: {
            id: String(reply.sale?.id ?? ''),
            nf: String(reply.sale?.nf ?? ''),
            total: Number(reply.sale?.total ?? 0),
          },
          receivables: Array.isArray(reply.receivables) ? reply.receivables.length : 0,
        };
      },
      remove: (saleId) => source.remove(saleId),
      markPaid: (saleId) => source.markPaid(saleId),
      reopen: (saleId) => source.reopen(saleId),
      openLedger: (client) => legacy().abrirFichaCli?.(client),
      openReceivables: (saleId) => legacy().verCRdaVenda?.(saleId),
      printSale: (saleId) => {
        const sale = current.sales.find((item) => String(item.id ?? '') === saleId);
        if (!sale) return notify('Venda não encontrada.', 'error');
        const doc = saleDocument(
          current,
          sale,
          source.client(String(sale.cliente ?? '')),
          { ...source.company(), logo: logoUrl() },
          todayISO(),
          new Date().toLocaleString('pt-BR'),
        );
        if (
          !openPrintWindow(
            'Pedido de venda ' + String(sale.nf || saleId),
            orderDocumentHtml(doc),
            ORDER_PRINT_CSS,
          )
        )
          notify('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.', 'error');
      },
      printList: (title, html) => {
        if (!openPrintWindow(title, html, LIST_CSS))
          notify('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.', 'error');
      },
      printRomaneio: (ticket) => legacy().rodImprimirRomaneio?.(ticket),
      archiveWeighing: async (ticket) => {
        if (
          !window.confirm(
            'Tirar esta pesagem da fila? Use quando a venda dela já foi lançada de outro jeito.',
          )
        )
          return;
        try {
          await source.archiveWeighing(ticket);
          notify('Pesagem tirada da fila de vendas.', 'info');
        } catch (error) {
          notify(
            'Não foi possível tirar a pesagem da fila: ' + messageOf(error, 'erro desconhecido'),
            'error',
          );
        }
      },
      notify,
      confirm: (message) => window.confirm(message),
    };
  }

  function render(): void {
    const source = bridge();
    const target = document.getElementById('vendas-app');
    if (!source || !target) return;
    if (!root || host !== target) {
      target.replaceChildren();
      root = createRoot(target);
      host = target;
    }
    const current = data(source);
    root.render(
      <StrictMode>
        <SalesWorkspace
          data={current.data}
          port={port(source, current.data, current.snapshot)}
          controller={controller}
        />
      </StrictMode>,
    );
  }

  function send(command: SalesCommand): void {
    const app = legacy();
    if (app.erpCanAccessTab && !app.erpCanAccessTab(TAB)) {
      notify('Você não tem acesso a Vendas.', 'error');
      return;
    }
    if (!document.getElementById('tab-' + TAB)?.classList.contains('active')) app.switchTab?.(TAB);
    render();
    if (handler) handler(command);
    else pending.push(command);
  }

  const saleIdAt = (index: unknown): string => {
    const source = bridge();
    const position = Number(index);
    if (!source || !Number.isInteger(position)) return '';
    const sale = source.snapshot().sales[position];
    return isRaw(sale) ? String(sale.id ?? '') : '';
  };

  const previous = { om: legacy().om, switchTab: legacy().switchTab };
  Object.assign(window, {
    renderVendas: render,
    renderHistoricoVendas: render,
    erpSalesOpen: (client?: unknown) => send({ kind: 'new', client: String(client ?? '') }),
    editVenda: (index: unknown) => {
      const saleId = saleIdAt(index);
      if (saleId) send({ kind: 'edit', saleId });
      else notify('Venda não encontrada. Atualize a tela.', 'error');
    },
    verVendaDoCR: (saleId: unknown) => send({ kind: 'edit', saleId: String(saleId ?? '') }),
    vSubTab: (tab: unknown) => send({ kind: 'tab', tab: tab === 'lancar' ? 'lancamento' : 'historico' }),
    om: (type: string, ...rest: unknown[]) =>
      type === 'venda' ? send({ kind: 'new' }) : previous.om?.(type, ...rest),
    switchTab: (tab: string, ...rest: unknown[]) => {
      const result = previous.switchTab?.(tab, ...rest);
      if (tab === TAB) render();
      return result;
    },
  });
  document.addEventListener('erp:catalog-updated', render);
  document.addEventListener('erp:ready', render);
  render();
}
