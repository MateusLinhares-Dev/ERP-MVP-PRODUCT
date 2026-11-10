import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { erpSessionUser } from '../shared/auth/erp-session.js';
import { createApiClient } from '../shared/http/api-client.js';
import { ChequeReport } from '../modules/cheque-report/ui/ChequeReport.js';

const CHEQUE_REPORT = 'adt-cheques-report';
const roots = new Map<string, Root>();

const api = createApiClient({
  currentUser: erpSessionUser,
  onSignedOut: () => undefined,
  messages: { NETWORK_ERROR: 'Sem conexão com a internet. Confira o sinal e tente de novo.' },
});

function mount(containerId: string, node: ReactNode): HTMLElement | null {
  const container = document.getElementById(containerId);
  if (!container) return null;
  let root = roots.get(containerId);
  if (!root) {
    container.replaceChildren();
    root = createRoot(container);
    roots.set(containerId, root);
  }
  root.render(<StrictMode>{node}</StrictMode>);
  container.hidden = false;
  return container;
}

function close(containerId: string): void {
  roots.get(containerId)?.render(null);
  const container = document.getElementById(containerId);
  if (container) container.hidden = true;
}

const loadCheques = () => api.request<unknown>('/api/finance/advance-cheques');

function openChequeReport(): void {
  const legacy = window as unknown as { adtSubTab?: (tab: string) => void };
  legacy.adtSubTab?.('controle');
  const container = mount(
    CHEQUE_REPORT,
    <ChequeReport key={Date.now()} load={loadCheques} onClose={() => close(CHEQUE_REPORT)} />,
  );
  container?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

Object.assign(window, {
  abrirRelatorioChequesAdiantamentos: openChequeReport,
  fecharRelatorioChequesAdiantamentos: () => close(CHEQUE_REPORT),
});
