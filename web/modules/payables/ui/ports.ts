export interface PayableBank {
  cod: string;
  label: string;
  company: string;
}

export type PayableCommand = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'delete'; id: string };

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
  pay(id: string): void;
  history(id: string): void;
  notify(message: string, kind?: 'success' | 'error' | 'info'): void;
  confirm(message: string): boolean;
}
