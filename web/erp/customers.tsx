import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { todayISO } from '../shared/domain/dates.js';
import { partyFormOf } from '../shared/domain/party.js';
import { CUSTOMER_KIND, PartyFormView } from '../shared/ui/PartyFormView.js';
import { customerRows, renamedMessage } from '../modules/customers/domain/customers.js';
import type { CustomerRow } from '../modules/customers/domain/customers.js';
import { CustomerList } from '../modules/customers/ui/CustomerList.js';

interface CustomerReply {
  customer?: { cod?: string; id?: string };
  renamed?: { moved?: string };
}

interface LegacyCustomers {
  erpCustomersList?: () => unknown[];
  erpCustomerRequest?: (payload: Record<string, unknown>) => Promise<CustomerReply>;
  _usuarioPodeOperarModulo?: (tab: string) => boolean;
  abrirFichaCli?: (name: string | null) => void;
  cliDocsModal?: (index: number) => void;
  phase3OpenPartyBanks?: (kind: string, key: string, name: string) => void;
  showToast?: (message: string, kind: string, duration?: number) => void;
  om?: (type: string, ...rest: unknown[]) => unknown;
  phase4MasterCreate?: (kind: string) => unknown;
  phase4MasterShowList?: (kind: string) => unknown;
  erpCanAccessTab?: (tab: string) => boolean;
  switchTab?: (tab: string, ...rest: unknown[]) => unknown;
}

const TAB = 'clientes';
const legacy = (): LegacyCustomers => window as unknown as LegacyCustomers;
type Row = Record<string, unknown>;

