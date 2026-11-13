import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { todayISO } from '../shared/domain/dates.js';
import { receivableRows } from '../modules/receivables/domain/receivables.js';
import { removeReceivable, reopenReceivable } from '../modules/receivables/ui/actions.js';
import { ReceivablesWorkspace } from '../modules/receivables/ui/ReceivablesWorkspace.js';
import type {
  BankChoice,
  ReceivableCommand,
  ReceivablesController,
  ReceivablesPort,
} from '../modules/receivables/ui/ports.js';
import '../modules/receivables/ui/receivables.css';

interface LegacyReceivables {
  erpReceivablesList?: () => unknown[];
  erpReceivablesRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
  erpCustomersList?: () => unknown[];
  erpCustomerRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
  erpBanks?: { snapshot(): { ready: boolean; list: BankChoice[] }; load(): Promise<unknown> };
  _usuarioPodeOperarModulo?: (tab: string) => boolean;
  verVendaDoCR?: (saleId: string) => void;
  phase3ReceivableFiscal?: (id: string) => void;
  showToast?: (message: string, kind: string, duration?: number) => void;
  om?: (type: string, ...rest: unknown[]) => unknown;
  switchTab?: (tab: string, ...rest: unknown[]) => unknown;
  erpCanAccessTab?: (tab: string) => boolean;
}

const TAB = 'contas_receber';
const legacy = (): LegacyReceivables => window as unknown as LegacyReceivables;

export function installReceivables(): void {
  let handler: ((command: ReceivableCommand) => void) | null = null;
  const pending: ReceivableCommand[] = [];
  const controller: ReceivablesController = {
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

  const notify = (message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    const toast = legacy().showToast;
    if (toast) toast(message, kind, kind === 'error' ? 9000 : 4500);
    else window.alert(message);
  };

  function port(): ReceivablesPort {
    const app = legacy();
    const banks = app.erpBanks?.snapshot() ?? { ready: false, list: [] };
    return {
      canOperate: app._usuarioPodeOperarModulo?.(TAB) === true,
      today: () => todayISO(),
      clients: (app.erpCustomersList?.() ?? [])
        .map((item) =>
          item && typeof item === 'object' ? String((item as { nome?: unknown }).nome ?? '').trim() : '',
        )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })),
      banks: banks.list,
      banksReady: banks.ready,
      loadBanks: () => {
        if (bankLoad || !app.erpBanks) return;
        bankLoad = app.erpBanks
          .load()
          .catch(() => undefined)
          .finally(() => {
            render();
            window.setTimeout(() => {
              bankLoad = null;
            }, 30_000);
          });
      },
      request: async (payload) => {
        const send = legacy().erpReceivablesRequest;
        if (!send) throw new Error('Contas a Receber indisponível. Atualize a página.');
        return send(payload);
      },
      registerClient: async (name) => {
        const send = legacy().erpCustomerRequest;
        if (!send) throw new Error('Cadastro de clientes indisponível. Atualize a página.');
        await send({ action: 'create', customer: { nome: name } });
        render();
      },
      openSale: (saleId) => legacy().verVendaDoCR?.(saleId),
      openFiscal: (id) => legacy().phase3ReceivableFiscal?.(id),
      notify,
      confirm: (message) => window.confirm(message),
    };
  }

  function render(): void {
    const target = document.getElementById('contas-receber-app');
    if (!target) return;
    if (!root || host !== target) {
      target.replaceChildren();
      root = createRoot(target);
      host = target;
    }
    root.render(
      <StrictMode>
        <ReceivablesWorkspace
          records={[...(legacy().erpReceivablesList?.() ?? [])]}
          port={port()}
          controller={controller}
        />
      </StrictMode>,
    );
  }

  function send(command: ReceivableCommand): void {
    const app = legacy();
    if (app.erpCanAccessTab && !app.erpCanAccessTab(TAB))
      return notify('Você não tem acesso a Contas a Receber.', 'error');
    if (!document.getElementById('tab-' + TAB)?.classList.contains('active')) app.switchTab?.(TAB);
    render();
    if (handler) handler(command);
    else pending.push(command);
  }

  const idAt = (index: unknown): string => {
    const item = (legacy().erpReceivablesList?.() ?? [])[Number(index)] as { id?: unknown } | undefined;
    return item ? String(item.id ?? '') : '';
  };
  const rowAt = (index: unknown) => {
    const id = idAt(index);
    return receivableRows(legacy().erpReceivablesList?.() ?? [], todayISO()).find((row) => row.id === id);
  };

  const previous = { om: legacy().om, switchTab: legacy().switchTab };
  Object.assign(window, {
    renderContasReceber: render,
    erpReceivablesOpen: (client?: unknown) => send({ kind: 'new', client: String(client ?? '') }),
    editContaReceber: (index: unknown) => send({ kind: 'edit', id: idAt(index) }),
    receberContaRapido: (index: unknown) => send({ kind: 'receive', id: idAt(index) }),
    excluirContaReceber: (index: unknown) => removeReceivable(port(), rowAt(index)),
    estornarContaReceber: (index: unknown) => reopenReceivable(port(), rowAt(index)),
    om: (type: string, ...rest: unknown[]) =>
      type === 'conta_receber' ? send({ kind: 'new' }) : previous.om?.(type, ...rest),
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
