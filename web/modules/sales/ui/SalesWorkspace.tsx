import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatAmount } from '../../../shared/domain/money.js';
import {
  addWeighing,
  balanceInstallments,
  blankOrder,
  buildCommit,
  orderFromSale,
  priceItems,
  stockIssues,
  validateOrder,
} from '../domain/sale-order.js';
import type { SaleOrder } from '../domain/sale-order.js';
import {
  EMPTY_FILTER,
  clientCredits,
  pendingWeighings,
  saleRows,
  salesKpis,
  splitWeighings,
} from '../domain/sales.js';
import type { HistoryFilter, SalesData } from '../domain/sales.js';
import { PendingWeighings } from './PendingWeighings.js';
import { SaleHistory } from './SaleHistory.js';
import { SaleOrderForm } from './SaleOrderForm.js';
import type { SalesPort } from './ports.js';

export type SalesTab = 'pesagens' | 'lancamento' | 'historico';

export type SalesCommand =
  | { kind: 'new'; client?: string }
  | { kind: 'edit'; saleId: string }
  | { kind: 'weighing'; key: string }
  | { kind: 'tab'; tab: SalesTab };

export interface SalesController {
  register(handler: (command: SalesCommand) => void): () => void;
}

interface SalesWorkspaceProps {
  data: SalesData;
  port: SalesPort;
  controller: SalesController;
}

const money = (value: number): string => 'R$ ' + formatAmount(value);
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

