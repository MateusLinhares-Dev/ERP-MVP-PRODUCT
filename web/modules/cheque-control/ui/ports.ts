import type { ChequeBank, ControlCheque, Destination, Raw } from '../domain/control.js';

export interface LoadDiscount {
  status: string;
  supplierCode: string;
  ref: string;
  index: number;
}

export interface ChequeControlSnapshot {
  ready: boolean;
  cheques: ControlCheque[];
  banks: ChequeBank[];
  destinations: Destination[];
  loadDiscounts: Map<string, LoadDiscount>;
  advanceOwners: Map<string, string>;
  advanceMovements: Set<string>;
}

export interface ChequeControlPort {
  secretary: boolean;
  canBank: boolean;
  today(): string;
  request(payload: Record<string, unknown>): Promise<Raw>;
  supplierCheque(payload: Record<string, unknown>): Promise<Raw>;
  editAdvance(supplierCode: string, advanceCode: string): void;
  notify(message: string, kind?: 'success' | 'error' | 'info' | 'warn', duration?: number): void;
  confirm(message: string): boolean;
  alert(message: string): void;
  download(name: string, content: string): void;
}

export type ChequeControlCommand = { kind: 'new'; bank?: string; number?: string };

export interface ChequeControlController {
  register(handler: (command: ChequeControlCommand) => void): () => void;
}

export const loadKey = (bank: string, number: string): string => bank + '|' + number;
export const movementKey = (supplierCode: string, advanceCode: string): string =>
  supplierCode + '|' + advanceCode;
