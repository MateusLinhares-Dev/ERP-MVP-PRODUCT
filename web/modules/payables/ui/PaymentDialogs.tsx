import { useEffect, useMemo, useState } from 'react';
import { toBRDate } from '../../../shared/domain/dates.js';
import { toFieldText } from '../../../shared/domain/decimal.js';
import { formatAmount } from '../../../shared/domain/money.js';
import type { Outcome } from '../application/payments.js';
import { advanceOptions, bankDebit, paymentRequest } from '../domain/payment.js';
import type { PaymentForm, PaymentMode } from '../domain/payment.js';
import type { PayableRow } from '../domain/payables.js';
import { Dialog } from './PayableDialogs.js';
import type { PayablesPort } from './ports.js';

const money = (value: number): string => 'R$ ' + formatAmount(value);

interface PaymentProps {
  row: PayableRow;
  port: PayablesPort;
  onClose(): void;
}

export function PaymentDialog({ row, port, onClose }: PaymentProps) {
  const context = useMemo(() => port.payment.context(row.id), [port, row.id]);
  const options = advanceOptions(context, row.amount);
  const [operationId] = useState(() => port.payment.operation(row.id));
  const [form, setForm] = useState<PaymentForm>(() => ({
    total: toFieldText(row.amount),
    advance: '0',
    date: port.today(),
    bank: row.bankCode,
    notes: '',
  }));
  const [busy, setBusy] = useState(false);
  const [lockedFor, setLockedFor] = useState(() => port.payment.blockedSeconds(row.id));
  const [stuck, setStuck] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' | 'warn' } | null>(null);
  const set = (patch: Partial<PaymentForm>) => setForm((current) => ({ ...current, ...patch }));
  const cash = bankDebit(form);

  useEffect(() => {
    if (!port.banksReady) port.loadBanks();
  }, [port]);

  useEffect(() => {
    if (lockedFor <= 0) return undefined;
    const timer = window.setTimeout(() => setLockedFor((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [lockedFor]);

  const show = (outcome: Outcome) => {
    if (outcome.kind === 'done') {
      port.notify(outcome.message, 'success');
      onClose();
      return;
    }
    if (outcome.kind === 'blocked') setLockedFor(outcome.seconds);
    if (outcome.kind === 'info') setLockedFor(0);
    if (outcome.kind === 'error' && outcome.lock) setStuck(true);
    setMessage({
      text: outcome.message,
      tone: outcome.kind === 'error' ? 'error' : outcome.kind === 'blocked' ? 'warn' : 'info',
    });
  };

  const submit = async (mode: PaymentMode) => {
    const plan = paymentRequest(form, row, mode, {
      fornCod: context.fornCod,
      advanceLimit: options.limit,
      operationId,
    });
    if (!plan.ok) return setMessage({ text: plan.message, tone: 'error' });
    setBusy(true);
    setMessage(null);
    try {
      show(await port.payment.submit(plan.payload));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      show(await port.payment.verify(row.id, operationId));
    } finally {
      setBusy(false);
    }
  };

  const blocked = busy || stuck || lockedFor > 0;
  return (
    <Dialog title="Baixar pagamento" onClose={onClose}>
      <div className="erp-cp-paybox">
        <b>{row.description || row.supplier}</b>
        <span>Saldo em aberto: {money(row.amount)}</span>
        {row.plannedMethod ? <span>Forma prevista: {row.plannedMethod}</span> : null}
      </div>
      {message ? (
        <p
          className={
            'erp-cp-' + (message.tone === 'error' ? 'error' : message.tone === 'warn' ? 'warn' : 'hint')
          }
          role="alert"
        >
          {message.text}
        </p>
      ) : null}
      {lockedFor > 0 ? (
        <p className="erp-cp-warn">
          Existe uma baixa em processamento. Os botões voltam em {lockedFor} s; use “Verificar situação” antes
          de tentar de novo.
        </p>
      ) : null}
      <div className="erp-cp-grid">
        <label className="erp-cp-field">
          <span>Valor a quitar nesta operação (R$)</span>
          <input
            id="erp-cp-pay-total"
            inputMode="decimal"
            value={form.total}
            disabled={blocked}
            onChange={(event) => set({ total: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Data</span>
          <input
            id="erp-cp-pay-date"
            type="date"
            value={form.date}
            disabled={blocked}
            onChange={(event) => set({ date: event.target.value })}
          />
        </label>
        {options.available > 0 ? (
          <label className="erp-cp-field wide">
            <span>Abater adiantamento nesta operação (R$)</span>
            <input
              id="erp-cp-pay-advance"
              inputMode="decimal"
              value={form.advance}
              disabled={blocked}
              onChange={(event) => set({ advance: event.target.value })}
            />
            <small>
              Crédito disponível: {money(options.available)}. Para pagar só pelo banco, deixe 0. Máximo nesta
              conta: {money(options.limit)}.
            </small>
          </label>
        ) : (
          <p className="erp-cp-hint wide">Nenhum adiantamento disponível para esta conta.</p>
        )}
        {options.blocked ? (
          <p className="erp-cp-warn wide">
            Há adiantamentos vinculados a outras compras. Eles não serão usados neste pagamento.
          </p>
        ) : null}
        <p className="erp-cp-preview wide">Débito bancário nesta operação: {money(cash)}</p>
        <label className="erp-cp-field wide">
          <span>Conta bancária (debitada)</span>
          <select
            id="erp-cp-pay-bank"
            value={cash > 0 ? form.bank : ''}
            disabled={blocked || cash === 0}
            onChange={(event) => set({ bank: event.target.value })}
          >
            <option value="">
              {port.banksReady ? '— Selecione a conta —' : 'Carregando bancos autorizados...'}
            </option>
            {port.banks.map((bank) => (
              <option key={bank.cod} value={bank.cod}>
                {bank.label}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-cp-field wide">
          <span>Observação</span>
          <input
            value={form.notes}
            disabled={blocked}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </label>
      </div>
      <footer>
        <button type="button" className="erp-cp-outline" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="erp-cp-outline"
          id="erp-cp-pay-verify"
          disabled={busy}
          onClick={() => void verify()}
        >
          🔎 Verificar situação
        </button>
        {options.available > 0 ? (
          <button
            type="button"
            className="erp-cp-outline"
            id="erp-cp-pay-advance-only"
            disabled={blocked}
            onClick={() => void submit('advance-only')}
          >
            Compensar adiantamento
          </button>
        ) : null}
        <button
          type="button"
          className="erp-cp-primary"
          id="erp-cp-pay-confirm"
          disabled={blocked}
          onClick={() => void submit('pay')}
        >
          {busy ? 'Enviando...' : '✅ Confirmar pagamento'}
        </button>
      </footer>
    </Dialog>
  );
}

export function HistoryDialog({ row, port, onClose }: PaymentProps) {
  const [busy, setBusy] = useState(false);
  const remove = async (index: number) => {
    const payment = row.paymentList[index];
    if (!payment) return port.notify('Pagamento não encontrado (recarregue e tente de novo).', 'error');
    const question =
      `Excluir o pagamento de ${money(payment.amount + payment.advance)} (${payment.date || 'sem data'})?\n\nO valor volta a ser devido.` +
      (payment.amount > 0 ? `\nA saída de ${money(payment.amount)} é retirada do extrato do banco.` : '') +
      (payment.advance > 0
        ? `\nOs ${money(payment.advance)} de adiantamento voltam para o adiantamento do fornecedor.`
        : '');
    if (!port.confirm(question)) return;
    setBusy(true);
    try {
      const error = await port.payment.reverse(row, index);
      if (error) port.notify(error, 'error');
      else port.notify('Pagamento excluído. Voltou a ser devido.', 'success');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="🕒 Histórico de pagamentos" onClose={onClose}>
      <div className="erp-cp-paybox">
        <b>{row.description || row.supplier}</b>
        <span>
          Saldo em aberto: {money(row.paid ? 0 : row.amount)} · Situação:{' '}
          {row.paid ? 'Paga' : row.partial ? 'Paga em parte' : 'Pendente'}
        </span>
      </div>
      <div className="erp-cp-table">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th className="n">Valor</th>
              <th className="n">Adiantamento</th>
              <th>Banco</th>
              <th>Obs.</th>
              <th />
            </tr>
          </thead>
          <tbody id="erp-cp-history">
            {row.paymentList.length ? (
              row.paymentList.map((payment, index) => (
                <tr key={index + payment.date + payment.movementId}>
                  <td>{payment.date || toBRDate(payment.date) || '—'}</td>
                  <td className="n">{money(payment.amount)}</td>
                  <td className="n">{payment.advance ? money(payment.advance) : '—'}</td>
                  <td>{payment.bank || '—'}</td>
                  <td>{payment.notes}</td>
                  <td>
                    {port.canOperate ? (
                      <button
                        type="button"
                        className="btn-edit-danger"
                        data-payment-index={index}
                        disabled={busy}
                        onClick={() => void remove(index)}
                      >
                        Excluir
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="erp-cp-empty">
                  Nenhum pagamento registrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer>
        <button type="button" className="erp-cp-outline" onClick={onClose}>
          Fechar
        </button>
      </footer>
    </Dialog>
  );
}
