import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toBRDate } from '../../../shared/domain/dates.js';
import { formatAmount } from '../../../shared/domain/money.js';
import { Pager, pageOf } from '../../../shared/ui/Pager.js';
import {
  EMPTY_FILTER,
  filterReceivables,
  receivableKpis,
  receivableRows,
  totalOf,
} from '../domain/receivables.js';
import type { ReceivableFilter, StatusFilter } from '../domain/receivables.js';
import { removeReceivable, reopenReceivable } from './actions.js';
import { ReceivableFormDialog, ReceiveDialog } from './ReceivableDialogs.js';
import type { ReceivableCommand, ReceivablesController, ReceivablesPort } from './ports.js';

interface ReceivablesWorkspaceProps {
  records: unknown[];
  port: ReceivablesPort;
  controller: ReceivablesController;
}

type DialogState =
  | { kind: 'new'; client: string }
  | { kind: 'edit'; id: string }
  | { kind: 'receive'; id: string }
  | null;

const money = (value: number): string => 'R$ ' + formatAmount(value);
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const STATUS: Array<[StatusFilter, string]> = [
  ['abertos', 'Em aberto'],
  ['atrasados', 'Atrasados'],
  ['recebidos', 'Recebidos'],
  ['todos', 'Todos'],
];

export function ReceivablesWorkspace({ records, port, controller }: ReceivablesWorkspaceProps) {
  const today = port.today();
  const rows = useMemo(() => receivableRows(records, today), [records, today]);
  const kpis = receivableKpis(rows);
  const [filter, setFilter] = useState<ReceivableFilter>(EMPTY_FILTER);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState('');
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const filtered = useMemo(() => filterReceivables(rows, filter), [rows, filter]);
  const current = pageOf(filtered, page, size);
  const counts: Record<StatusFilter, number> = {
    abertos: kpis.openCount,
    atrasados: kpis.overdueCount,
    recebidos: kpis.receivedCount,
    todos: rows.length,
  };
  const set = (patch: Partial<ReceivableFilter>) => {
    setFilter((previous) => ({ ...previous, ...patch }));
    setPage(1);
  };

  const run = useCallback(
    async (id: string, action: typeof removeReceivable) => {
      setBusy(id);
      try {
        await action(
          port,
          rowsRef.current.find((row) => row.id === id),
        );
      } finally {
        setBusy('');
      }
    },
    [port],
  );
  const remove = useCallback((id: string) => run(id, removeReceivable), [run]);
  const reopen = useCallback((id: string) => run(id, reopenReceivable), [run]);

  useEffect(
    () =>
      controller.register((command: ReceivableCommand) => {
        if (!port.canOperate)
          return port.notify('Seu perfil pode consultar, mas não alterar Contas a Receber.', 'error');
        if (command.kind === 'new') return setDialog({ kind: 'new', client: command.client ?? '' });
        if (!rowsRef.current.some((row) => row.id === command.id))
          return port.notify('Lançamento não encontrado. Atualize a tela.', 'error');
        setDialog({ kind: command.kind, id: command.id });
      }),
    [controller, port],
  );

  const dialogRow = dialog && dialog.kind !== 'new' ? rows.find((row) => row.id === dialog.id) : undefined;

  return (
    <div className="erp-cr">
      <div className="kpi-grid">
        <div className="kpi g">
          <div className="kpi-lbl">A Receber (em aberto)</div>
          <div className="kpi-val" id="kpi-cr-aberto-val">
            {money(kpis.open)}
          </div>
          <div className="kpi-sub" id="kpi-cr-aberto-sub">
            {plural(kpis.openCount, 'lançamento')} em aberto
          </div>
        </div>
        <div className="kpi r">
          <div className="kpi-lbl">Atrasados</div>
          <div className="kpi-val" id="kpi-cr-atras-val">
            {money(kpis.overdue)}
          </div>
          <div className="kpi-sub">{plural(kpis.overdueCount, 'lançamento')} vencido(s)</div>
        </div>
        <div className="kpi o">
          <div className="kpi-lbl">Pendentes</div>
          <div className="kpi-val" id="kpi-cr-pend-val">
            {kpis.openCount}
          </div>
          <div className="kpi-sub">Lançamentos em aberto</div>
        </div>
        <div className="kpi g">
          <div className="kpi-lbl">Recebidos</div>
          <div className="kpi-val" id="kpi-cr-receb-val">
            {money(kpis.received)}
          </div>
          <div className="kpi-sub">Já quitados</div>
        </div>
      </div>

      <div className="tcard">
        <div className="tcard-hdr">
          <div className="erp-cr-status" role="tablist" aria-label="Situação">
            {STATUS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter.status === value}
                className={filter.status === value ? 'active' : ''}
                onClick={() => set({ status: value })}
              >
                {label} ({counts[value]})
              </button>
            ))}
          </div>
          {port.canOperate ? (
            <button type="button" className="btn-add" onClick={() => setDialog({ kind: 'new', client: '' })}>
              + Novo Recebimento
            </button>
          ) : null}
        </div>
        <div className="erp-cr-filters">
          <input
            id="erp-cr-search"
            type="search"
            placeholder="🔍 Buscar cliente, NF, observação ou forma..."
            aria-label="Buscar conta a receber"
            value={filter.query}
            onChange={(event) => set({ query: event.target.value })}
          />
          <label>
            <span>Vence de</span>
            <input type="date" value={filter.from} onChange={(event) => set({ from: event.target.value })} />
          </label>
          <label>
            <span>até</span>
            <input type="date" value={filter.to} onChange={(event) => set({ to: event.target.value })} />
          </label>
          <button
            type="button"
            className="erp-cr-outline"
            onClick={() => set({ query: '', from: '', to: '', client: '' })}
          >
            ✕ Limpar
          </button>
          <span className="erp-cr-count">
            {plural(filtered.length, 'lançamento')} · {money(totalOf(filtered))}
          </span>
        </div>
        <div className="erp-cr-table">
          <table>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Cliente</th>
                <th>NF / Pedido</th>
                <th>Valor R$</th>
                <th>Forma</th>
                <th>Conta</th>
                <th>Situação</th>
                <th>Recebido em</th>
                <th>Obs.</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="tb-contas-receber">
              {current.rows.length ? (
                current.rows.map((row) => (
                  <tr key={row.id} data-receivable={row.id} className={row.overdue ? 'erp-cr-late' : ''}>
                    <td>{toBRDate(row.due) || '—'}</td>
                    <td>
                      <b>{row.client || '—'}</b>
                    </td>
                    <td>{row.number || '—'}</td>
                    <td className="n">
                      <b>{formatAmount(row.amount)}</b>
                    </td>
                    <td>{row.method || '—'}</td>
                    <td>{row.bank || '—'}</td>
                    <td>
                      <span
                        className={
                          'b ' + (row.received ? 'b-pago' : row.overdue ? 'b-atrasado' : 'b-pendente')
                        }
                      >
                        {row.received ? 'Recebido' : row.overdue ? 'Atrasado' : 'Pendente'}
                      </span>
                    </td>
                    <td>{toBRDate(row.receivedOn) || '—'}</td>
                    <td className="erp-cr-notes" title={row.notes}>
                      {row.notes || '—'}
                    </td>
                    <td className="erp-cr-actions">
                      {port.canOperate && !row.received ? (
                        <button
                          type="button"
                          className="erp-cr-receive"
                          disabled={busy === row.id}
                          onClick={() => setDialog({ kind: 'receive', id: row.id })}
                        >
                          ✅ Receber
                        </button>
                      ) : null}
                      {port.canOperate && row.received ? (
                        <button
                          type="button"
                          title="Estornar baixa"
                          disabled={busy === row.id}
                          onClick={() => void reopen(row.id)}
                        >
                          ↩ Estornar
                        </button>
                      ) : null}
                      {port.canOperate ? (
                        <button
                          type="button"
                          className="btn-edit"
                          title="Editar"
                          onClick={() => setDialog({ kind: 'edit', id: row.id })}
                        >
                          ✏️
                        </button>
                      ) : null}
                      {row.saleId ? (
                        <button type="button" title="Ver a venda" onClick={() => port.openSale(row.saleId)}>
                          🔗 Venda
                        </button>
                      ) : null}
                      <button
                        type="button"
                        title="Vincular ao Cliente Fiscal"
                        onClick={() => port.openFiscal(row.id)}
                      >
                        🧾 Fiscal{row.fiscal ? ' ✓' : ''}
                      </button>
                      {port.canOperate && !row.saleId ? (
                        <button
                          type="button"
                          className="btn-edit-danger"
                          title="Excluir lançamento"
                          disabled={busy === row.id}
                          onClick={() => void remove(row.id)}
                        >
                          🗑️
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="erp-cr-empty">
                    {rows.length ? 'Nenhum lançamento com esses filtros.' : 'Nenhum lançamento ainda.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          total={filtered.length}
          page={current.page}
          pages={current.pages}
          size={size}
          onPage={setPage}
          onSize={(next) => {
            setSize(next);
            setPage(1);
          }}
        />
      </div>

      {dialog?.kind === 'new' ? (
        <ReceivableFormDialog
          row={null}
          initialClient={dialog.client}
          port={port}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'edit' && dialogRow ? (
        <ReceivableFormDialog
          key={dialogRow.id}
          row={dialogRow}
          port={port}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'receive' && dialogRow ? (
        <ReceiveDialog key={dialogRow.id} row={dialogRow} port={port} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
