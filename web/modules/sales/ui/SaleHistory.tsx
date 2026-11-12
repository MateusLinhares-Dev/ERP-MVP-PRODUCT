import { useEffect, useMemo, useState } from 'react';
import { toBRDate } from '../../../shared/domain/dates.js';
import { formatAmount, formatQuantity } from '../../../shared/domain/money.js';
import { escapeHtml } from '../../../shared/print/order-print.js';
import { Pager, pageOf } from '../../../shared/ui/Pager.js';
import { EMPTY_FILTER, filterSales, summarize } from '../domain/sales.js';
import type { HistoryFilter, SaleRow, StatusFilter } from '../domain/sales.js';
import type { SalesPort } from './ports.js';

interface SaleHistoryProps {
  rows: SaleRow[];
  filter: HistoryFilter;
  onFilter(filter: HistoryFilter): void;
  highlight: string;
  port: SalesPort;
  onEdit(saleId: string): void;
  onRemove(saleId: string): void;
}

const money = (value: number): string => 'R$ ' + formatAmount(value);

function listHtml(rows: readonly SaleRow[], title: string): string {
  const total = summarize(rows);
  const body = rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(toBRDate(row.date))}</td><td>${escapeHtml(row.number || '—')}</td><td>${escapeHtml(row.client)}</td><td>${escapeHtml(
          row.materials.join(', '),
        )}</td><td class="n">${formatQuantity(row.kg)}</td><td class="n">${formatAmount(row.total)}</td><td class="n">${formatAmount(
          row.received,
        )}</td><td class="n">${formatAmount(row.pending)}</td><td>${escapeHtml(row.status)}</td></tr>`,
    )
    .join('');
  return `<main class="sales-list"><h1>${escapeHtml(title)}</h1><table><thead><tr><th>Data</th><th>Pedido/NF</th><th>Cliente</th><th>Materiais</th><th>Qtde (kg)</th><th>Total R$</th><th>Recebido R$</th><th>A receber R$</th><th>Situação</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th colspan="4">${rows.length} venda(s)</th><th class="n">${formatQuantity(
    total.kg,
  )}</th><th class="n">${formatAmount(total.total)}</th><th class="n">${formatAmount(total.received)}</th><th class="n">${formatAmount(
    total.pending,
  )}</th><th></th></tr></tfoot></table></main>`;
}

export function SaleHistory({ rows, filter, onFilter, highlight, port, onEdit, onRemove }: SaleHistoryProps) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const filtered = useMemo(() => filterSales(rows, filter), [rows, filter]);
  const totals = summarize(filtered);
  const current = pageOf(filtered, page, size);
  const set = (patch: Partial<HistoryFilter>) => {
    onFilter({ ...filter, ...patch });
    setPage(1);
  };

  const [shown, setShown] = useState('');
  if (highlight && highlight !== shown) {
    setShown(highlight);
    const index = filtered.findIndex((row) => row.id === highlight);
    if (index >= 0) setPage(Math.floor(index / size) + 1);
  }

  useEffect(() => {
    if (!highlight) return;
    document
      .querySelector(`#tb-vendas-list tr[data-sale="${CSS.escape(highlight)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [highlight, current.page]);

  const title =
    'Histórico de vendas' +
    (filter.from || filter.to
      ? ` — ${toBRDate(filter.from) || 'início'} a ${toBRDate(filter.to) || 'hoje'}`
      : '') +
    (filter.client ? ` — ${filter.client}` : '');

  return (
    <div className="erp-sales-history">
      <div className="erp-sales-filters">
        <label>
          <span>Status:</span>
          <select
            id="vh-status"
            value={filter.status}
            onChange={(event) => set({ status: event.target.value as StatusFilter })}
          >
            <option value="todos">Todos</option>
            <option value="pendente">A receber</option>
            <option value="pago">Recebidos</option>
          </select>
        </label>
        <label>
          <span>Cliente:</span>
          <input
            id="vh-cli"
            placeholder="🔍 Digite o nome..."
            value={filter.client}
            onChange={(event) => set({ client: event.target.value })}
          />
        </label>
        <label>
          <span>De:</span>
          <input
            id="vh-de"
            type="date"
            value={filter.from}
            onChange={(event) => set({ from: event.target.value })}
          />
        </label>
        <label>
          <span>Até:</span>
          <input
            id="vh-ate"
            type="date"
            value={filter.to}
            onChange={(event) => set({ to: event.target.value })}
          />
        </label>
        <button type="button" className="erp-sales-clear" onClick={() => set(EMPTY_FILTER)}>
          ✕ Limpar
        </button>
        <button
          type="button"
          className="erp-sales-print-list"
          onClick={() => port.printList(title, listHtml(filtered, title))}
        >
          🖨️ Imprimir lista
        </button>
        <span className="erp-sales-count">
          {filtered.length} de {rows.length} vendas
        </span>
      </div>
      <div className="erp-sales-search">
        <input
          id="vendas-busca"
          type="search"
          placeholder="🔍 Buscar por pedido, NF, cliente ou material..."
          aria-label="Buscar venda"
          value={filter.query}
          onChange={(event) => set({ query: event.target.value })}
        />
      </div>
      <div className="erp-sales-totals">
        <div>
          <span>Total do período</span>
          <b id="vh-total-val">{money(totals.total)}</b>
        </div>
        <div>
          <span>Peso total</span>
          <b id="vh-kg-val">{formatQuantity(totals.kg)} kg</b>
        </div>
        <div>
          <span>Recebido</span>
          <b id="vh-receb-val">{money(totals.received)}</b>
        </div>
        <div className="due">
          <span>A receber</span>
          <b id="vh-pend-val">{money(totals.pending)}</b>
        </div>
      </div>
      <div className="erp-sales-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Pedido / NF</th>
              <th>Cliente</th>
              <th>Materiais</th>
              <th>Qtde (kg)</th>
              <th>Total R$</th>
              <th>Recebido R$</th>
              <th>A receber R$</th>
              <th>Vencimento</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="tb-vendas-list">
            {current.rows.length ? (
              current.rows.map((row) => (
                <tr
                  key={row.id}
                  data-sale={row.id}
                  className={[
                    row.settled ? '' : row.overdue ? 'erp-sale-overdue' : 'erp-sale-open',
                    row.id === highlight ? 'erp-sale-highlight' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td>{toBRDate(row.date) || '—'}</td>
                  <td>{row.number || '—'}</td>
                  <td>
                    <b>{row.client || '—'}</b>
                  </td>
                  <td className="erp-sale-materials">{row.materials.join(', ') || '—'}</td>
                  <td className="n">{formatQuantity(row.kg)}</td>
                  <td className="n">
                    <b>{formatAmount(row.total)}</b>
                  </td>
                  <td className="n">{formatAmount(row.received)}</td>
                  <td className="n">{formatAmount(row.pending)}</td>
                  <td>
                    {toBRDate(row.due) || '—'}
                    {row.overdue ? <span className="erp-sale-late"> ⏰ atrasado</span> : null}
                  </td>
                  <td>
                    <span
                      className={
                        'b ' + (row.settled ? 'b-pago' : row.status === 'A prazo' ? 'b-zerado' : 'b-pend')
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="erp-sale-actions">
                    <button
                      type="button"
                      title="Imprimir pedido de venda"
                      onClick={() => port.printSale(row.id)}
                    >
                      🖨️
                    </button>
                    {port.canOperate ? (
                      <button
                        type="button"
                        className="btn-edit"
                        title="Editar"
                        onClick={() => onEdit(row.id)}
                      >
                        ✏️
                      </button>
                    ) : null}
                    {port.canOperate ? (
                      row.settled ? (
                        <button
                          type="button"
                          className="erp-sale-reopen"
                          title="Reabrir (voltar a pendente)"
                          onClick={() => port.reopen(row.id)}
                        >
                          ↩ Reabrir
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="erp-sale-paid"
                          title="Marcar como recebida"
                          onClick={() => port.markPaid(row.id)}
                        >
                          ✔ Pago
                        </button>
                      )
                    ) : null}
                    <button
                      type="button"
                      className="erp-sale-ledger"
                      title="Ficha financeira do cliente"
                      onClick={() => port.openLedger(row.client)}
                    >
                      📋 Ficha
                    </button>
                    <button
                      type="button"
                      className="erp-sale-cr"
                      title="Ver em Contas a Receber"
                      onClick={() => port.openReceivables(row.id)}
                    >
                      📥 CR
                    </button>
                    {port.canOperate ? (
                      <button
                        type="button"
                        className="btn-edit-danger"
                        title="Excluir venda"
                        onClick={() => onRemove(row.id)}
                      >
                        🗑️
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="erp-sales-empty">
                  {rows.length
                    ? 'Nenhuma venda encontrada com esses filtros.'
                    : 'Nenhuma venda lançada ainda.'}
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
  );
}
