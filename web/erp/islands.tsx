import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { erpSessionUser } from '../shared/auth/erp-session.js';
import { createApiClient } from '../shared/http/api-client.js';
import { ChequeReport } from '../modules/cheque-report/ui/ChequeReport.js';
import { HELP_CATEGORIES } from '../modules/help-center/domain/help-articles.js';
import { HelpCenter } from '../modules/help-center/ui/HelpCenter.js';

const CHEQUE_REPORT = 'adt-cheques-report';
const roots = new Map<string, Root>();
const elementRoots = new WeakMap<Element, Root>();

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

function mountElement(host: Element, node: ReactNode): void {
  let root = elementRoots.get(host);
  if (!root) {
    host.replaceChildren();
    root = createRoot(host);
    elementRoots.set(host, root);
  }
  root.render(<StrictMode>{node}</StrictMode>);
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

interface LegacyNavigation {
  erpCanAccessTab?: (tab: string) => boolean;
  switchTab?: (tab: string) => unknown;
}

const legacyNavigation = (): LegacyNavigation => window as unknown as LegacyNavigation;
const canOpenModule = (module: string): boolean =>
  Boolean(legacyNavigation().erpCanAccessTab?.(module) && document.getElementById('tab-' + module));
const openModule = (module: string): void => {
  const navigation = legacyNavigation();
  if (navigation.erpCanAccessTab?.(module)) navigation.switchTab?.(module);
};
const loadHelpArticles = () => api.request<unknown>('/api/help/articles');

function renderHelpCenter(host: Element | null): void {
  if (!host) return;
  host.classList.add('mm-help-root');
  mountElement(
    host,
    <HelpCenter
      key={Date.now()}
      load={loadHelpArticles}
      canOpenModule={canOpenModule}
      openModule={openModule}
    />,
  );
}

Object.assign(window, {
  abrirRelatorioChequesAdiantamentos: openChequeReport,
  fecharRelatorioChequesAdiantamentos: () => close(CHEQUE_REPORT),
  ERPHelpCenter: Object.freeze({ render: renderHelpCenter, categories: HELP_CATEGORIES }),
});

const openHelpTab = document.getElementById('tab-help_center');
if (openHelpTab?.classList.contains('active')) renderHelpCenter(openHelpTab);
