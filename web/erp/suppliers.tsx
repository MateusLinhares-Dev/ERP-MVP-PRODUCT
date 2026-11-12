import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { formOf, supplierRows } from '../modules/suppliers/domain/suppliers.js';
import { SupplierFormView } from '../modules/suppliers/ui/SupplierFormView.js';
import { SupplierList } from '../modules/suppliers/ui/SupplierList.js';

interface SupplierReply {
  supplier?: { cod?: string };
}

interface LegacySuppliers {
  getFornAtivos?: () => unknown[];
  _usuarioPodeOperarModulo?: (tab: string) => boolean;
  erpSupplierRequest?: (payload: Record<string, unknown>) => Promise<SupplierReply>;
  abrirFichaForn?: (cod: string) => void;
  abrirFichaFornGeral?: () => void;
  fornDocsModal?: (cod: string) => void;
  fornAbrirPix?: (cod: string) => void;
  fornContas?: (cod: string) => unknown[];
  fornAtualizarSeletorPrecos?: () => void;
  phase3OpenPartyBanks?: (kind: string, key: string, name: string) => void;
  importarFornecedores?: (input: { files: File[]; value: string }) => void;
  showToast?: (message: string, kind: string, duration?: number) => void;
  om?: (type: string, ...rest: unknown[]) => unknown;
  phase4MasterCreate?: (kind: string) => unknown;
  phase4MasterShowList?: (kind: string) => unknown;
  erpCanAccessTab?: (tab: string) => boolean;
  switchTab?: (tab: string, ...rest: unknown[]) => unknown;
}

const TAB = 'fornecedores';
const legacy = (): LegacySuppliers => window as unknown as LegacySuppliers;

const today = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export function installSuppliers(): void {
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
    if (toast) toast(message, error ? 'error' : 'success', error ? 8000 : 4000);
    else window.alert(message);
  };
  const canOperate = () => legacy()._usuarioPodeOperarModulo?.(TAB) === true;
  const records = (): Record<string, unknown>[] =>
    (legacy().getFornAtivos?.() ?? []).filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
    );
  const request = async (payload: Record<string, unknown>): Promise<SupplierReply> => {
    const send = legacy().erpSupplierRequest;
    if (!send) throw new Error('Cadastro indisponível. Atualize a página.');
    return send(payload);
  };

  async function remove(codes: string[]): Promise<boolean> {
    const names = codes.map((cod) => String(records().find((item) => String(item.cod) === cod)?.nome ?? cod));
    const question =
      codes.length === 1
        ? `Excluir o fornecedor "${names[0]}"?`
        : `Excluir ${codes.length} fornecedores selecionados?`;
    if (!window.confirm(question)) return false;
    try {
      await request({ action: 'delete', codes });
      notify(codes.length === 1 ? 'Fornecedor excluído.' : `${codes.length} fornecedores excluídos.`);
      return true;
    } catch (error) {
      notify(
        'Não foi possível excluir: ' + (error instanceof Error ? error.message : 'erro desconhecido'),
        true,
      );
      return false;
    }
  }

  function renderList(): void {
    const host = document.getElementById('sforn-compra');
    if (!host) return;
    render(
      host,
      <SupplierList
        rows={supplierRows(records())}
        canOperate={canOperate()}
        accountsOf={(cod) => legacy().fornContas?.(cod).length ?? 0}
        onNew={() => openForm('')}
        onEdit={(cod) => openForm(cod)}
        onLedger={(cod) => legacy().abrirFichaForn?.(cod)}
        onLedgerSearch={() => legacy().abrirFichaFornGeral?.()}
        onDocs={(cod) => legacy().fornDocsModal?.(cod)}
        onPix={(cod) => legacy().fornAbrirPix?.(cod)}
        onBanks={(cod, name) => legacy().phase3OpenPartyBanks?.('fornecedor', cod, name)}
        onDelete={remove}
        onImport={(file) => legacy().importarFornecedores?.({ files: [file], value: '' })}
      />,
    );
    legacy().fornAtualizarSeletorPrecos?.();
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

  function openForm(code: string): void {
    const app = legacy();
    if (app.erpCanAccessTab && !app.erpCanAccessTab(TAB)) {
      notify('Você não tem acesso a este cadastro.', true);
      return;
    }
    if (!canOperate()) {
      notify('Seu perfil pode consultar, mas não alterar fornecedores.', true);
      return;
    }
    if (!document.getElementById('tab-' + TAB)?.classList.contains('active')) app.switchTab?.(TAB);
    const entity = code ? (records().find((item) => String(item.cod) === code) ?? null) : null;
    if (code && !entity) {
      notify('Fornecedor não encontrado. Atualize a tela.', true);
      return;
    }
    const editor = shellMode('form');
    if (!editor) return;
    render(
      editor,
      <SupplierFormView
        key={code || 'novo-' + Date.now()}
        code={code}
        initial={formOf(entity, today())}
        hasLegacyBankText={Boolean(entity?.obs)}
        save={async (supplier) => {
          const reply = await request(
            code
              ? {
                  action: 'update',
                  cod: code,
                  supplier,
                  expectedUpdate: entity?._upd != null ? Number(entity._upd) : undefined,
                }
              : { action: 'create', supplier },
          );
          return String(reply.supplier?.cod ?? code);
        }}
        confirm={(message) => window.confirm(message)}
        notify={notify}
        onBankAccounts={(cod, name) => legacy().phase3OpenPartyBanks?.('fornecedor', cod, name)}
        onDone={closeForm}
      />,
    );
    editor.closest('.phase4-master-workspace')?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  const previous = {
    om: legacy().om,
    create: legacy().phase4MasterCreate,
    showList: legacy().phase4MasterShowList,
    switchTab: legacy().switchTab,
  };
  Object.assign(window, {
    renderTabelaFornecedores: renderList,
    editFornecedor: (cod: unknown) => openForm(String(cod ?? '')),
    om: (type: string, ...rest: unknown[]) =>
      type === 'fornecedor' ? openForm('') : previous.om?.(type, ...rest),
    phase4MasterCreate: (kind: string) => (kind === 'fornecedor' ? openForm('') : previous.create?.(kind)),
    phase4MasterShowList: (kind: string) => (kind === 'fornecedor' ? closeForm() : previous.showList?.(kind)),
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
