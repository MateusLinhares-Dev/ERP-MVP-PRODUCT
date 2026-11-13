export interface BankChoice {
  cod: string;
  label: string;
}

export type ReceivableCommand =
  | { kind: 'new'; client?: string }
  | { kind: 'edit'; id: string }
  | { kind: 'receive'; id: string };

export interface ReceivablesController {
  register(handler: (command: ReceivableCommand) => void): () => void;
}

export interface ReceivablesPort {
  canOperate: boolean;
  today(): string;
  clients: string[];
  banks: BankChoice[];
  banksReady: boolean;
  loadBanks(): void;
  request(payload: Record<string, unknown>): Promise<unknown>;
  registerClient(name: string): Promise<void>;
  openSale(saleId: string): void;
  openFiscal(id: string): void;
  notify(message: string, kind?: 'success' | 'error' | 'info'): void;
  confirm(message: string): boolean;
}
