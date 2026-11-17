import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { erpSessionUser } from '../shared/auth/erp-session.js';
import { todayISO } from '../shared/domain/dates.js';
import { createApiClient } from '../shared/http/api-client.js';
import {
  createPendingPayments,
  reversePayment,
  submitPayment,
  verifyPayment,
} from '../modules/payables/application/payments.js';
import type { PaymentDeps } from '../modules/payables/application/payments.js';
import { reversalRequest } from '../modules/payables/domain/payment.js';
import type { PaymentContext } from '../modules/payables/domain/payment.js';
import { payableRows } from '../modules/payables/domain/payables.js';
import { PayablesWorkspace } from '../modules/payables/ui/PayablesWorkspace.js';
import type {
  PayableBank,
  PayableCommand,
  PayablesController,
  PayablesPort,
} from '../modules/payables/ui/ports.js';
import '../modules/payables/ui/payables.css';

type Raw = Record<string, unknown>;

interface LegacyPayables {
  erpPayablesList?: () => unknown[];
  erpPayablesRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
  erpPayablesCompanyOf?: (raw: Raw) => string;
  erpPayablesFromPurchase?: (raw: Raw) => boolean;
  erpPayablesHygiene?: () => void;
  erpPayablesSuppliers?: (kind: string) => string[];
  erpPayablesOnlyPurchases?: () => boolean;
  erpFinanceCompanies?: () => string[];
  erpFinanceCompanyColor?: (company: string) => string;
  erpBanks?: { snapshot(): { ready: boolean; list: PayableBank[] }; load(): Promise<unknown> };
  erpPayablesApply?: (kind: string, result: Record<string, unknown>) => void;
  erpPayablesPaymentContext?: (id: string) => PaymentContext | null;
  _usuarioPodeOperarModulo?: (tab: string) => boolean;
  showToast?: (message: string, kind: string, duration?: number) => void;
  om?: (type: string, ...rest: unknown[]) => unknown;
  switchTab?: (tab: string, ...rest: unknown[]) => unknown;
  erpCanAccessTab?: (tab: string) => boolean;
}

const TAB = 'contas_pagar';
const legacy = (): LegacyPayables => window as unknown as LegacyPayables;
const companyOf = (raw: Raw): string => {
  try {
    return String(legacy().erpPayablesCompanyOf?.(raw) ?? raw.empresa ?? '');
  } catch {
    return String(raw.empresa ?? '');
  }
};
const fromPurchase = (raw: Raw): boolean => {
  try {
    return legacy().erpPayablesFromPurchase?.(raw) === true || String(raw.id ?? '').startsWith('CPPO_');
  } catch {
    return String(raw.id ?? '').startsWith('CPPO_');
  }
};

const api = createApiClient({
  currentUser: erpSessionUser,
  onSignedOut: () => undefined,
  messages: { NETWORK_ERROR: 'Sem resposta do servidor. Confira a internet.' },
});
const PAYMENT = '/api/finance/payables-payment';

