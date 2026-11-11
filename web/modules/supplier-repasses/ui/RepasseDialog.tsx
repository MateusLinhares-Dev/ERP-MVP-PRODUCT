import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { messageOf } from '../../../shared/domain/errors.js';
import { formatDate, formatMoney } from '../../../shared/domain/format.js';
import { newId } from '../../../shared/domain/ids.js';
import {
  amountField,
  checkPayment,
  checkReceipt,
  openBalance,
  paymentFingerprint,
  receiptFingerprint,
} from '../domain/repasses.js';
import type { RepasseList, RepasseRecord } from '../domain/repasses.js';

export interface RepasseDialogProps {
  code: string;
  name: string;
  load(code: string): Promise<RepasseList>;
  send(body: Record<string, unknown>): Promise<{ movement?: unknown }>;
  confirm(message: string): boolean;
  notify(message: string, error?: boolean): void;
  onChanged(movement?: unknown): void;
  onClose(): void;
}

interface PendingOperation {
  id: string;
  fingerprint: string;
}

interface PaymentDraft {
  id: string;
  date: string;
  amount: string;
  bank: string;
  proof: string;
}

const pendingReceipts = new Map<string, PendingOperation>();
const pendingPayments = new Map<string, PendingOperation>();

const today = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const errorCode = (error: unknown): string =>
  error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';

