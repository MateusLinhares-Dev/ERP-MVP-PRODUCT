import type { BankOption, SaleCommit } from '../domain/sale-order.js';

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
  save(commit: SaleCommit): void;
  remove(saleId: string): boolean;
  markPaid(saleId: string): void;
  reopen(saleId: string): void;
  openLedger(client: string): void;
  openReceivables(saleId: string): void;
  printSale(saleId: string): void;
  printList(title: string, html: string): void;
  printRomaneio(ticketKey: string): void;
  archiveWeighing(ticketKey: string): void;
  notify(message: string, kind?: 'success' | 'error' | 'info'): void;
  confirm(message: string): boolean;
}
