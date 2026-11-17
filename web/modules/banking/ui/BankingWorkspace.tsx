import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { messageOf } from '../../../shared/domain/errors.js';
import { useLatest } from '../../../shared/ui/use-latest.js';
import { accountRows, bankKpis, duplicateNames, movementCount, searchAccounts } from '../domain/accounts.js';
import type { AccountRow } from '../domain/accounts.js';
import { brl } from '../domain/ledger.js';
import type { Raw } from '../domain/ledger.js';
import { AccountDialog } from './AccountDialog.js';
import { StatementDialog } from './StatementDialog.js';
import type { BankingCommand, BankingController, BankingPort, BankingSnapshot } from './ports.js';

type Open = { kind: 'account'; account: Raw | null } | { kind: 'statement'; code: string } | null;

interface Menu {
  code: string;
  anchor: HTMLElement;
}

const MENU_WIDTH = 190;

function placeMenu(anchor: HTMLElement): { top: number; left: number } | null {
  if (!anchor.isConnected) return null;
  const rect = anchor.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight || (rect.width === 0 && rect.height === 0))
    return null;
  return {
    top: Math.min(rect.bottom + 4, window.innerHeight - 150),
    left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
  };
}

function MoreMenu({
  menu,
  row,
  port,
  onEdit,
  onDelete,
  onClose,
}: {
  menu: Menu;
  row: AccountRow;
  port: BankingPort;
  onEdit(): void;
  onDelete(): void;
  onClose(): void;
}) {
  const [place, setPlace] = useState(() => placeMenu(menu.anchor));
  useEffect(() => {
    const away = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.erp-bank-more-popover') || target?.closest('[data-bank-more]')) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const follow = () => {
      const next = placeMenu(menu.anchor);
      if (!next) onClose();
      else setPlace(next);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [onClose, menu.anchor]);
  const pick = (action: () => void) => () => {
    onClose();
    action();
  };
  return createPortal(
    <div
      className="erp-bank-more-popover"
      role="menu"
      aria-label="Ações adicionais da conta bancária"
      style={place ?? undefined}
    >
      {port.canOperate ? (
        <button type="button" role="menuitem" onClick={pick(onEdit)}>
          Editar conta
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={pick(() => port.share(row.index))}>
        Compartilhar
      </button>
      {port.canOperate ? (
        <button type="button" role="menuitem" className="danger" onClick={pick(onDelete)}>
          Excluir conta
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

export function BankingWorkspace({
  snapshot,
  port,
  controller,
}: {
  snapshot: BankingSnapshot;
  port: BankingPort;
  controller: BankingController;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Open>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const rows = accountRows(snapshot.banks, snapshot.entries, port);
  const kpis = bankKpis(rows);
  const duplicates = duplicateNames(rows);
  const shown = searchAccounts(rows, query);

  async function remove(row: AccountRow) {
    const movements = movementCount(snapshot.entries, row.cod);
    if (movements) {
      port.notify(
        `Esta conta possui ${movements} lançamento(s) no extrato. Para preservar saldos e histórico ela não pode ser excluída. Edite a conta ou remova os lançamentos antes.`,
        'error',
      );
      return;
    }
    if (!port.confirm('Excluir a conta ' + (row.banco || row.cod) + '?')) return;
    try {
      await port.request({ action: 'delete-account', id: row.id });
      port.notify('Conta bancária excluída.', 'success');
    } catch (failure) {
      port.notify(messageOf(failure, 'Não foi possível excluir a conta.'), 'error');
    }
  }

  const rowsRef = useLatest(rows);
  const removeRef = useLatest(remove);
  useEffect(
    () =>
      controller.register((command: BankingCommand) => {
        if (command.kind === 'statement') return setOpen({ kind: 'statement', code: command.code });
        if (!port.canOperate)
          return port.notify('Seu perfil pode consultar, mas não alterar as contas bancárias.', 'error');
        if (command.kind === 'new') return setOpen({ kind: 'account', account: null });
        const row = rowsRef.current.find((item) => item.index === command.index);
        if (!row) return port.notify('Esta conta já não existe mais na lista. Atualize a tela.', 'error');
        if (command.kind === 'edit') return setOpen({ kind: 'account', account: row.raw });
        void removeRef.current(row);
      }),
    [controller, port, rowsRef, removeRef],
  );

  const openMenu = (row: AccountRow, button: HTMLElement) => {
    if (menu?.code === row.cod) return setMenu(null);
    setMenu({ anchor: button, code: row.cod });
  };

  const statementAccount =
    open?.kind === 'statement' ? (rows.find((row) => row.cod === open.code)?.raw ?? null) : null;
  const menuRow = menu ? rows.find((row) => row.cod === menu.code) : undefined;

  return (
    <div className="erp-bk">
      {duplicates.length ? (
        <div className="phase1-bank-duplicates">
          <b>⚠️ Revisar bancos duplicados</b>
          <span>{duplicates.map((item) => `${item.name} (${item.count})`).join(' · ')}</span>
          <small>Nenhum cadastro foi apagado automaticamente.</small>
        </div>
      ) : null}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-lbl">Total de Contas</div>
          <div className="kpi-val">{snapshot.ready ? kpis.count : '—'}</div>
          <div className="kpi-sub">
            {!snapshot.ready
              ? 'Aguardando cadastro'
              : kpis.count
                ? 'Contas cadastradas no sistema'
                : 'Nenhuma conta cadastrada'}
          </div>
        </div>
        <div className="kpi g">
          <div className="kpi-lbl">Saldo Total</div>
          <div className="kpi-val">{snapshot.ready ? 'R$ ' + brl(kpis.total) : '—'}</div>
          <div className="kpi-sub">
            {kpis.flagged
              ? 'Revise lançamentos antigos fora da precisão ou inválidos'
              : 'Saldo consolidado atualizado'}
          </div>
        </div>
      </div>
      <div className="tcard">
        <div className="tcard-hdr">
          <div className="tcard-title">Contas Cadastradas</div>
          <div className="erp-bk-toolbar">
            <input
              className="phase1-fin-search"
              type="search"
              aria-label="Buscar conta bancária"
              placeholder="🔍 Buscar banco, titular, conta ou PIX..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {port.canOperate ? (
              <button
                type="button"
                className="btn-add"
                onClick={() => setOpen({ kind: 'account', account: null })}
              >
                + Nova Conta
              </button>
            ) : null}
          </div>
        </div>
        <div className="erp-bk-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cód.</th>
                <th>Banco / Conta</th>
                <th>Tipo</th>
                <th>Titular</th>
                <th>CPF/CNPJ</th>
                <th style={{ textAlign: 'right' }}>Saldo Inicial</th>
                <th title="Data em que o saldo inicial desta conta foi lançado">Data</th>
                <th style={{ textAlign: 'right' }}>Saldo Atual</th>
                <th>PIX</th>
                <th>Obs.</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="tb-bancos">
              {!snapshot.ready ? (
                <tr>
                  <td colSpan={11} className="erp-bk-empty">
                    Carregando contas do Firebase...
                  </td>
                </tr>
              ) : !shown.length ? (
                <tr>
                  <td colSpan={11} className="erp-bk-empty">
                    {rows.length ? 'Nenhuma conta encontrada para a busca.' : 'Nenhuma conta cadastrada'}
                  </td>
                </tr>
              ) : (
                shown.map((row) => (
                  <tr key={row.id + ':' + row.index}>
                    <td className="erp-bk-muted">{row.cod}</td>
                    <td>
                      <b>{row.banco}</b>
                      {row.agencia ? <small> Ag {row.agencia}</small> : null} –{' '}
                      <small>{row.conta || '—'}</small>
                    </td>
                    <td>
                      <span className={'b ' + (row.tipo === 'Conta Terceiro' ? 'b-pend' : 'b-zerado')}>
                        {row.tipo}
                      </span>
                    </td>
                    <td>
                      {row.titular}
                      <br />
                      <span
                        className="erp-bk-company"
                        style={{ color: port.companyColor(row.company) || '#888' }}
                      >
                        {row.company}
                      </span>
                    </td>
                    <td className="erp-bk-small">{row.cpfcnpj || '—'}</td>
                    <td className="erp-bk-muted erp-bk-right">R$ {brl(row.openingBalance)}</td>
                    <td className="erp-bk-muted erp-bk-nowrap">{row.createdAt || '—'}</td>
                    <td
                      className={
                        'erp-bk-right erp-bk-balance ' +
                        (row.balanceSign < 0
                          ? 'is-negative'
                          : row.balanceSign === 0
                            ? 'is-zero'
                            : 'is-positive')
                      }
                    >
                      R$ {brl(row.balance)}
                    </td>
                    <td className="erp-bk-small">{row.pix || '—'}</td>
                    <td className="erp-bk-small">{row.obs || '—'}</td>
                    <td className="erp-bank-table-actions">
                      <div className="erp-bank-actionbar">
                        <button
                          type="button"
                          className="erp-bank-action-primary"
                          title="Abrir conciliação bancária"
                          onClick={() => port.reconcile(row.cod)}
                        >
                          Conciliar
                        </button>
                        <button
                          type="button"
                          className="erp-bank-action"
                          title="Ver extrato"
                          onClick={() => setOpen({ kind: 'statement', code: row.cod })}
                        >
                          Extrato
                        </button>
                        <button
                          type="button"
                          className="erp-bank-action"
                          title="Configurar bancos e Open Finance"
                          onClick={() => port.integrations(row.cod)}
                        >
                          Integrações
                        </button>
                        <button
                          type="button"
                          className="erp-bank-more-trigger"
                          data-bank-more={row.cod}
                          aria-haspopup="menu"
                          aria-expanded={menu?.code === row.cod}
                          title="Outras ações da conta"
                          onClick={(event) => openMenu(row, event.currentTarget)}
                        >
                          Mais ▾
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {menu && menuRow ? (
        <MoreMenu
          menu={menu}
          row={menuRow}
          port={port}
          onEdit={() => setOpen({ kind: 'account', account: menuRow.raw })}
          onDelete={() => void remove(menuRow)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {open?.kind === 'account' ? (
        <AccountDialog
          key={String(open.account?.id ?? 'novo')}
          account={open.account}
          port={port}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {statementAccount ? (
        <StatementDialog
          account={statementAccount}
          entries={snapshot.entries}
          links={snapshot.links}
          port={port}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}
