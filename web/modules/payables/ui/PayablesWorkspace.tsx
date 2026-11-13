import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toBRDate } from '../../../shared/domain/dates.js';
import { formatAmount } from '../../../shared/domain/money.js';
import { Pager, pageOf } from '../../../shared/ui/Pager.js';
import {
  banksOf,
  calendarMonth,
  categoriesOf,
  dayChips,
  dueTodayRows,
  emptyFilter,
  filterPayables,
  groupChoices,
  groupPayables,
  payableKpis,
  payableRows,
  shiftMonth,
  totalOf,
} from '../domain/payables.js';
import type { KindOption, PayableFilter, PayableRow, StatusOption } from '../domain/payables.js';
import { PURCHASE_MESSAGE, removePayables } from './actions.js';
import { GroupDeleteDialog, PayableFormDialog } from './PayableDialogs.js';
import type { PayableCommand, PayablesController, PayablesPort } from './ports.js';

interface WorkspaceProps {
  records: unknown[];
  port: PayablesPort;
  controller: PayablesController;
  companyOf(raw: Record<string, unknown>): string;
  fromPurchase(raw: Record<string, unknown>): boolean;
  onlyPurchases: boolean;
}

type DialogState = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'group'; id: string } | null;

const money = (value: number): string => 'R$ ' + formatAmount(value);
const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const monthLabel = (month: string): string => {
  if (!month) return 'Todos os meses';
  const name = MONTHS[Number(month.slice(5, 7)) - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${month.slice(0, 4)}`;
};
const weekday = (iso: string): string => (iso ? (WEEK[new Date(iso + 'T12:00:00Z').getUTCDay()] ?? '') : '');
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const KINDS: Array<[KindOption, string]> = [
  ['todos', '📋 Todos'],
  ['compra', '🏭 Fornecedores'],
  ['despesa', '🧾 Despesas'],
];
const STATUS: Array<[StatusOption, string]> = [
  ['aberto', 'Em aberto'],
  ['quitados', 'Quitadas'],
  ['atrasadas', 'Atrasadas'],
  ['todas', 'Todas'],
];

export function PayablesWorkspace({
  records,
  port,
  controller,
  companyOf,
  fromPurchase,
  onlyPurchases,
}: WorkspaceProps) {
  const today = port.today();
  const rows = useMemo(
    () => payableRows(records, { today, companyOf, fromPurchase, onlyPurchases }),
    [records, today, companyOf, fromPurchase, onlyPurchases],
  );
  const [filter, setFilter] = useState<PayableFilter>(() => emptyFilter(today));
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [calendar, setCalendar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const filtered = useMemo(() => filterPayables(rows, filter), [rows, filter]);
  const kpis = payableKpis(rows, filter, today);
  const todays = dueTodayRows(rows, today);
  const chips = dayChips(rows, filter, today);
  const current = pageOf(filtered, page, size);
  const groups = groupPayables(current.rows, filtered, {
    byCompany: filter.kind === 'despesa',
    companies: port.companies,
    today,
  });
  const visibleIds = current.rows.map((row) => row.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  const set = (patch: Partial<PayableFilter>) => {
    setFilter((previous) => ({ ...previous, ...patch }));
    setPage(1);
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const remove = useCallback(
    async (ids: string[], message: string) => {
      setBusy(true);
      try {
        if (await removePayables(port, ids, message))
          setSelected((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
      } finally {
        setBusy(false);
      }
    },
    [port],
  );

  const askDelete = useCallback(
    (id: string) => {
      const row = rowsRef.current.find((item) => item.id === id);
      if (!row) return port.notify('Essa conta já não existe mais na lista. Atualize a tela.', 'error');
      if (row.fromPurchase) return port.notify(PURCHASE_MESSAGE, 'info');
      if (row.payments)
        return port.notify(
          'Esta conta tem pagamentos. Exclua os pagamentos no histórico (🕒) antes.',
          'error',
        );
      if (groupChoices(rowsRef.current, row)) return setDialog({ kind: 'group', id });
      if (port.confirm(`Excluir a conta "${row.description || row.supplier}" — ${money(row.amount)}?`))
        void remove([id], 'Conta excluída.');
    },
    [port, remove],
  );

  const askEdit = useCallback(
    (id: string) => {
      const row = rowsRef.current.find((item) => item.id === id);
      if (!row) return port.notify('Essa conta já não existe mais na lista. Atualize a tela.', 'error');
      if (row.fromPurchase) return port.notify(PURCHASE_MESSAGE, 'info');
      setDialog({ kind: 'edit', id });
    },
    [port],
  );

  useEffect(
    () =>
      controller.register((command: PayableCommand) => {
        if (!port.canOperate)
          return port.notify('Seu perfil pode consultar, mas não alterar Contas a Pagar.', 'error');
        if (command.kind === 'new') return setDialog({ kind: 'new' });
        if (command.kind === 'edit') return askEdit(command.id);
        askDelete(command.id);
      }),
    [controller, port, askEdit, askDelete],
  );

  const deleteSelected = () => {
    const chosen = rows.filter((row) => selected.has(row.id));
    if (!chosen.length) return port.notify('Selecione ao menos uma conta.', 'error');
    const purchase = chosen.filter((row) => row.fromPurchase);
    if (purchase.length)
      return port.notify(
        `${plural(purchase.length, 'conta')} selecionada(s) ${purchase.length === 1 ? 'é' : 'são'} de pedido de compra e não se exclui(em) aqui. Desmarque ou exclua o pedido no Histórico de compras.`,
        'info',
      );
    const withPayments = chosen.filter((row) => row.payments);
    if (withPayments.length)
      return port.notify(
        `${plural(withPayments.length, 'conta')} selecionada(s) têm pagamentos. Exclua os pagamentos no histórico (🕒) antes.`,
        'error',
      );
    if (port.confirm(`Excluir ${plural(chosen.length, 'conta')} a pagar selecionada(s)?`))
      void remove(
        chosen.map((row) => row.id),
        '{n} conta(s) excluída(s).',
      );
  };

  const pickDay = (iso: string) => {
    setFilter({ ...emptyFilter(today), month: '', status: 'todas', day: iso });
    setPage(1);
  };

  const dialogRow = dialog && dialog.kind !== 'new' ? rows.find((row) => row.id === dialog.id) : undefined;
  const choices = dialog?.kind === 'group' && dialogRow ? groupChoices(rows, dialogRow) : null;
  const calendarCells = calendar ? calendarMonth(rows, calendar, today) : [];

  return (
    <div className="erp-cp">
      {todays.length ? (
        <details className="erp-cp-today">
          <summary>
            🔔 Vencem hoje: <b>{plural(todays.length, 'conta')}</b> · {money(totalOf(todays))}
          </summary>
          <ul>
            {todays.map((row) => (
              <li key={row.id}>
                <span>{row.description || row.supplier}</span>
                <b>{money(row.amount)}</b>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="kpi-grid">
        <div className="kpi r">
          <div className="kpi-lbl">A pagar ({MONTHS[Number(kpis.month.slice(5, 7)) - 1]})</div>
          <div className="kpi-val" id="kpi-cp-aberto">
            {money(kpis.open)}
          </div>
          <div className="kpi-sub">
            {kpis.openCount ? plural(kpis.openCount, 'conta') + ' em aberto' : 'Nada em aberto no mês'}
          </div>
        </div>
        <div className="kpi o">
          <div className="kpi-lbl">Vence hoje</div>
          <div className="kpi-val" id="kpi-cp-hoje">
            {kpis.dueTodayCount}
          </div>
          <div className="kpi-sub">{kpis.dueTodayCount ? money(kpis.dueToday) : 'Nada vence hoje'}</div>
        </div>
        <div className="kpi r">
          <div className="kpi-lbl">Atrasadas</div>
          <div className="kpi-val" id="kpi-cp-atrasadas">
            {kpis.overdueCount}
          </div>
          <div className="kpi-sub">{kpis.overdueCount ? money(kpis.overdue) : 'Nenhuma atrasada'}</div>
        </div>
        <div className="kpi g">
          <div className="kpi-lbl">Pagas ({MONTHS[Number(kpis.month.slice(5, 7)) - 1]})</div>
          <div className="kpi-val" id="kpi-cp-pagas">
            {money(kpis.paid)}
          </div>
          <div className="kpi-sub">
            {kpis.paidCount ? plural(kpis.paidCount, 'conta') + ' no mês' : 'Nenhuma paga no mês'}
          </div>
        </div>
      </div>

      <div className="tcard erp-cp-calendar">
        <div className="erp-cp-calendar-head">
          <button
            type="button"
            className="erp-cp-link"
            aria-expanded={Boolean(calendar)}
            onClick={() => setCalendar(calendar ? null : filter.month || today.slice(0, 7))}
          >
            📆 Calendário {calendar ? '▲' : '▼'}
          </button>
          {calendar ? (
            <div className="erp-cp-month">
              <button
                type="button"
                aria-label="Mês anterior do calendário"
                onClick={() => setCalendar(shiftMonth(calendar, -1))}
              >
                ‹
              </button>
              <span>{monthLabel(calendar)}</span>
              <button
                type="button"
                aria-label="Próximo mês do calendário"
                onClick={() => setCalendar(shiftMonth(calendar, 1))}
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
        {calendar ? (
          <div className="erp-cp-calendar-grid">
            {WEEK.map((day) => (
              <b key={day}>{day}</b>
            ))}
            {calendarCells.map((cell, index) =>
              cell ? (
                <button
                  key={cell.iso}
                  type="button"
                  disabled={!cell.count}
                  className={
                    (cell.today ? 'today ' : '') + (cell.overdue ? 'late ' : '') + (cell.count ? 'has' : '')
                  }
                  title={cell.count ? `${plural(cell.count, 'conta')} · ${money(cell.total)}` : ''}
                  onClick={() => pickDay(cell.iso)}
                >
                  <span>{cell.day}</span>
                  {cell.count ? <small>{cell.count}×</small> : null}
                  {cell.count ? <small>{money(cell.total)}</small> : null}
                </button>
              ) : (
                <i key={'blank' + index} />
              ),
            )}
          </div>
        ) : null}
      </div>

      <div className="tcard">
        <div className="erp-cp-toolbar">
          <input
            id="erp-cp-search"
            type="search"
            placeholder="🔍 Fornecedor ou histórico"
            aria-label="Buscar conta a pagar"
            value={filter.query}
            onChange={(event) => set({ query: event.target.value })}
          />
          <label>
            <span>Vence de</span>
            <input
              type="date"
              value={filter.from}
              onChange={(event) => set({ from: event.target.value, month: '', day: '' })}
            />
          </label>
          <label>
            <span>até</span>
            <input
              type="date"
              value={filter.to}
              onChange={(event) => set({ to: event.target.value, month: '', day: '' })}
            />
          </label>
          {port.canOperate ? (
            <button
              type="button"
              className="erp-cp-danger"
              title="Excluir selecionadas"
              disabled={busy || !selected.size}
              onClick={deleteSelected}
            >
              🗑️ {selected.size ? `(${selected.size})` : ''}
            </button>
          ) : null}
          {port.canOperate ? (
            <button type="button" className="btn-add" onClick={() => setDialog({ kind: 'new' })}>
              + Nova conta
            </button>
          ) : null}
        </div>

        <div className="erp-cp-chips" role="tablist" aria-label="Tipo de conta">
          {KINDS.filter(([value]) => !onlyPurchases || value !== 'despesa').map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter.kind === value}
              className={filter.kind === value ? 'active' : ''}
              onClick={() => set({ kind: value })}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="erp-cp-month-nav">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => set({ month: shiftMonth(filter.month || today.slice(0, 7), -1), day: '' })}
          >
            ‹
          </button>
          <b>{monthLabel(filter.month)}</b>
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() => set({ month: shiftMonth(filter.month || today.slice(0, 7), 1), day: '' })}
          >
            ›
          </button>
          <button
            type="button"
            className={'erp-cp-pill' + (filter.month ? '' : ' active')}
            onClick={() => set({ month: filter.month ? '' : today.slice(0, 7), day: '' })}
          >
            {filter.month ? 'Todos os meses' : 'Só este mês'}
          </button>
        </div>

        {port.companies.length ? (
          <div className="erp-cp-chips erp-cp-companies">
            <span>Empresa:</span>
            {['', ...port.companies].map((company) => (
              <button
                key={company || 'todas'}
                type="button"
                className={filter.company === company ? 'active' : ''}
                style={company ? { borderColor: port.companyColor(company) || undefined } : undefined}
                onClick={() => set({ company })}
              >
                {company || 'Todas'}
              </button>
            ))}
          </div>
        ) : null}

        <details className="erp-cp-advanced">
          <summary>Mais filtros</summary>
          <div className="erp-cp-advanced-body">
            <label>
              <span>Situação</span>
              <select
                id="erp-cp-status"
                value={filter.status}
                onChange={(event) => set({ status: event.target.value as StatusOption })}
              >
                {STATUS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Categoria</span>
              <select value={filter.category} onChange={(event) => set({ category: event.target.value })}>
                <option value="">Todas</option>
                {categoriesOf(rows).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Forma de pagamento</span>
              <select value={filter.bank} onChange={(event) => set({ bank: event.target.value })}>
                <option value="">Todas</option>
                {banksOf(rows).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Valor mín.</span>
              <input
                inputMode="decimal"
                value={filter.min}
                onChange={(event) => set({ min: event.target.value })}
              />
            </label>
            <label>
              <span>Valor máx.</span>
              <input
                inputMode="decimal"
                value={filter.max}
                onChange={(event) => set({ max: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="erp-cp-outline"
              onClick={() => {
                setFilter(emptyFilter(today));
                setPage(1);
              }}
            >
              ✕ Limpar filtros
            </button>
          </div>
        </details>

        <div className="erp-cp-summary">
          {plural(filtered.length, 'conta')} · {money(totalOf(filtered))}
          {filter.day ? ` · dia ${toBRDate(filter.day)}` : ''}
          {filter.company ? ` · ${filter.company}` : ''}
        </div>

        {chips.length ? (
          <div className="erp-cp-days" aria-label="Filtrar por dia">
            <button type="button" className={filter.day ? '' : 'active'} onClick={() => set({ day: '' })}>
              Todos
            </button>
            {chips.map((chip) => (
              <button
                key={chip.iso}
                type="button"
                className={
                  (filter.day === chip.iso ? 'active ' : '') +
                  (chip.today ? 'today' : chip.overdue ? 'late' : '')
                }
                onClick={() => set({ day: filter.day === chip.iso ? '' : chip.iso })}
              >
                {chip.iso.slice(8, 10)}/{chip.iso.slice(5, 7)}
                {chip.today ? ' 🔔' : chip.overdue ? ' ⚠️' : ''}
              </button>
            ))}
          </div>
        ) : null}

        <div className="erp-cp-table">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas desta página"
                    checked={allChecked}
                    onChange={(event) =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        visibleIds.forEach((id) => (event.target.checked ? next.add(id) : next.delete(id)));
                        return next;
                      })
                    }
                  />
                </th>
                <th>Fornecedor</th>
                <th>Histórico</th>
                <th>Forma de pagamento</th>
                <th>Vencimento</th>
                <th className="n">Valor</th>
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="tb-contas-pagar">
              {current.rows.length ? (
                groups.map((group) => (
                  <Fragment key={group.company || 'all'}>
                    {group.company ? (
                      <tr
                        className="erp-cp-company"
                        style={{ background: port.companyColor(group.company) || '#555' }}
                      >
                        <td colSpan={8}>
                          🏢 {group.company} · {plural(group.count, 'conta')} · Total {money(group.total)}
                        </td>
                      </tr>
                    ) : null}
                    {group.days.map((day) => (
                      <Fragment key={group.company + day.due}>
                        <tr className={'erp-cp-day' + (day.today ? ' today' : day.overdue ? ' late' : '')}>
                          <td colSpan={8}>
                            📆 {weekday(day.due)}, {toBRDate(day.due) || 'sem vencimento'}
                            {day.today ? ' 🔔 HOJE' : day.overdue ? ' ⚠️ ATRASADO' : ''} · Total do dia{' '}
                            {money(day.total)}
                          </td>
                        </tr>
                        {day.rows.map((row) => (
                          <PayableLine
                            key={row.id}
                            row={row}
                            port={port}
                            checked={selected.has(row.id)}
                            onCheck={(on) => toggle(row.id, on)}
                            onEdit={() => askEdit(row.id)}
                            onDelete={() => askDelete(row.id)}
                            busy={busy}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </Fragment>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="erp-cp-empty">
                    {rows.length ? 'Nenhuma conta com esses filtros.' : 'Nenhuma conta a pagar ainda.'}
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
        <PayableFormDialog row={null} port={port} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'edit' && dialogRow ? (
        <PayableFormDialog key={dialogRow.id} row={dialogRow} port={port} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'group' && dialogRow && choices ? (
        <GroupDeleteDialog
          row={dialogRow}
          choices={choices}
          onClose={() => setDialog(null)}
          onChoose={(ids, message) => {
            setDialog(null);
            void remove(ids, message);
          }}
        />
      ) : null}
    </div>
  );
}

interface LineProps {
  row: PayableRow;
  port: PayablesPort;
  checked: boolean;
  busy: boolean;
  onCheck(on: boolean): void;
  onEdit(): void;
  onDelete(): void;
}

function PayableLine({ row, port, checked, busy, onCheck, onEdit, onDelete }: LineProps) {
  const status = row.paid ? 'Pago' : row.overdue ? 'Atrasado' : row.partial ? 'Parcial' : 'Pendente';
  const badge = row.paid ? 'b-pago' : row.overdue ? 'b-atrasado' : 'b-pendente';
  return (
    <tr data-payable={row.id} className={row.overdue ? 'erp-cp-late' : ''}>
      <td>
        <input
          type="checkbox"
          aria-label={'Selecionar ' + (row.description || row.supplier)}
          checked={checked}
          onChange={(event) => onCheck(event.target.checked)}
        />
      </td>
      <td>{row.supplier || '—'}</td>
      <td>
        <b>{row.description || '—'}</b>
        {row.plannedMethod && !row.paid ? <small>Forma prevista: {row.plannedMethod}</small> : null}
        {row.fromPurchase ? <small>Pedido de compra</small> : null}
      </td>
      <td>
        {row.bankName || '—'}
        {row.company ? (
          <small style={{ color: port.companyColor(row.company) || undefined }}>{row.company}</small>
        ) : null}
      </td>
      <td>{toBRDate(row.due) || '—'}</td>
      <td className="n">
        <b>{formatAmount(row.amount)}</b>
      </td>
      <td>
        <span className={'b ' + badge}>{status}</span>
        {row.payments ? (
          <button
            type="button"
            className="erp-cp-icon"
            title="Histórico de pagamentos"
            onClick={() => port.history(row.id)}
          >
            🕒
          </button>
        ) : null}
      </td>
      <td className="erp-cp-actions">
        {port.canOperate ? (
          <button type="button" className="btn-edit" title="Editar" onClick={onEdit}>
            ✏️
          </button>
        ) : null}
        {port.canOperate && !row.paid ? (
          <button type="button" className="erp-cp-pay" disabled={busy} onClick={() => port.pay(row.id)}>
            ✅ Pagar
          </button>
        ) : null}
        {port.canOperate ? (
          <button
            type="button"
            className="btn-edit-danger"
            title="Excluir"
            disabled={busy}
            onClick={onDelete}
          >
            🗑
          </button>
        ) : null}
      </td>
    </tr>
  );
}