let saleSequence = 0;
const newId = (prefix: string): string =>
  prefix === 'VD-'
    ? `VD-${Date.now()}${++saleSequence % 10}`
    : `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function SalesWorkspace({ data, port, controller }: SalesWorkspaceProps) {
  const today = port.today();
  const rows = useMemo(() => saleRows(data, today), [data, today]);
  const kpis = salesKpis(rows, today);
  const queue = useMemo(() => splitWeighings(pendingWeighings(data), today), [data, today]);
  const [tab, setTab] = useState<SalesTab>(() => (queue.recent.length ? 'pesagens' : 'historico'));
  const [order, setOrder] = useState<SaleOrder | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [highlight, setHighlight] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>(EMPTY_FILTER);
  const dirty = useRef(false);
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const credits = useMemo(() => (order ? clientCredits(data, order.client) : []), [data, order]);

  const update = useCallback((change: (current: SaleOrder) => SaleOrder) => {
    dirty.current = true;
    setError('');
    setOrder((current) => {
      if (!current) return current;
      const next = change(current);
      return balanceInstallments(next, clientCredits(dataRef.current, next.client));
    });
  }, []);

  const leave = useCallback((): boolean => {
    if (!order || !dirty.current) return true;
    return port.confirm('Sair do pedido de venda sem salvar? O que foi digitado será perdido.');
  }, [order, port]);

  const open = useCallback((next: SaleOrder) => {
    dirty.current = false;
    setError('');
    setOrder(balanceInstallments(next, clientCredits(dataRef.current, next.client)));
    setFormKey((key) => key + 1);
    setTab('lancamento');
  }, []);

  const openNew = useCallback(
    (client = '') => {
      if (!port.canOperate) return port.notify('Seu perfil pode consultar, mas não lançar vendas.', 'error');
      if (!leave()) return;
      open(blankOrder(port.today(), client));
    },
    [leave, open, port],
  );

  const openEdit = useCallback(
    (saleId: string) => {
      const sale = dataRef.current.sales.find((item) => String(item?.id ?? '') === saleId);
      if (!sale) return port.notify('Venda não encontrada. Atualize a tela.', 'error');
      if (!port.canOperate) return port.notify('Seu perfil pode consultar, mas não alterar vendas.', 'error');
      if (!leave()) return;
      open(orderFromSale(dataRef.current, sale, port.today()));
    },
    [leave, open, port],
  );

  const openWeighing = useCallback(
    (key: string) => {
      if (!port.canOperate) return port.notify('Seu perfil pode consultar, mas não lançar vendas.', 'error');
      if (!dataRef.current.tickets[key])
        return port.notify('Pesagem não encontrada. Atualize a tela.', 'error');
      if (!leave()) return;
      open(priceItems(addWeighing(blankOrder(port.today()), dataRef.current, key), port.priceOf));
    },
    [leave, open, port],
  );

  const showTab = useCallback(
    (next: SalesTab) => {
      if (next === 'lancamento') {
        if (!order) openNew();
        else setTab('lancamento');
        return;
      }
      setTab(next);
    },
    [order, openNew],
  );

  useEffect(
    () =>
      controller.register((command) => {
        if (command.kind === 'new') openNew(command.client ?? '');
        else if (command.kind === 'edit') openEdit(command.saleId);
        else if (command.kind === 'weighing') openWeighing(command.key);
        else showTab(command.tab);
      }),
    [controller, openNew, openEdit, openWeighing, showTab],
  );

  const cancel = () => {
    if (!leave()) return;
    dirty.current = false;
    setOrder(null);
    setError('');
    setTab(queue.recent.length ? 'pesagens' : 'historico');
  };

  const save = () => {
    if (!order || saving) return;
    const message = validateOrder(order, credits);
    if (message) {
      setError(message);
      port.notify(message, 'error');
      return;
    }
    const number = order.number.trim().toLocaleUpperCase('pt-BR');
    const repeated = number
      ? dataRef.current.sales.find(
          (sale) =>
            String(sale.id ?? '') !== order.saleId &&
            String(sale.nf ?? '')
              .trim()
              .toLocaleUpperCase('pt-BR') === number,
        )
      : undefined;
    if (
      repeated &&
      !port.confirm(
        `Já existe a venda ${order.number.trim()} para ${String(repeated.cliente ?? '')}. Salvar com o mesmo número mesmo assim?`,
      )
    )
      return;
    const issues = stockIssues(order, (material) => port.stockOf(material, order.saleId));
    if (
      issues.length &&
      !port.confirm(
        'Estoque insuficiente para: ' +
          issues.map((issue) => issue.material).join(', ') +
          '.\n\nSalvar a venda mesmo assim? O estoque desse material ficará negativo.',
      )
    )
      return;
    setSaving(true);
    try {
      const commit = buildCommit(order, {
        data: dataRef.current,
        credits,
        banks: port.banks,
        today: port.today(),
        now: Date.now(),
        user: port.user,
        newId,
      });
      port.save(commit);
      const id = String(commit.sale.id);
      dirty.current = false;
      setOrder(null);
      setHighlight(id);
      setFilter(EMPTY_FILTER);
      setTab('historico');
      port.notify(
        (order.saleId ? 'Venda atualizada. ' : 'Venda salva. ') +
          'Total ' +
          money(Number(commit.sale.total)) +
          (commit.upsertReceivables.length
            ? ` · ${plural(commit.upsertReceivables.length, 'lançamento')} em Contas a Receber.`
            : '.'),
        'success',
      );
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : 'Não foi possível salvar a venda.';
      setError(text);
      port.notify(text, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = (saleId: string) => {
    if (order?.saleId === saleId) {
      port.notify('Feche o pedido aberto antes de excluir esta venda.', 'error');
      return;
    }
    port.remove(saleId);
  };

  const tabButton = (id: SalesTab, label: string) => (
    <button
      type="button"
      id={'vstab-' + id}
      role="tab"
      aria-selected={tab === id}
      className={tab === id ? 'active' : ''}
      onClick={() => showTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="erp-sales">
      <div className="kpi-grid">
        <div className="kpi g">
          <div className="kpi-lbl">Total de Vendas</div>
          <div className="kpi-val" id="kpi-v-mes-val">
            {money(kpis.total)}
          </div>
          <div className="kpi-sub" id="kpi-v-mes-sub">
            {plural(kpis.count, 'venda')} cadastrada{kpis.count === 1 ? '' : 's'}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Vendas este mês</div>
          <div className="kpi-val" id="kpi-v-nf-val">
            {money(kpis.month)}
          </div>
          <div className="kpi-sub" id="kpi-v-nf-sub">
            {plural(kpis.monthCount, 'venda')} este mês
          </div>
        </div>
        <div className="kpi o">
          <div className="kpi-lbl">A Receber</div>
          <div className="kpi-val" id="kpi-v-pend-val">
            {money(kpis.pending)}
          </div>
          <div className="kpi-sub" id="kpi-v-pend-sub">
            {plural(kpis.pendingCount, 'pendente')}
          </div>
        </div>
        <div className="kpi erp-sales-kpi-late">
          <div className="kpi-lbl">Atrasados</div>
          <div className="kpi-val" id="kpi-v-atras-val">
            {money(kpis.overdue)}
          </div>
          <div className="kpi-sub">Vencidos</div>
        </div>
      </div>

      <div className="erp-sales-tabs" role="tablist">
        {tabButton(
          'pesagens',
          `📦 Pesagens a fechar${queue.recent.length ? ` (${queue.recent.length})` : ''}`,
        )}
        {port.canOperate || order ? tabButton('lancamento', '💰 Lançamento') : null}
        {tabButton('historico', '📋 Histórico')}
        {port.canOperate ? (
          <button type="button" className="btn-add erp-sales-new" onClick={() => openNew()}>
            + Nova Venda
          </button>
        ) : null}
      </div>

      <div hidden={tab !== 'pesagens'}>
        <PendingWeighings
          rows={queue.recent}
          old={queue.old}
          canOperate={port.canOperate}
          onOpen={openWeighing}
          onRomaneio={port.printRomaneio}
          onArchive={port.archiveWeighing}
        />
      </div>
      <div hidden={tab !== 'lancamento'} id="vendas-lancamento">
        {order ? (
          <SaleOrderForm
            key={formKey}
            order={order}
            update={update}
            data={data}
            port={port}
            credits={credits}
            saving={saving}
            error={error}
            onSave={save}
            onCancel={cancel}
          />
        ) : (
          <div className="phase4-po-saved-empty">Nenhum pedido aberto. Use “+ Nova Venda” para lançar.</div>
        )}
      </div>
      <div hidden={tab !== 'historico'}>
        <SaleHistory
          rows={rows}
          filter={filter}
          onFilter={setFilter}
          highlight={highlight}
          port={port}
          onEdit={openEdit}
          onRemove={remove}
        />
      </div>
    </div>
  );
}
