import { useEffect, useMemo, useState } from 'react';
import { addDays, daysBetween } from '../../../shared/domain/dates.js';
import { formatAmount, formatQuantity, fromCents, toCents } from '../../../shared/domain/money.js';
import { nameKey } from '../../../shared/domain/text.js';
import {
  PAYMENT_METHODS,
  addInstallment,
  addWeighing,
  blankItem,
  creditKey,
  generateInstallments,
  lineTotal,
  methodNeedsBank,
  nextSaleNumber,
  numberOf,
  orderBalance,
  priceItems,
  removeWeighing,
  stockIssues,
} from '../domain/sale-order.js';
import type { OrderInstallment, OrderItem, SaleOrder } from '../domain/sale-order.js';
import { pendingWeighings } from '../domain/sales.js';
import type { ClientCredit, SalesData } from '../domain/sales.js';
import type { SalesPort } from './ports.js';

interface SaleOrderFormProps {
  order: SaleOrder;
  update(change: (order: SaleOrder) => SaleOrder): void;
  data: SalesData;
  port: SalesPort;
  credits: ClientCredit[];
  saving: boolean;
  error: string;
  onSave(): void;
  onCancel(): void;
}

const money = (value: number): string => 'R$ ' + formatAmount(value);

export function SaleOrderForm({
  order,
  update,
  data,
  port,
  credits,
  saving,
  error,
  onSave,
  onCancel,
}: SaleOrderFormProps) {
  const [describing, setDescribing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const balance = orderBalance(order, credits);
  const totals = balance.totals;
  const canEdit = port.canOperate && !saving;
  const queue = useMemo(() => pendingWeighings(data), [data]);
  const otherWeighings = queue.filter(
    (row) =>
      !order.weighings.includes(row.key) && (!order.client || nameKey(row.client) === nameKey(order.client)),
  );
  const materialKey = [...new Set(order.items.map((item) => item.material.trim()).filter(Boolean))]
    .sort()
    .join('|');
  const stock = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const material of materialKey ? materialKey.split('|') : [])
      map.set(nameKey(material), port.stockOf(material, order.saleId));
    return map;
  }, [materialKey, order.saleId, port]);
  const stockOf = (material: string): number | null => stock.get(nameKey(material)) ?? null;
  const issues = stockIssues(order, stockOf);

  useEffect(() => {
    if (!port.banksReady) port.loadBanks();
  }, [port]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'z'
      )
        return;
      event.preventDefault();
      update((current) => ({ ...current, items: [...current.items, blankItem()] }));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [update]);

  const setClient = (client: string) =>
    update((current) => priceItems({ ...current, client, credits: [] }, port.priceOf));

  const setItem = (index: number, patch: Partial<OrderItem>) =>
    update((current) => {
      const next = {
        ...current,
        items: current.items.map((item, position) => (position === index ? { ...item, ...patch } : item)),
      };
      return patch.material !== undefined ? priceItems(next, port.priceOf) : next;
    });

  const removeItem = (index: number) =>
    update((current) => {
      const items = current.items.filter((_, position) => position !== index);
      return { ...current, items: items.length ? items : [blankItem()] };
    });

  const setInstallment = (index: number, patch: Partial<OrderInstallment>) =>
    update((current) => ({
      ...current,
      installments: current.installments.map((row, position) => {
        if (position !== index) return row;
        const next = { ...row, ...patch };
        if (patch.method !== undefined) {
          if (patch.method === 'Permuta') next.received = true;
          if (patch.method === 'A prazo') next.received = false;
          if (!methodNeedsBank(next.method)) next.bank = '';
        }
        return next;
      }),
    }));

  const toggleCredit = (key: string) =>
    update((current) => ({
      ...current,
      credits: current.credits.includes(key)
        ? current.credits.filter((item) => item !== key)
        : [...current.credits, key],
    }));

  const generate = () => {
    const result = generateInstallments(order, credits);
    if (result.error) port.notify(result.error, 'error');
    else update(() => result.order);
  };

  const addParcel = () => {
    const result = addInstallment(order);
    if (result.error) port.notify(result.error, 'error');
    else update(() => result.order);
  };

  const openDescription = (index: number) => {
    setDraft(order.items[index]?.description ?? '');
    setDescribing(index);
  };

  const rows = order.installments;
  const parcelSum = rows.reduce((sum, row) => sum + toCents(numberOf(row.amount)), 0);
  const overflow = rows.length > 1 && toCents(numberOf(rows[rows.length - 1]?.amount ?? '')) <= 0;
  const settled = fromCents(balance.settledCents);
  const credited = fromCents(balance.creditCents);
  const describingItem = describing == null ? null : order.items[describing];

  return (
    <div className="phase4-po erp-sale-order">
      <div className="phase4-po-title">
        <div>
          <h2>{order.saleId ? 'Editar pedido de venda' : 'Pedido de venda'}</h2>
          <p>Venda de material{order.saleId && order.number ? ' · ' + order.number : ''}</p>
        </div>
        <div className="phase4-po-title-actions">
          <button type="button" className="phase4-po-outline" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="phase4-po-save" disabled={!canEdit} onClick={onSave}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
      {error ? (
        <div className="erp-sales-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="phase4-po-card">
        <h3>Cliente</h3>
        <label className="phase4-po-field full">
          <span>Cliente *</span>
          <input
            id="erp-sale-client"
            list="erp-sale-clients"
            autoComplete="off"
            placeholder="Digite ou selecione o cliente"
            value={order.client}
            disabled={order.lockedClient}
            onChange={(event) => setClient(event.target.value)}
          />
          <datalist id="erp-sale-clients">
            {port.clients.map((client) => (
              <option key={client.cod || client.nome} value={client.nome} />
            ))}
          </datalist>
        </label>
        {order.lockedClient ? (
          <small className="erp-sales-hint">
            Esta venda já tem recebimento ou abatimento, então o cliente não pode ser trocado. Para trocar,
            exclua a venda e lance de novo.
          </small>
        ) : null}
        {order.weighings.length || otherWeighings.length ? (
          <div className="phase4-po-source erp-sale-weighings">
            {order.weighings.length ? <span>Pesagens neste pedido:</span> : null}
            {order.weighings.map((key) => (
              <b key={key}>
                {String(data.tickets[key]?.ticket ?? key)}
                <button
                  type="button"
                  aria-label={'Tirar a pesagem ' + key + ' do pedido'}
                  title="Tirar esta pesagem do pedido"
                  onClick={() => update((current) => removeWeighing(current, key))}
                >
                  ✕
                </button>
              </b>
            ))}
            {otherWeighings.length ? (
              <select
                aria-label="Juntar outra pesagem de saída"
                value=""
                onChange={(event) => {
                  const key = event.target.value;
                  if (key) update((current) => priceItems(addWeighing(current, data, key), port.priceOf));
                }}
              >
                <option value="">＋ Juntar pesagem de saída{order.client ? ' deste cliente' : ''}</option>
                {otherWeighings.map((row) => (
                  <option key={row.key} value={row.key}>
                    {row.ticket} · {row.client} · {formatQuantity(row.kg)} kg
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="phase4-po-card">
        <h3>Itens do pedido de venda</h3>
        <div className="phase4-po-table-wrap">
          <table className="phase4-po-table erp-sale-items">
            <thead>
              <tr>
                <th>#</th>
                <th>Item / Material</th>
                <th>Observação</th>
                <th>Un.</th>
                <th>Quantidade</th>
                <th>Preço unitário</th>
                <th>Preço total</th>
                <th>Estoque</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="erp-sale-items">
              {order.items.map((item, index) => {
                const available = item.material.trim() ? stockOf(item.material) : null;
                const short = available != null && numberOf(item.quantity) > available + 0.0001;
                const filled = item.description.trim().length > 0;
                return (
                  <tr key={item.key}>
                    <td className="idx">{index + 1}</td>
                    <td>
                      <input
                        list="erp-sale-materials"
                        placeholder="Material"
                        aria-label={'Material do item ' + (index + 1)}
                        value={item.material}
                        onChange={(event) => setItem(index, { material: event.target.value })}
                      />
                    </td>
                    <td className="description">
                      <button
                        type="button"
                        className={'phase4-po-detail-button' + (filled ? ' active' : '')}
                        title={filled ? 'Descrição detalhada preenchida' : 'Adicionar descrição detalhada'}
                        onClick={() => openDescription(index)}
                      >
                        <span className="phase4-po-detail-icon">📄</span>
                        <span className="phase4-po-detail-label">{filled ? 'Preenchida' : 'Adicionar'}</span>
                      </button>
                    </td>
                    <td>
                      <span className="phase4-po-unit">{item.unit || 'kg'}</span>
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={'Quantidade do item ' + (index + 1)}
                        value={item.quantity}
                        readOnly={Boolean(item.weighing)}
                        title={item.weighing ? 'Quantidade vinda da pesagem ' + item.weighing : undefined}
                        onChange={(event) => setItem(index, { quantity: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        placeholder="0,00"
                        aria-label={'Preço unitário do item ' + (index + 1)}
                        value={item.price}
                        onChange={(event) => setItem(index, { price: event.target.value })}
                      />
                    </td>
                    <td className="total">
                      <input
                        className="phase4-po-row-total"
                        readOnly
                        tabIndex={-1}
                        aria-label={'Preço total do item ' + (index + 1)}
                        value={money(lineTotal(item))}
                      />
                    </td>
                    <td
                      className={
                        'erp-sale-stock' +
                        (short ? ' short' : available != null && available <= 0 ? ' empty' : '')
                      }
                    >
                      {available == null
                        ? '—'
                        : `${short ? '❌' : available <= 0 ? '⚠️' : '✅'} ${formatQuantity(available)} kg`}
                    </td>
                    <td className="action">
                      {item.weighing ? (
                        <span className="phase4-po-locked" title={'Item da pesagem ' + item.weighing}>
                          🔒
                        </span>
                      ) : (
                        <button type="button" title="Remover item" onClick={() => removeItem(index)}>
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <datalist id="erp-sale-materials">
          {port.materials.map((material) => (
            <option key={material} value={material} />
          ))}
        </datalist>
        {issues.length ? (
          <div className="phase4-po-duplicate-warnings" role="status">
            Estoque insuficiente:{' '}
            {issues
              .map(
                (issue) =>
                  `${issue.material} (pedido ${formatQuantity(issue.requested)} kg, disponível ${formatQuantity(Math.max(0, issue.available))} kg)`,
              )
              .join('; ')}
            . A venda pode ser salva, mas o estoque ficará negativo.
          </div>
        ) : null}
        <button
          type="button"
          className="phase4-po-add-item"
          title="Adicionar material (Alt+Z)"
          aria-keyshortcuts="Alt+Z"
          onClick={() => update((current) => ({ ...current, items: [...current.items, blankItem()] }))}
        >
          ＋ Adicionar outro item
        </button>
      </section>

      <section className="phase4-po-card phase4-po-notes-card">
        <h3>Observações</h3>
        <label className="phase4-po-field phase4-po-order-notes" htmlFor="erp-sale-notes">
          <span>Observações do pedido</span>
          <textarea
            id="erp-sale-notes"
            rows={4}
            placeholder="Digite as observações"
            value={order.notes}
            onChange={(event) => update((current) => ({ ...current, notes: event.target.value }))}
          />
        </label>
      </section>

      <div className="phase4-po-columns">
        <section className="phase4-po-card">
          <h3>Totais da venda</h3>
          <div className="phase4-po-summary">
            <div>
              <span>Nº de itens</span>
              <b>{totals.itemCount}</b>
            </div>
            <div>
              <span>Soma das quantidades</span>
              <b>{formatQuantity(totals.quantity)} kg</b>
            </div>
            <div>
              <span>Total dos produtos</span>
              <b>{money(totals.products)}</b>
            </div>
            <div className="grand">
              <span>Total do pedido</span>
              <b id="erp-sale-total">{money(totals.total)}</b>
            </div>
          </div>
          <div className="phase4-po-form-grid two">
            <label className="phase4-po-field">
              <span>Desconto R$</span>
              <input
                inputMode="decimal"
                placeholder="0,00"
                value={order.discount}
                onChange={(event) => update((current) => ({ ...current, discount: event.target.value }))}
              />
            </label>
            <label className="phase4-po-field">
              <span>Frete / acréscimos R$</span>
              <input
                inputMode="decimal"
                placeholder="0,00"
                value={order.freight}
                onChange={(event) => update((current) => ({ ...current, freight: event.target.value }))}
              />
            </label>
          </div>
        </section>
        <section className="phase4-po-card">
          <h3>Detalhes da venda</h3>
          <div className="phase4-po-form-grid">
            <label className="phase4-po-field">
              <span>Nº do pedido / NF</span>
              <input
                id="erp-sale-number"
                placeholder={order.saleId ? '' : 'Automático: ' + nextSaleNumber(data.sales)}
                value={order.number}
                onChange={(event) => update((current) => ({ ...current, number: event.target.value }))}
              />
            </label>
            <label className="phase4-po-field">
              <span>Ordem de compra do cliente</span>
              <input
                value={order.customerOrder}
                onChange={(event) => update((current) => ({ ...current, customerOrder: event.target.value }))}
              />
            </label>
            <label className="phase4-po-field">
              <span>Data da venda</span>
              <input
                id="erp-sale-date"
                type="date"
                value={order.date}
                onChange={(event) => update((current) => ({ ...current, date: event.target.value }))}
              />
            </label>
          </div>
        </section>
      </div>

      <section className="phase4-po-card">
        <h3>Recebimento</h3>
        <div className="phase4-po-payment-head">
          <div className="phase4-po-payment-total">
            <span>{settled > 0 ? 'Já recebido + abatimentos' : 'Adiantamentos / abatimentos'}</span>
            <b id="erp-sale-credited">{money(settled + credited)}</b>
          </div>
          <div className="phase4-po-payment-total main">
            <span>Saldo a receber</span>
            <b id="erp-sale-balance">{money(fromCents(balance.balanceCents))}</b>
          </div>
        </div>
        {order.locked.length ? (
          <div className="erp-sale-locked">
            <h4>Já recebido nesta venda</h4>
            {order.locked.map((row, index) => (
              <div key={row.id || 'antigo-' + index} className="phase4-po-pay-row erp-sale-locked-row">
                <span aria-hidden="true">🔒</span>
                <span>
                  <b>{row.method}</b>
                  <small>
                    {[row.date ? row.date.split('-').reverse().join('/') : '', row.bank, row.notes]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <strong>{money(row.amount)}</strong>
              </div>
            ))}
            <small className="erp-sales-hint">
              Recebimentos já lançados não mudam aqui. Para estornar, use Contas a Receber.
            </small>
          </div>
        ) : null}
        <div className="phase4-po-pay-list">
          {credits.length ? (
            credits.map((credit) => {
              const key = creditKey(credit);
              return (
                <label key={key} className="phase4-po-pay-row">
                  <input
                    type="checkbox"
                    className="erp-sale-credit"
                    checked={order.credits.includes(key)}
                    disabled={!canEdit}
                    onChange={() => toggleCredit(key)}
                  />
                  <span>
                    <b>
                      {credit.kind === 'cheque' ? 'Cheque nº ' + credit.ref : 'Adiantamento ' + credit.ref}
                    </b>
                    <small>{credit.detail || '—'}</small>
                  </span>
                  <strong>{money(credit.amount)}</strong>
                </label>
              );
            })
          ) : (
            <div className="phase4-po-empty-pay">
              {order.client.trim()
                ? 'Nenhum adiantamento ou cheque pendente para este cliente.'
                : 'Escolha o cliente para ver adiantamentos e cheques dele.'}
            </div>
          )}
        </div>
        {balance.creditError ? (
          <div className="phase4-po-empty-pay phase4-po-installments-alert" role="alert">
            {balance.creditError}
          </div>
        ) : null}

        <div className="phase4-po-installments">
          <div className="phase4-po-installments-head">
            <h4>Parcelas</h4>
            <div className="phase4-po-installments-tools" hidden={balance.balanceCents <= 0}>
              <label className="phase4-po-field">
                <span>Condição de pagamento</span>
                <input
                  id="erp-sale-condition"
                  autoComplete="off"
                  placeholder="Ex.: 3x (mesmo dia) ou 0 30 60"
                  value={order.condition}
                  onChange={(event) =>
                    update((current) => ({ ...current, condition: event.target.value.slice(0, 80) }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      generate();
                    }
                  }}
                />
              </label>
              <button type="button" className="phase4-po-outline" onClick={generate}>
                Gerar parcelas
              </button>
            </div>
          </div>
          {balance.balanceCents <= 0 ? (
            <div className="phase4-po-empty-pay">
              Sem saldo a receber: não há parcelas para lançar em Contas a Receber.
            </div>
          ) : (
            <>
              <div className="phase4-po-table-wrap">
                <table className="phase4-po-table phase4-po-installments-table erp-sale-installments">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Dias</th>
                      <th>Data</th>
                      <th>Valor</th>
                      <th>Forma</th>
                      <th>Conta</th>
                      <th>Recebido</th>
                      <th>Observação</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const last = index === rows.length - 1;
                      const methods = PAYMENT_METHODS.includes(row.method as (typeof PAYMENT_METHODS)[number])
                        ? PAYMENT_METHODS
                        : [...PAYMENT_METHODS, ...(row.method ? [row.method] : [])];
                      const needsBank = methodNeedsBank(row.method);
                      return (
                        <tr key={row.key} data-installment={index}>
                          <td className="idx">{index + 1}</td>
                          <td className="days">
                            <input
                              type="number"
                              min={0}
                              max={9999}
                              inputMode="numeric"
                              aria-label={'Dias da parcela ' + (index + 1)}
                              value={Math.max(0, daysBetween(order.date, row.dueDate))}
                              onChange={(event) =>
                                setInstallment(index, {
                                  dueDate: addDays(
                                    order.date,
                                    Math.max(0, Math.min(9999, Number(event.target.value) || 0)),
                                  ),
                                })
                              }
                            />
                          </td>
                          <td className="date">
                            <input
                              type="date"
                              aria-label={'Vencimento da parcela ' + (index + 1)}
                              value={row.dueDate}
                              onChange={(event) => setInstallment(index, { dueDate: event.target.value })}
                            />
                          </td>
                          <td className="value">
                            <input
                              inputMode="decimal"
                              aria-label={'Valor da parcela ' + (index + 1)}
                              value={last ? formatAmount(numberOf(row.amount)) : row.amount}
                              readOnly={last}
                              title={
                                last && rows.length > 1
                                  ? 'Calculada automaticamente: saldo menos as outras parcelas'
                                  : undefined
                              }
                              onChange={(event) => setInstallment(index, { amount: event.target.value })}
                            />
                          </td>
                          <td className="form">
                            <select
                              aria-label={'Forma da parcela ' + (index + 1)}
                              value={row.method}
                              onChange={(event) => setInstallment(index, { method: event.target.value })}
                            >
                              <option value="">—</option>
                              {methods.map((method) => (
                                <option key={method} value={method}>
                                  {method}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="form">
                            <select
                              aria-label={'Conta da parcela ' + (index + 1)}
                              value={needsBank ? row.bank : ''}
                              disabled={!needsBank}
                              onChange={(event) => setInstallment(index, { bank: event.target.value })}
                            >
                              <option value="">{port.banksReady ? '—' : 'Carregando...'}</option>
                              {row.bank && !port.banks.some((bank) => bank.cod === row.bank) ? (
                                <option value={row.bank}>{row.bank}</option>
                              ) : null}
                              {port.banks.map((bank) => (
                                <option key={bank.cod} value={bank.cod}>
                                  {bank.label ?? bank.banco}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="erp-sale-received">
                            <input
                              type="checkbox"
                              aria-label={'Parcela ' + (index + 1) + ' já recebida'}
                              checked={row.received}
                              disabled={row.method === 'A prazo' || row.method === 'Permuta'}
                              onChange={(event) => setInstallment(index, { received: event.target.checked })}
                            />
                          </td>
                          <td className="obs">
                            <input
                              maxLength={200}
                              placeholder="Ex.: boleto 1234"
                              aria-label={'Observação da parcela ' + (index + 1)}
                              value={row.notes}
                              onChange={(event) => setInstallment(index, { notes: event.target.value })}
                            />
                          </td>
                          <td className="action">
                            {rows.length > 1 ? (
                              <button
                                type="button"
                                title="Remover parcela"
                                onClick={() =>
                                  update((current) => ({
                                    ...current,
                                    installments: current.installments.filter(
                                      (_, position) => position !== index,
                                    ),
                                  }))
                                }
                              >
                                ×
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="phase4-po-installments-foot">
                <button type="button" className="phase4-po-add-item" onClick={addParcel}>
                  ＋ Adicionar outra parcela
                </button>
                <span className={overflow ? 'phase4-po-installments-alert' : ''}>
                  {overflow
                    ? 'A soma das parcelas passa do saldo a receber. Ajuste os valores.'
                    : `${rows.length} ${rows.length === 1 ? 'parcela' : 'parcelas'} · total ${money(fromCents(parcelSum))}${rows.length > 1 ? ' · a última é calculada automaticamente' : ''}`}
                </span>
              </div>
              <small className="erp-sales-hint">
                Marque "Recebido" no que já entrou (dinheiro, PIX no ato). Com conta escolhida, o valor entra
                no saldo do banco. O resto fica em Contas a Receber.
              </small>
            </>
          )}
        </div>
      </section>

      <div className="phase4-po-footer">
        <button type="button" className="phase4-po-outline" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="phase4-po-save erp-sale-save" disabled={!canEdit} onClick={onSave}>
          {saving ? 'Salvando...' : 'Salvar pedido de venda'}
        </button>
      </div>

      {describingItem ? (
        <div
          className="phase4-po-description-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Descrição detalhada"
        >
          <div className="phase4-po-description-modal">
            <header>
              <div>
                <h3>Descrição detalhada</h3>
                <small>{describingItem.material || 'Item ' + ((describing ?? 0) + 1)}</small>
              </div>
              <button type="button" aria-label="Fechar" onClick={() => setDescribing(null)}>
                ✕
              </button>
            </header>
            <textarea
              rows={8}
              autoFocus
              placeholder="Detalhes do material, qualidade, classificação ou instruções para o pedido..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <footer>
              <button type="button" className="phase4-po-outline" onClick={() => setDescribing(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="phase4-po-save"
                onClick={() => {
                  if (describing != null) setItem(describing, { description: draft.trim() });
                  setDescribing(null);
                }}
              >
                Salvar descrição
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