export function RepasseDialog({
  code,
  name,
  load,
  send,
  confirm,
  notify,
  onChanged,
  onClose,
}: RepasseDialogProps) {
  const [list, setList] = useState<RepasseList | null>(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(today);
  const [value, setValue] = useState('');
  const [obs, setObs] = useState('');
  const [draft, setDraft] = useState<PaymentDraft | null>(null);

  const refresh = useCallback(async () => {
    const fresh = await load(code);
    setList(fresh);
    return fresh;
  }, [load, code]);

  useEffect(() => {
    let active = true;
    load(code).then(
      (fresh) => {
        if (active) setList(fresh);
      },
      (error: unknown) => {
        if (active) setFailure(messageOf(error, 'Não foi possível carregar os repasses.'));
      },
    );
    return () => {
      active = false;
    };
  }, [load, code]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const receive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const checked = checkReceipt(value);
    if (!checked.ok) {
      notify(checked.message, true);
      return;
    }
    const fingerprint = receiptFingerprint(code, date, checked.value, obs);
    const previous = pendingReceipts.get(code);
    if (previous && previous.fingerprint !== fingerprint) {
      notify(
        'Há uma tentativa anterior sem confirmação. Repita os mesmos dados para verificar antes de lançar outro valor.',
        true,
      );
      return;
    }
    if (
      !confirm(
        'Confirmar entrada de ' +
          formatMoney(checked.value) +
          ' em ESPÉCIE recebida de ' +
          name +
          '? Será criado valor a repassar por PIX.',
      )
    )
      return;
    const operation = previous ?? { id: newId(), fingerprint };
    pendingReceipts.set(code, operation);
    setBusy(true);
    try {
      await send({
        action: 'receive',
        operationId: operation.id,
        fornCod: code,
        data: date,
        valor: checked.value,
        obs,
      });
      pendingReceipts.delete(code);
      setValue('');
      setObs('');
      notify('Dinheiro recebido confirmado no Firebase.');
      await refresh();
      onChanged();
    } catch (error) {
      try {
        const fresh = await refresh();
        if (fresh.records.some((record) => record.operationId === operation.id)) {
          pendingReceipts.delete(code);
          notify('Recebimento já confirmado no Firebase.');
          onChanged();
          return;
        }
      } catch {
        setFailure('Não foi possível atualizar a lista. Confira antes de repetir.');
      }
      notify(messageOf(error, 'Não foi possível registrar o recebimento.'), true);
    } finally {
      setBusy(false);
    }
  };

  const pay = async (event: FormEvent<HTMLFormElement>, record: RepasseRecord) => {
    event.preventDefault();
    if (busy || !draft || !list) return;
    const checked = checkPayment(draft.amount, record.saldo);
    if (!checked.ok) {
      notify(checked.message, true);
      return;
    }
    const bank = list.banks.find((option) => option.cod === draft.bank);
    if (!bank) {
      notify('Selecione a conta bancária de saída.', true);
      return;
    }
    const proof = draft.proof.trim();
    const fingerprint = paymentFingerprint(code, record, draft.date, checked.value, bank.cod, proof);
    const previous = pendingPayments.get(record.id);
    if (previous && previous.fingerprint !== fingerprint) {
      notify(
        'Existe uma baixa anterior sem confirmação. Não altere os dados; atualize e confira antes de registrar outra.',
        true,
      );
      return;
    }
    if (
      !confirm(
        'O PIX de ' +
          formatMoney(checked.value) +
          ' para ' +
          name +
          ' JÁ FOI REALIZADO pela conta ' +
          bank.banco +
          '?\n\nConfirmar apenas se a transferência foi feita. O ERP não envia dinheiro.',
      )
    )
      return;
    const operation = previous ?? { id: newId(), fingerprint };
    pendingPayments.set(record.id, operation);
    setBusy(true);
    try {
      const result = await send({
        action: 'pay',
        operationId: operation.id,
        fornCod: code,
        receiptId: record.id,
        expectedVersion: record.versao,
        data: draft.date,
        valor: checked.value,
        bancoCod: bank.cod,
        comprovante: proof,
      });
      pendingPayments.delete(record.id);
      setDraft(null);
      notify('Baixa do repasse confirmada; saída bancária registrada.');
      await refresh();
      onChanged(result.movement);
    } catch (error) {
      try {
        const fresh = await refresh();
        const stored = fresh.records.find((item) => item.id === record.id);
        if (stored?.pagamentos.some((payment) => payment.id === operation.id)) {
          pendingPayments.delete(record.id);
          setDraft(null);
          notify('PIX já registrado no Firebase.');
          onChanged();
          return;
        }
      } catch {
        setFailure('Não foi possível atualizar a lista. Confira antes de repetir.');
      }
      if (errorCode(error) === 'RECEIPT_CHANGED') pendingPayments.delete(record.id);
      notify(messageOf(error, 'Não foi possível registrar o PIX.'), true);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof PaymentDraft) => (next: string) =>
    setDraft((current) => (current ? { ...current, [key]: next } : current));

  return (
    <div
      id="supplier-cash-repass-modal"
      className="supplier-repass-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="supplier-repass-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-repass-title"
      >
        <header>
          <h2 id="supplier-repass-title">Recebimento em espécie / Valor a repassar</h2>
          <button type="button" id="supplier-repass-close" disabled={busy} onClick={onClose}>
            Fechar
          </button>
        </header>
        <p id="supplier-repass-supplier">
          {name} · {code}
        </p>
        <p className="supplier-repass-help">
          Registre o dinheiro que o fornecedor entregou e a obrigação de devolvê-lo via PIX. Este valor não é
          adiantamento de compra. A entrada fica registrada no controle de dinheiro em espécie e o PIX gera
          uma saída no controle bancário.{' '}
          <strong>O sistema registra o PIX já realizado; não executa a transferência.</strong>
        </p>
        <div id="supplier-repass-total" className="supplier-repass-total">
          Valor total a repassar (em aberto): {formatMoney(list ? openBalance(list.records) : 0)}
        </div>
        <form id="supplier-repass-form" onSubmit={(event) => void receive(event)}>
          <h3>Registrar dinheiro recebido</h3>
          <div className="supplier-repass-fields">
            <label>
              Data do recebimento
              <input
                type="date"
                id="supplier-repass-date"
                required
                disabled={busy}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label>
              Valor recebido (R$)
              <input
                id="supplier-repass-value"
                inputMode="decimal"
                placeholder="Ex.: 11.000,00"
                required
                disabled={busy}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <label className="wide">
              Observação
              <input
                id="supplier-repass-obs"
                placeholder="Motivo, recibo ou referência (opcional)"
                maxLength={500}
                disabled={busy}
                value={obs}
                onChange={(event) => setObs(event.target.value)}
              />
            </label>
          </div>
          <button type="submit" id="supplier-repass-save" disabled={busy}>
            Confirmar recebimento em dinheiro
          </button>
        </form>
        <div id="supplier-repass-list">
          {list ? (
            <>
              <h3>Movimentações e quitações</h3>
              {list.records.length ? (
                list.records.map((record) => (
                  <article key={record.id} className="supplier-repass-record">
                    <div>
                      <strong>{formatDate(record.data)}</strong> · Recebido {formatMoney(record.valor)} ·{' '}
                      <b>{record.status}</b>
                    </div>
                    <div>
                      Repassado: {formatMoney(record.valorPago)} ·{' '}
                      <strong>Restante: {formatMoney(record.saldo)}</strong>
                    </div>
                    {record.obs ? <div>{record.obs}</div> : null}
                    {record.pagamentos.map((payment) => (
                      <small key={payment.id || payment.data + payment.valor}>
                        PIX {formatDate(payment.data)}: {formatMoney(payment.valor)} · {payment.bancoNome}
                        {payment.comprovante ? ' · Comprovante: ' + payment.comprovante : ''}
                      </small>
                    ))}
                    {record.saldo > 0 ? (
                      <>
                        <button
                          type="button"
                          data-repass-show-pay={record.id}
                          disabled={busy}
                          onClick={() =>
                            setDraft((current) =>
                              current?.id === record.id
                                ? null
                                : {
                                    id: record.id,
                                    date: today(),
                                    amount: amountField(record.saldo),
                                    bank: '',
                                    proof: '',
                                  },
                            )
                          }
                        >
                          Registrar PIX já realizado
                        </button>
                        {draft?.id === record.id ? (
                          <form
                            className="supplier-repass-payment"
                            data-repass-form={record.id}
                            onSubmit={(event) => void pay(event, record)}
                          >
                            <div className="supplier-repass-fields">
                              <label>
                                Data do PIX
                                <input
                                  name="date"
                                  type="date"
                                  required
                                  disabled={busy}
                                  value={draft.date}
                                  onChange={(event) => field('date')(event.target.value)}
                                />
                              </label>
                              <label>
                                Valor do PIX (R$)
                                <input
                                  name="amount"
                                  inputMode="decimal"
                                  required
                                  disabled={busy}
                                  value={draft.amount}
                                  onChange={(event) => field('amount')(event.target.value)}
                                />
                              </label>
                              <label>
                                Conta bancária de saída
                                <select
                                  name="bank"
                                  required
                                  disabled={busy}
                                  value={draft.bank}
                                  onChange={(event) => field('bank')(event.target.value)}
                                >
                                  <option value="">Selecione</option>
                                  {list.banks.map((bank) => (
                                    <option key={bank.cod} value={bank.cod}>
                                      {bank.banco} — {bank.cod}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Referência/comprovante
                                <input
                                  name="proof"
                                  placeholder="Comprovante ou TXID (opcional)"
                                  maxLength={180}
                                  disabled={busy}
                                  value={draft.proof}
                                  onChange={(event) => field('proof')(event.target.value)}
                                />
                              </label>
                            </div>
                            <p className="supplier-repass-help">
                              Registre aqui somente um PIX que já foi executado fora do ERP. A confirmação
                              diminuirá a dívida e criará uma saída bancária.
                            </p>
                            <button type="submit" disabled={busy}>
                              Confirmar baixa por PIX
                            </button>
                          </form>
                        ) : null}
                      </>
                    ) : null}
                  </article>
                ))
              ) : (
                <p>Nenhum recebimento registrado para repasse.</p>
              )}
            </>
          ) : failure ? null : (
            'Carregando...'
          )}
        </div>
        <p id="supplier-repass-error" role="alert">
          {failure}
        </p>
      </section>
    </div>
  );
}
