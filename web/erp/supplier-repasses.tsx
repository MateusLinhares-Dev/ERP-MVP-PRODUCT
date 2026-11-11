import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { erpSessionUser } from '../shared/auth/erp-session.js';
import type { ApiClient } from '../shared/http/api-client.js';
import { flowTotal, repasseList, repasseSummary } from '../modules/supplier-repasses/domain/repasses.js';
import type { RepasseSummary } from '../modules/supplier-repasses/domain/repasses.js';
import { RepasseDialog } from '../modules/supplier-repasses/ui/RepasseDialog.js';
import { PayablesSummary, SupplierIndicator } from '../modules/supplier-repasses/ui/RepassePanels.js';

interface LegacyFinance {
  showToast?: (message: string, kind: string, duration: number) => void;
  renderFluxo?: () => void;
  erpBankMovementAdded?: (movement: unknown) => boolean;
}

const PREVIEW_TTL_MS = 20000;
const legacy = (): LegacyFinance => window as unknown as LegacyFinance;

export function installSupplierRepasses(api: ApiClient): void {
  const endpoint = '/api/finance/supplier-cash-repasses';
  const roots = new WeakMap<Element, Root>();
  const previews = new Map<string, { at: number; balance: Promise<number> }>();
  let summary: RepasseSummary | null = null;
  let dialog: { host: HTMLElement; root: Root } | null = null;

  const render = (host: Element, node: ReactNode) => {
    let root = roots.get(host);
    if (!root) {
      root = createRoot(host);
      roots.set(host, root);
    }
    root.render(<StrictMode>{node}</StrictMode>);
  };

  const notify = (message: string, error = false) => {
    const toast = legacy().showToast;
    if (toast) toast(message, error ? 'error' : 'success', 6000);
    else window.alert(message);
  };

  const loadList = async (code: string) =>
    repasseList(await api.request<unknown>(endpoint + '?fornCod=' + encodeURIComponent(code)));

  const balanceOf = (code: string): Promise<number> => {
    const cached = previews.get(code);
    if (cached && Date.now() - cached.at < PREVIEW_TTL_MS) return cached.balance;
    const balance = loadList(code).then((list) => list.totalEmAberto);
    previews.set(code, { at: Date.now(), balance });
    balance.catch(() => previews.delete(code));
    return balance;
  };

  const send = (body: Record<string, unknown>) =>
    api.request<{ movement?: unknown }>(endpoint, { method: 'POST', body });

  function renderPayables(): void {
    const tab = document.getElementById('tab-contas_pagar');
    let host = document.getElementById('supplier-repass-payables');
    if (!summary) {
      host?.remove();
      return;
    }
    if (!tab) return;
    if (!host) {
      host = document.createElement('section');
      host.id = 'supplier-repass-payables';
      host.className = 'supplier-repass-payables';
      tab.insertBefore(host, tab.firstChild);
    }
    render(host, <PayablesSummary summary={summary} onOpen={openForSupplier} />);
  }

  async function refreshSummary(): Promise<void> {
    summary = repasseSummary(await api.request<unknown>(endpoint + '?scope=summary'));
    renderPayables();
    try {
      legacy().renderFluxo?.();
    } catch (error) {
      console.warn('supplier.repasse.flow', error);
    }
  }

  function closeDialog(): void {
    const current = dialog;
    dialog = null;
    if (!current) return;
    current.root.unmount();
    current.host.remove();
  }

  function openForSupplier(code: unknown, name: unknown): void {
    const supplier = String(code ?? '').trim();
    if (!supplier) return;
    closeDialog();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    dialog = { host, root };
    root.render(
      <StrictMode>
        <RepasseDialog
          code={supplier}
          name={String(name || supplier)}
          load={loadList}
          send={send}
          confirm={(message) => window.confirm(message)}
          notify={notify}
          onChanged={(movement) => {
            previews.delete(supplier);
            if (movement) legacy().erpBankMovementAdded?.(movement);
            refreshSummary().catch((error: unknown) => console.warn('supplier.repasse.summary', error));
          }}
          onClose={closeDialog}
        />
      </StrictMode>,
    );
  }

  document.addEventListener('erp:supplier-ficha-rendered', (event) => {
    const detail = (event as CustomEvent<{ fornCod?: unknown; nome?: unknown }>).detail;
    const code = String(detail?.fornCod ?? '').trim();
    const actions = document.getElementById('ff-actions');
    if (!code || !actions) return;
    let host = document.getElementById('supplier-repass-ficha');
    if (!host) {
      host = document.createElement('span');
      host.id = 'supplier-repass-ficha';
      host.style.display = 'contents';
      actions.insertBefore(host, actions.firstChild);
    }
    const name = String(detail?.nome ?? '').trim();
    render(
      host,
      <SupplierIndicator
        key={code}
        code={code}
        balance={balanceOf}
        onOpen={() => openForSupplier(code, name)}
      />,
    );
  });

  async function startForUser(): Promise<void> {
    const user = erpSessionUser();
    if (!user) {
      summary = null;
      renderPayables();
      return;
    }
    const { claims } = await user.getIdTokenResult();
    if (claims.erpAccess !== true || (claims.canPayables !== true && claims.canFinance !== true)) return;
    await refreshSummary();
  }
  const start = () => {
    startForUser().catch((error: unknown) => console.warn('supplier.repasse.summary', error));
  };
  try {
    window.firebase?.auth().onAuthStateChanged(start);
  } catch (error) {
    console.warn('supplier.repasse.auth', error);
  }
  document.addEventListener('erp:user-started', start);

  Object.assign(window, {
    SupplierCashRepasse: Object.freeze({
      flowTotal: (month: number, year: number, kind: 'entradas' | 'saidas') =>
        flowTotal(summary, month, year, kind),
      refreshSummary,
      openForSupplier,
    }),
  });
}
