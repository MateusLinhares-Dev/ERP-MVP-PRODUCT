import type { BankOption, SaleOrder } from '../../../../server/modules/sales/domain/sale-order.js';

export interface SaveReply {
  sale: { id: string; nf: string; total: number };
  receivables: number;
}

export interface ClientOption {
  cod: string;
  nome: string;
}

export interface SalesPort {
  canOperate: boolean;
  user: string;
  clients: ClientOption[];
  materials: string[];
  banks: BankOption[];
  banksReady: boolean;
  today(): string;
  loadBanks(): void;
  priceOf(client: string, material: string): number;
  stockOf(material: string, saleId: string): number | null;
  save(order: SaleOrder, expectedUpdate?: number): Promise<SaveReply>;
  remove(saleId: string): Promise<boolean>;
  markPaid(saleId: string): Promise<boolean>;
  reopen(saleId: string): Promise<boolean>;
  openLedger(client: string): void;
  openReceivables(saleId: string): void;
  printSale(saleId: string): void;
  printList(title: string, html: string): void;
  printRomaneio(ticketKey: string): void;
  archiveWeighing(ticketKey: string): Promise<void>;
  notify(message: string, kind?: 'success' | 'error' | 'info'): void;
  confirm(message: string): boolean;
}
