import type { Raw } from '../domain/ledger.js';
import type { MovementLinks } from '../domain/statement-view.js';

export interface BankingSnapshot {
  ready: boolean;
  banks: unknown[];
  entries: unknown[];
  links: MovementLinks;
}

export interface BankingPort {
  canOperate: boolean;
  today(): string;
  companies: string[];
  companyColor(company: string): string;
  companyOf(raw: Raw): string;
  createdAt(raw: Raw): string;
  mainCompany: string;
  mainHolder: string;
  addressOf(company: string): string;
  request(payload: Record<string, unknown>): Promise<Raw>;
  notify(message: string, kind?: 'success' | 'error' | 'info'): void;
  confirm(message: string): boolean;
  reconcile(code: string): void;
  integrations(code: string): void;
  share(index: number): void;
  history(module: string, action: string, detail: string, extra: Record<string, unknown>): void;
}

export type BankingCommand =
  | { kind: 'new' }
  | { kind: 'edit'; index: number }
  | { kind: 'delete'; index: number }
  | { kind: 'statement'; code: string };

export interface BankingController {
  register(handler: (command: BankingCommand) => void): () => void;
}