export function installCustomers(): void {
  const roots = new WeakMap<Element, Root>();
  const render = (host: Element, node: ReactNode) => {
    let root = roots.get(host);
    if (!root) {
      host.replaceChildren();
      root = createRoot(host);
      roots.set(host, root);
    }
    root.render(<StrictMode>{node}</StrictMode>);
  };

  const notify = (message: string, error = false) => {
    const toast = legacy().showToast;
    if (toast) toast(message, error ? 'error' : 'success', error ? 9000 : 5000);
    else window.alert(message);
  };
  const canOperate = () => legacy()._usuarioPodeOperarModulo?.(TAB) === true;
  const records = (): Row[] =>
    (legacy().erpCustomersList?.() ?? []).filter(
      (item): item is Row => Boolean(item) && typeof item === 'object',
    );
  const byKey = (key: string): Row | null =>
    records().find((item) => String(item.id ?? item.cod ?? '') === key) ?? null;
  const request = async (payload: Row): Promise<CustomerReply> => {
    const send = legacy().erpCustomerRequest;
    if (!send) throw new Error('Cadastro indisponível. Atualize a página.');
    return send(payload);
  };

  async function remove(keys: string[]): Promise<boolean> {
    const names = keys.map((key) => String(byKey(key)?.nome ?? key));
    const question =
      keys.length === 1
        ? `Excluir o cliente "${names[0]}"?\n\nAs vendas e contas a receber continuam no histórico.`
        : `Excluir ${keys.length} clientes selecionados?`;
    if (!window.confirm(question)) return false;
    try {
      await request({ action: 'delete', ids: keys });
      notify(keys.length === 1 ? 'Cliente excluído.' : `${keys.length} clientes excluídos.`);
      return true;
    } catch (error) {
      notify(
        'Não foi possível excluir: ' + (error instanceof Error ? error.message : 'erro desconhecido'),
        true,
      );
      return false;
    }
  }

  function openDocs(key: string): void {
    const list = legacy().erpCustomersList?.() ?? [];
    const index = list.findIndex((item) => item === byKey(key));
    if (index >= 0) legacy().cliDocsModal?.(index);
  }

  function renderList(): void {
    const host = document.getElementById('clientes-app');
    if (!host) return;
    render(
      host,
      <CustomerList
        rows={customerRows(records())}
        canOperate={canOperate()}
        onNew={() => openForm('')}
        onEdit={(key) => openForm(key)}
        onLedger={(name) => legacy().abrirFichaCli?.(name)}
        onLedgerSearch={() => legacy().abrirFichaCli?.(null)}
        onDocs={openDocs}
        onBanks={(row: CustomerRow) =>
          legacy().phase3OpenPartyBanks?.('cliente', row.cod || row.key, row.nome)
        }
        onDelete={remove}
      />,
    );
  }

  function shellMode(mode: 'list' | 'form'): HTMLElement | null {
    const shell = document.getElementById('phase4-party-' + TAB);
    if (!shell) return null;
    shell.dataset.mode = mode;
    shell.querySelectorAll<HTMLElement>('[data-party-view]').forEach((button) => {
      const active = button.dataset.partyView === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const listing = shell.querySelector<HTMLElement>('.phase4-master-listing');
    const editor = shell.querySelector<HTMLElement>('.phase4-master-inline-editor');
    if (listing) listing.hidden = mode !== 'list';
    if (editor) editor.hidden = mode !== 'form';
    return editor;
  }

  function closeForm(): void {
    const editor = document.getElementById('phase4-master-editor-' + TAB);
    if (editor) render(editor, null);
    shellMode('list');
    renderList();
  }

  function openForm(key: string): void {
    const app = legacy();
    if (app.erpCanAccessTab && !app.erpCanAccessTab(TAB))
      return notify('Você não tem acesso a este cadastro.', true);
    if (!canOperate()) return notify('Seu perfil pode consultar, mas não alterar clientes.', true);
    if (!document.getElementById('tab-' + TAB)?.classList.contains('active')) app.switchTab?.(TAB);
    const entity = key ? byKey(key) : null;
    if (key && !entity) return notify('Cliente não encontrado. Atualize a tela.', true);
    const editor = shellMode('form');
    if (!editor) return;
    render(
      editor,
      <PartyFormView
        kind={CUSTOMER_KIND}
        key={key || 'novo-' + Date.now()}
        code={key ? String(entity?.cod ?? key) : ''}
        initial={partyFormOf(entity, todayISO())}
        hasLegacyBankText={Boolean(entity?.obs)}
        save={async (customer) => {
          const reply = await request(
            key
              ? {
                  action: 'update',
                  id: key,
                  customer,
                  expectedUpdate: entity?._upd != null ? Number(entity._upd) : undefined,
                }
              : { action: 'create', customer },
          );
          const moved = renamedMessage(reply);
          if (moved) window.setTimeout(() => notify(moved), 0);
          return String(reply.customer?.cod ?? key);
        }}
        confirm={(message) => window.confirm(message)}
        notify={notify}
        onBankAccounts={(code, name) => app.phase3OpenPartyBanks?.('cliente', code, name)}
        onDone={closeForm}
      />,
    );
    editor.closest('.phase4-master-workspace')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  const keyAt = (index: unknown): string => {
    const item = (legacy().erpCustomersList?.() ?? [])[Number(index)] as Row | undefined;
    return item ? String(item.id ?? item.cod ?? '') : '';
  };

  const previous = {
    om: legacy().om,
    create: legacy().phase4MasterCreate,
    showList: legacy().phase4MasterShowList,
    switchTab: legacy().switchTab,
  };
  Object.assign(window, {
    renderClientes: renderList,
    filtrarTabelaCli: renderList,
    editCliente: (index: unknown) => openForm(keyAt(index)),
    om: (type: string, ...rest: unknown[]) =>
      type === 'cliente' ? openForm('') : previous.om?.(type, ...rest),
    phase4MasterCreate: (kind: string) => (kind === 'cliente' ? openForm('') : previous.create?.(kind)),
    phase4MasterShowList: (kind: string) => (kind === 'cliente' ? closeForm() : previous.showList?.(kind)),
    switchTab: (tab: string, ...rest: unknown[]) => {
      const result = previous.switchTab?.(tab, ...rest);
      if (tab === TAB) renderList();
      return result;
    },
  });
  document.addEventListener('erp:catalog-updated', renderList);
  document.addEventListener('erp:ready', renderList);
  renderList();
}
