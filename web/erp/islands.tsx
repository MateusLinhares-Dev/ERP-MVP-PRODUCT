import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { erpSessionUser } from '../shared/auth/erp-session.js';
import { createApiClient } from '../shared/http/api-client.js';
import { ChequeReport } from '../modules/cheque-report/ui/ChequeReport.js';
import { HELP_CATEGORIES } from '../modules/help-center/domain/help-articles.js';
import { HelpCenter } from '../modules/help-center/ui/HelpCenter.js';
import { AuditLogs } from '../modules/engineering/ui/AuditLogs.js';
import { HelpEditor } from '../modules/engineering/ui/HelpEditor.js';
import { installErrorTelemetry } from '../shared/observability/telemetry.js';
import { isValidBankCode } from '../modules/bank-integrations/domain/integration.js';
import type { IntegrationAction, IntegrationReply } from '../modules/bank-integrations/domain/integration.js';
import { BankIntegrationsDialog } from '../modules/bank-integrations/ui/BankIntegrationsDialog.js';
import { installSupplierRepasses } from './supplier-repasses.js';
import { installAdvanceReview } from './advance-review.js';
import { installSuppliers } from './suppliers.js';
import { installSales } from './sales.js';
import { installCustomers } from './customers.js';
import { installReceivables } from './receivables.js';
import { installPayables } from './payables.js';

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

const ENGINEERING_TABS = [
  { id: 'engineering_logs', label: 'Auditoria e logs', icon: '▤' },
  { id: 'engineering_help', label: 'Gestão da Ajuda', icon: '✎' },
] as const;
const ENGINEER_LOGIN = 'engadministrator';

const loadAuditLogs = (query: string) => api.request<unknown>('/api/engineering/logs?' + query);
const sendHelpArticle = (body: unknown) =>
  api.request<{ id?: string }>('/api/help/articles', { method: 'POST', body });
const confirmDelete = (message: string) => window.confirm(message);

function renderEngineeringTab(id: string): void {
  const host = document.getElementById('tab-' + id);
  if (!host) return;
  const node =
    id === 'engineering_logs' ? (
      <AuditLogs key={Date.now()} load={loadAuditLogs} />
    ) : (
      <HelpEditor
        key={Date.now()}
        load={loadHelpArticles}
        send={sendHelpArticle}
        confirmDelete={confirmDelete}
      />
    );
  mountElement(host, node);
}

function showEngineeringTab(id: string): void {
  for (const tab of ENGINEERING_TABS)
    document.getElementById('tab-' + tab.id)?.classList.toggle('active', tab.id === id);
  legacyNavigation().switchTab?.(id);
  renderEngineeringTab(id);
}

function installEngineeringMenu(): void {
  const nav = document.getElementById('nav-bar');
  if (!nav || nav.querySelector('[data-tab="engineering_logs"]')) return;
  const group = document.createElement('div');
  group.className = 'sb-group open mm-eng-group';
  const header = document.createElement('div');
  header.className = 'sb-group-hdr';
  header.innerHTML =
    '<span class="sb-gicon">⚙</span><span class="sb-glabel">Engenharia</span><span class="sb-arr">▶</span>';
  header.onclick = () => group.classList.toggle('open');
  const items = document.createElement('div');
  items.className = 'sb-items';
  for (const tab of ENGINEERING_TABS) {
    const panel = document.createElement('section');
    panel.className = 'tab-panel mm-eng-panel';
    panel.id = 'tab-' + tab.id;
    document.querySelector('.app-body .content')?.append(panel);
    const item = document.createElement('div');
    item.className = 'nav-tab';
    item.dataset.tab = tab.id;
    const icon = document.createElement('span');
    icon.className = 'nt-icon';
    icon.textContent = tab.icon;
    const label = document.createElement('span');
    label.className = 'nt-label';
    label.textContent = tab.label;
    item.append(icon, label);
    item.onclick = () => showEngineeringTab(tab.id);
    items.append(item);
  }
  group.append(header, items);
  nav.append(group);
}

async function initializeEngineering(): Promise<void> {
  try {
    const user = erpSessionUser();
    const isEngineerProfile =
      (window as unknown as { erpIsEngineer?: () => boolean }).erpIsEngineer?.() === true;
    if (!user || !isEngineerProfile) return;
    const { claims } = await user.getIdTokenResult();
    if (claims.engineer === true && claims.erpUser === ENGINEER_LOGIN) installEngineeringMenu();
  } catch (error) {
    console.warn('[engenharia] menu não instalado', error);
  }
}

installErrorTelemetry(erpSessionUser);
document.addEventListener('erp:user-started', () => queueMicrotask(() => void initializeEngineering()));
void initializeEngineering();

let integrationDialog: { host: HTMLElement; root: Root } | null = null;

function closeBankIntegrations(): void {
  const dialog = integrationDialog;
  integrationDialog = null;
  if (!dialog) return;
  dialog.root.unmount();
  dialog.host.remove();
}

function openBankIntegrations(bankCode: unknown): void {
  if (!isValidBankCode(bankCode)) return;
  closeBankIntegrations();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  integrationDialog = { host, root };
  const call = (action: IntegrationAction, fields: Record<string, unknown> = {}) =>
    api.request<IntegrationReply>('/api/banking/integrations', {
      method: 'POST',
      body: { action, bankCode, ...fields },
    });
  root.render(
    <StrictMode>
      <BankIntegrationsDialog
        bankCode={bankCode}
        call={call}
        confirm={(message) => window.confirm(message)}
        onClose={closeBankIntegrations}
        onOpenReconciliation={(code) =>
          (window as unknown as { erpReconciliationOpen?: (code: string) => void }).erpReconciliationOpen?.(
            code,
          )
        }
      />
    </StrictMode>,
  );
}

Object.assign(window, { erpBankIntegrationsOpen: openBankIntegrations });

installSupplierRepasses(api);
installAdvanceReview(api);
installSuppliers();
installCustomers();
installReceivables();
installPayables();
installSales();
