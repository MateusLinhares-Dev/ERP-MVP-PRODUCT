import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { todayISO } from '../shared/domain/dates.js';
import {
  destinationsOf,
  normalizeCheques,
  type ChequeBank,
  type Raw,
} from '../modules/cheque-control/domain/control.js';
import { ChequeControlWorkspace } from '../modules/cheque-control/ui/ChequeControlWorkspace.js';
import {
  loadKey,
  movementKey,
  type ChequeControlCommand,
  type ChequeControlController,
  type ChequeControlPort,
  type ChequeControlSnapshot,
  type LoadDiscount,
} from '../modules/cheque-control/ui/ports.js';
import '../modules/cheque-control/ui/cheque-control.css';

interface LegacyChequeData {
  ready: boolean;
  cheques: unknown;
  deleted: unknown;
  banks: unknown[];
  clients: unknown[];
  suppliers: unknown[];
  expenseSuppliers: unknown[];
  deletedSuppliers: string[];
  supplierCheques: unknown;
  advances: unknown;
  secretary: boolean;
  canBank: boolean;
}

interface LegacyChequeControl {
  erpChequeControlSnapshot?: () => LegacyChequeData;
  erpBankLedgerRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
  erpSupplierChequeRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
  editarChequesAdiantamento?: (supplierCode: string, advanceCode: string) => unknown;
  showToast?: (message: string, kind: string, duration?: number) => void;
  switchTab?: (tab: string, ...rest: unknown[]) => unknown;
  erpCanAccessTab?: (tab: string) => boolean;
  chqInit?: () => void;
}

const TAB = 'cheques_compensar';
const legacy = (): LegacyChequeControl => window as unknown as LegacyChequeControl;
const isRaw = (value: unknown): value is Raw =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown): Raw[] =>
  (Array.isArray(value) ? value : isRaw(value) ? Object.values(value) : []).filter(isRaw);
const text = (value: unknown): string => String(value ?? '').trim();

function banksOf(raw: unknown[]): ChequeBank[] {
  return raw.filter(isRaw).map((bank, index) => ({
    name: text(bank.name),
    slug: text(bank.slug),
    code: text(bank.code),
    color: text(bank.color) || '#888',
    order: Number(bank.order) || index + 1,
  }));
}

function loadDiscountsOf(raw: unknown): Map<string, LoadDiscount> {
  const result = new Map<string, LoadDiscount>();
  for (const [supplierCode, value] of Object.entries(isRaw(raw) ? raw : {})) {
    rows(value).forEach((cheque, index) => {
      const number = text(cheque.num);
      if (!number) return;
      result.set(loadKey(text(cheque.banco), number), {
        status: text(cheque.statusDesc) || 'A descontar',
        supplierCode,
        ref: text(cheque.id) || 'CHQ_' + number + '_' + supplierCode,
        index,
      });
    });
  }
  return result;
}

function advancesOf(raw: unknown): { owners: Map<string, string>; movements: Set<string> } {
  const owners = new Map<string, string>();
  const movements = new Set<string>();
  for (const [supplierCode, value] of Object.entries(isRaw(raw) ? raw : {})) {
    for (const advance of rows(value)) {
      const code = text(advance.cod);
      if (!code) continue;
      if (!owners.has(code)) owners.set(code, supplierCode);
      if (text(advance.movBancoId)) movements.add(movementKey(supplierCode, code));
    }
  }
  return { owners, movements };
}

export function installChequeControl(): void {
  let handler: ((command: ChequeControlCommand) => void) | null = null;
  const pending: ChequeControlCommand[] = [];
  const controller: ChequeControlController = {
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

  const notify = (
    message: string,
    kind: 'success' | 'error' | 'info' | 'warn' = 'success',
    duration?: number,
  ) => {
    const toast = legacy().showToast;
    if (toast) toast(message, kind, duration ?? (kind === 'error' ? 9000 : 5000));
    else window.alert(message);
  };

  function read(): LegacyChequeData | null {
    try {
      return legacy().erpChequeControlSnapshot?.() ?? null;
    } catch {
      return null;
    }
  }

  function snapshot(data: LegacyChequeData | null): ChequeControlSnapshot {
    const advances = advancesOf(data?.advances);
    return {
      ready: data?.ready === true,
      cheques: normalizeCheques(data?.cheques, data?.deleted),
      banks: banksOf(data?.banks ?? []),
      destinations: destinationsOf(
        rows(data?.clients),
        rows(data?.suppliers),
        rows(data?.expenseSuppliers),
        new Set(data?.deletedSuppliers ?? []),
      ),
      loadDiscounts: loadDiscountsOf(data?.supplierCheques),
      advanceOwners: advances.owners,
      advanceMovements: advances.movements,
    };
  }

  function port(data: LegacyChequeData | null): ChequeControlPort {
    return {
      secretary: data?.secretary === true,
      canBank: data?.canBank === true,
      today: () => todayISO(),
      request: async (payload) => {
        const send = legacy().erpBankLedgerRequest;
        if (!send) throw new Error('Controle de cheques indisponível. Atualize a página.');
        return ((await send(payload)) ?? {}) as Raw;
      },
      supplierCheque: async (payload) => {
        const send = legacy().erpSupplierChequeRequest;
        if (!send) throw new Error('Cheques de fornecedor indisponíveis. Atualize a página.');
        return ((await send(payload)) ?? {}) as Raw;
      },
      editAdvance: (supplierCode, advanceCode) => {
        void legacy().editarChequesAdiantamento?.(supplierCode, advanceCode);
      },
      notify,
      confirm: (message) => window.confirm(message),
      alert: (message) => window.alert(message),
      download: (name, content) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
    };
  }

  function render(): void {
    const target = document.getElementById('cheques-compensar-app');
    if (!target) return;
    if (!root || host !== target) {
      target.replaceChildren();
      root = createRoot(target);
      host = target;
    }
    const data = read();
    root.render(
      <StrictMode>
        <ChequeControlWorkspace snapshot={snapshot(data)} port={port(data)} controller={controller} />
      </StrictMode>,
    );
  }

  function send(command: ChequeControlCommand): void {
    const app = legacy();
    if (app.erpCanAccessTab && !app.erpCanAccessTab(TAB))
      return notify('Você não tem acesso ao controle de cheques.', 'error');
    app.chqInit?.();
    render();
    if (handler) handler(command);
    else pending.push(command);
  }

  const previous = { switchTab: legacy().switchTab };
  Object.assign(window, {
    renderChequesCompensar: render,
    chqNovo: () => send({ kind: 'new' }),
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
