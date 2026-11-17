import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { todayISO } from '../shared/domain/dates.js';
import type { Raw } from '../modules/banking/domain/ledger.js';
import { BankingWorkspace } from '../modules/banking/ui/BankingWorkspace.js';
import type {
  BankingCommand,
  BankingController,
  BankingPort,
  BankingSnapshot,
} from '../modules/banking/ui/ports.js';
import '../modules/banking/ui/banking.css';

interface LegacyBanking {
  erpBankingSnapshot?: () => {
    ready: boolean;
    banks: unknown[];
    entries: unknown[];
    advanceMovementIds: string[];
    chequeMovementIds: string[];
  };
  erpBankingCompanyOf?: (raw: Raw) => string;
  erpBankingCreatedAt?: (raw: Raw) => string;
  erpBankingAddressOf?: (company: string) => string;
  erpBankingCompanies?: () => string[];
  erpBankingMain?: () => { company: string; holder: string };
  erpFinanceCompanyColor?: (company: string) => string;
  erpBankLedgerRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
  erpReconciliationOpen?: (code: string) => void;
  erpBankIntegrationsOpen?: (code: string) => void;
  compartilharBanco?: (index: number) => void;
  registrarHistorico?: (
    module: string,
    action: string,
    detail: string,
    before: unknown,
    extra: Record<string, unknown>,
  ) => void;
  _usuarioPodeOperarModulo?: (tab: string) => boolean;
  showToast?: (message: string, kind: string, duration?: number) => void;
  om?: (type: string, ...rest: unknown[]) => unknown;
  switchTab?: (tab: string, ...rest: unknown[]) => unknown;
  erpCanAccessTab?: (tab: string) => boolean;
}

const TAB = 'contas_banco';
const legacy = (): LegacyBanking => window as unknown as LegacyBanking;
const safe = <T,>(work: () => T, fallback: T): T => {
  try {
    return work();
  } catch {
    return fallback;
  }
};

export function installBanking(): void {
  let handler: ((command: BankingCommand) => void) | null = null;
  const pending: BankingCommand[] = [];
  const controller: BankingController = {
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

  const notify = (message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    const toast = legacy().showToast;
    if (toast) toast(message, kind, kind === 'error' ? 9000 : 5000);
    else window.alert(message);
  };

  function snapshot(): BankingSnapshot {
    const data = safe(() => legacy().erpBankingSnapshot?.(), undefined);
    return {
      ready: data?.ready === true,
      banks: [...(data?.banks ?? [])],
      entries: [...(data?.entries ?? [])],
      links: {
        advanceMovementIds: new Set(data?.advanceMovementIds ?? []),
        chequeMovementIds: new Set(data?.chequeMovementIds ?? []),
      },
    };
  }

  function port(): BankingPort {
    const app = legacy();
    const main = safe(() => app.erpBankingMain?.(), undefined) ?? { company: '', holder: '' };
    return {
      canOperate: app._usuarioPodeOperarModulo?.(TAB) === true,
      today: () => todayISO(),
      companies: safe(() => app.erpBankingCompanies?.() ?? [], []),
      companyColor: (company) => safe(() => app.erpFinanceCompanyColor?.(company) ?? '', ''),
      companyOf: (raw) => safe(() => app.erpBankingCompanyOf?.(raw) ?? String(raw.empresa ?? ''), ''),
      createdAt: (raw) => safe(() => app.erpBankingCreatedAt?.(raw) ?? '', ''),
      mainCompany: main.company,
      mainHolder: main.holder,
      addressOf: (company) => safe(() => app.erpBankingAddressOf?.(company) ?? '', ''),
      request: async (payload) => {
        const send = legacy().erpBankLedgerRequest;
        if (!send) throw new Error('Bancos indisponível. Atualize a página.');
        return (await send(payload)) as Raw;
      },
      notify,
      confirm: (message) => window.confirm(message),
      reconcile: (code) => legacy().erpReconciliationOpen?.(code),
      integrations: (code) => legacy().erpBankIntegrationsOpen?.(code),
      share: (index) => legacy().compartilharBanco?.(index),
      history: (module, action, detail, extra) => {
        try {
          legacy().registrarHistorico?.(module, action, detail, null, extra);
        } catch {
          return;
        }
      },
    };
  }

  function render(): void {
    const target = document.getElementById('bancos-app');
    if (!target) return;
    if (!root || host !== target) {
      target.replaceChildren();
      root = createRoot(target);
      host = target;
    }
    root.render(
      <StrictMode>
        <BankingWorkspace snapshot={snapshot()} port={port()} controller={controller} />
      </StrictMode>,
    );
  }

  function send(command: BankingCommand): void {
    const app = legacy();
    if (app.erpCanAccessTab && !app.erpCanAccessTab(TAB))
      return notify('Você não tem acesso às contas bancárias.', 'error');
    render();
    if (handler) handler(command);
    else pending.push(command);
  }

  const previous = { om: legacy().om, switchTab: legacy().switchTab };
  Object.assign(window, {
    renderBancos: render,
    verExtratoBanco: (code: unknown) => send({ kind: 'statement', code: String(code ?? '') }),
    editBanco: (index: unknown) => send({ kind: 'edit', index: Number(index) }),
    excluirBanco: (index: unknown) => send({ kind: 'delete', index: Number(index) }),
    om: (type: string, ...rest: unknown[]) =>
      type === 'banco' ? send({ kind: 'new' }) : previous.om?.(type, ...rest),
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
