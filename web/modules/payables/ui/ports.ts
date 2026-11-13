import type { Outcome } from '../application/payments.js';
import type { PaymentContext } from '../domain/payment.js';
import type { PayableRow } from '../domain/payables.js';

export interface PayableBank {
  cod: string;
  label: string;
  company: string;
}

export type PayableCommand =
  | { kind: 'new' }
  | { kind: 'edit'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'pay'; id: string }
  | { kind: 'history'; id: string };

export interface PaymentPort {
  context(id: string): PaymentContext;
  operation(id: string): string;
  blockedSeconds(id: string): number;
  submit(payload: Record<string, unknown>): Promise<Outcome>;
  verify(id: string, operationId: string): Promise<Outcome>;
  reverse(row: PayableRow, index: number): Promise<string>;
}

export interface PayablesController {
  register(handler: (command: PayableCommand) => void): () => void;
}

export interface PayablesPort {
  canOperate: boolean;
  today(): string;
  companies: string[];
  companyColor(company: string): string;
  banks: PayableBank[];
  banksReady: boolean;
  loadBanks(): void;
  suppliers(kind: 'compra' | 'despesa'): string[];
  categories: string[];
  request(payload: Record<string, unknown>): Promise<unknown>;
  payment: PaymentPort;
  notify(message: string, kind?: 'success' | 'error' | 'info'): void;
  confirm(message: string): boolean;
}