export function installPayables(): void {
  const deps: PaymentDeps = {
    gateway: {
      pay: (body) => api.request(PAYMENT, { method: 'POST', body }),
      reverse: (body) => api.request(PAYMENT, { method: 'POST', body }),
      status: (payableId, operationId) =>
        api.request(
          '/api/finance/payables-status?' + new URLSearchParams({ payableId, operationId }).toString(),
        ),
    },
    ledger: { apply: (kind, result) => legacy().erpPayablesApply?.(kind, result) },
    pending: createPendingPayments(
      () => Date.now(),
      () => window.crypto.randomUUID(),
    ),
    now: () => Date.now(),
  };
  const rowsNow = () =>
    payableRows(legacy().erpPayablesList?.() ?? [], { today: todayISO(), companyOf, fromPurchase });
  let handler: ((command: PayableCommand) => void) | null = null;
  const pending: PayableCommand[] = [];
  const controller: PayablesController = {
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
    if (toast) toast(message, kind, kind === 'error' ? 9000 : 5000);
    else window.alert(message);
  };

  function port(): PayablesPort {
    const app = legacy();
    const banks = app.erpBanks?.snapshot() ?? { ready: false, list: [] };
    return {
      canOperate: app._usuarioPodeOperarModulo?.(TAB) === true,
      today: () => todayISO(),
      companies: app.erpFinanceCompanies?.() ?? [],
      companyColor: (company) => app.erpFinanceCompanyColor?.(company) ?? '',
      banks: banks.list.map((bank) => ({ cod: bank.cod, label: bank.label, company: bank.company ?? '' })),
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
      suppliers: (kind) =>
        [...new Set((app.erpPayablesSuppliers?.(kind) ?? []).map((name) => String(name ?? '').trim()))]
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'pt-BR')),
      categories: [],
      request: async (payload) => {
        const send = legacy().erpPayablesRequest;
        if (!send) throw new Error('Contas a Pagar indisponível. Atualize a página.');
        return send(payload);
      },
      payment: {
        context: (id) =>
          legacy().erpPayablesPaymentContext?.(id) ?? { fornCod: '', ticket: '', advances: [] },
        operation: (id) => deps.pending.operation(id),
        blockedSeconds: (id) => deps.pending.blockedSeconds(id),
        submit: (payload) => submitPayment(deps, payload),
        verify: (id, operationId) => verifyPayment(deps, id, operationId),
        reverse: (row, index) =>
          reversePayment(deps, reversalRequest(row, index, window.crypto.randomUUID())),
      },
      notify,
      confirm: (message) => window.confirm(message),
    };
  }

  function render(): void {
    const target = document.getElementById('contas-pagar-app');
    if (!target) return;
    try {
      legacy().erpPayablesHygiene?.();
    } catch (error) {
      console.warn('[Contas a Pagar] limpeza de duplicadas', error);
    }
    if (!root || host !== target) {
      target.replaceChildren();
      root = createRoot(target);
      host = target;
    }
    root.render(
      <StrictMode>
        <PayablesWorkspace
          records={[...(legacy().erpPayablesList?.() ?? [])]}
          port={port()}
          controller={controller}
          companyOf={companyOf}
          fromPurchase={fromPurchase}
          onlyPurchases={legacy().erpPayablesOnlyPurchases?.() === true}
        />
      </StrictMode>,
    );
  }

  function send(command: PayableCommand, openTab = true): void {
    const app = legacy();
    if (app.erpCanAccessTab && !app.erpCanAccessTab(TAB))
      return notify('Você não tem acesso a Contas a Pagar.', 'error');
    if (openTab && !document.getElementById('tab-' + TAB)?.classList.contains('active')) app.switchTab?.(TAB);
    render();
    if (handler) handler(command);
    else pending.push(command);
  }

  const idAt = (index: unknown, id: unknown): string => {
    if (id) return String(id);
    const item = (legacy().erpPayablesList?.() ?? [])[Number(index)] as { id?: unknown } | undefined;
    return item ? String(item.id ?? '') : '';
  };

  const previous = { om: legacy().om, switchTab: legacy().switchTab };
  Object.assign(window, {
    renderContasPagar: render,
    editContaPagar: (index: unknown, id?: unknown) => send({ kind: 'edit', id: idAt(index, id) }),
    excluirContaPagar: (index: unknown, id?: unknown) => send({ kind: 'delete', id: idAt(index, id) }),
    pagarContaRapido: (index: unknown, id?: unknown) => send({ kind: 'pay', id: idAt(index, id) }, false),
    verHistoricoPagamentosCP: (id: unknown) => send({ kind: 'history', id: String(id ?? '') }, false),
    erpPayablesReverse: (id: unknown, index: unknown) => {
      const row = rowsNow().find((item) => item.id === String(id ?? ''));
      return reversePayment(
        deps,
        row ? reversalRequest(row, Number(index), window.crypto.randomUUID()) : null,
      );
    },
    om: (type: string, ...rest: unknown[]) =>
      type === 'conta_pagar' ? send({ kind: 'new' }) : previous.om?.(type, ...rest),
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
