import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { toFieldText } from '../../../shared/domain/decimal.js';
import { messageOf } from '../../../shared/domain/errors.js';
import { formatAmount } from '../../../shared/domain/money.js';
import { nameKey } from '../../../shared/domain/text.js';
import { chequeDifference, formRequest, receiveRequest } from '../domain/receivables.js';
import type { ChequeForm, ReceivableRow } from '../domain/receivables.js';
import type { ReceivablesPort } from './ports.js';

const METHODS = ['PIX', 'Transferência', 'Depósito', 'Dinheiro', 'Boleto', 'Cartão'] as const;
const money = (value: number): string => 'R$ ' + formatAmount(value);

function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="erp-cr-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="erp-cr-dialog">
        <header>
          <h3>{title}</h3>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={'erp-cr-field' + (wide ? ' wide' : '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

interface FormProps {
  row: ReceivableRow | null;
  initialClient?: string;
  port: ReceivablesPort;
  onClose(): void;
}

export function ReceivableFormDialog({ row, initialClient = '', port, onClose }: FormProps) {
  const [client, setClient] = useState(row?.client ?? initialClient);
  const [number, setNumber] = useState(row?.number ?? '');
  const [amount, setAmount] = useState(row ? toFieldText(row.amount) : '');
  const [due, setDue] = useState(row?.due ?? port.today());
  const [notes, setNotes] = useState(row?.notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fromSale = Boolean(row?.saleId);
  const known = !client.trim() || port.clients.some((name) => nameKey(name) === nameKey(client));

  const register = async () => {
    setBusy(true);
    try {
      await port.registerClient(client.trim());
      port.notify('Cliente cadastrado.', 'success');
    } catch (failure) {
      setError(messageOf(failure, 'Não foi possível cadastrar o cliente.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const result = formRequest({ client, number, amount, due, notes }, row);
    if (!result.ok) return setError(result.message);
    setBusy(true);
    setError('');
    try {
      await port.request(result.payload);
      port.notify(row ? 'Conta a receber atualizada.' : 'Conta a receber lançada.', 'success');
      onClose();
    } catch (failure) {
      setError(messageOf(failure, 'Não foi possível salvar.'));
      setBusy(false);
    }
  };

  return (
    <Dialog title={row ? 'Editar conta a receber' : 'Nova conta a receber'} onClose={onClose}>
      {error ? (
        <p className="erp-cr-error" role="alert">
          {error}
        </p>
      ) : null}
      {fromSale ? (
        <p className="erp-cr-hint">
          Esta conta é de uma venda: valor e cliente mudam pela venda (Vendas → editar).
        </p>
      ) : null}
      <div className="erp-cr-grid">
        <Field label="Cliente *" wide>
          <input
            id="erp-cr-client"
            list="erp-cr-clients"
            autoComplete="off"
            value={client}
            disabled={fromSale || busy}
            onChange={(event) => setClient(event.target.value)}
          />
          <datalist id="erp-cr-clients">
            {port.clients.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        {!known && !fromSale ? (
          <div className="erp-cr-hint wide">
            Cliente não cadastrado.{' '}
            <button type="button" className="erp-cr-link" disabled={busy} onClick={() => void register()}>
              ＋ Cadastrar “{client.trim().toUpperCase()}”
            </button>
          </div>
        ) : null}
        <Field label="NF / Pedido">
          <input
            id="erp-cr-number"
            value={number}
            disabled={busy}
            onChange={(event) => setNumber(event.target.value)}
          />
        </Field>
        <Field label="Valor R$ *">
          <input
            id="erp-cr-amount"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            disabled={fromSale || busy || row?.received}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label="Vencimento *">
          <input
            id="erp-cr-due"
            type="date"
            value={due}
            disabled={busy}
            onChange={(event) => setDue(event.target.value)}
          />
        </Field>
        <Field label="Observação" wide>
          <input
            id="erp-cr-notes"
            value={notes}
            disabled={busy}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
      <footer>
        <button type="button" className="erp-cr-outline" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="erp-cr-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Salvando...' : 'Salvar'}
        </button>
      </footer>
    </Dialog>
  );
}

interface ChequeDraft extends ChequeForm {
  key: number;
}

interface ReceiveProps {
  row: ReceivableRow;
  port: ReceivablesPort;
  onClose(): void;
}

export function ReceiveDialog({ row, port, onClose }: ReceiveProps) {
  const [date, setDate] = useState(port.today());
  const [bank, setBank] = useState('');
  const [method, setMethod] = useState<string>(
    METHODS.includes(row.method as (typeof METHODS)[number]) ? row.method : 'PIX',
  );
  const [cheques, setCheques] = useState<ChequeDraft[]>([]);
  const [notes, setNotes] = useState(row.notes);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { total, difference } = chequeDifference(cheques, row.amount);

  useEffect(() => {
    if (!port.banksReady) port.loadBanks();
  }, [port]);

  const setCheque = (key: number, patch: Partial<ChequeDraft>) =>
    setCheques((list) => list.map((cheque) => (cheque.key === key ? { ...cheque, ...patch } : cheque)));

  const confirm = async () => {
    const result = receiveRequest({ date, bank, method, notes, cheques }, row);
    if (!result.ok) return setError(result.message);
    if (cheques.length && difference !== 0) {
      const message =
        difference > 0
          ? `Os cheques somam ${money(total)}, mais que a conta (${money(row.amount)}). Confirmar mesmo assim?`
          : `Os cheques somam ${money(total)}, menos que a conta (${money(row.amount)}). A conta será baixada inteira. Confirmar?`;
      if (!port.confirm(message)) return;
    }
    setBusy(true);
    setError('');
    try {
      await port.request(result.payload);
      port.notify(
        cheques.length
          ? `Recebimento em ${cheques.length} cheque(s) registrado. Eles estão nos cheques do cliente.`
          : bank
            ? 'Recebimento baixado e lançado no banco.'
            : 'Recebimento baixado.',
        'success',
      );
      onClose();
    } catch (failure) {
      setError(messageOf(failure, 'Não foi possível dar baixa.'));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Dar baixa no recebimento" onClose={onClose}>
      <div className="erp-cr-summary">
        <b>{row.client}</b>
        <span>
          {money(row.amount)}
          {row.number ? ' · NF ' + row.number : ''}
        </span>
      </div>
      {error ? (
        <p className="erp-cr-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="erp-cr-grid">
        <Field label="Data do recebimento">
          <input
            id="erp-cr-receive-date"
            type="date"
            value={date}
            disabled={busy}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field label="Forma">
          <select
            value={cheques.length ? 'Cheque' : method}
            disabled={busy || cheques.length > 0}
            onChange={(event) => setMethod(event.target.value)}
          >
            {cheques.length ? <option>Cheque</option> : null}
            {METHODS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Conta bancária" wide>
          <select
            id="erp-cr-receive-bank"
            value={cheques.length ? '' : bank}
            disabled={busy || cheques.length > 0}
            onChange={(event) => setBank(event.target.value)}
          >
            <option value="">
              {port.banksReady ? '— Sem conta (dinheiro em caixa) —' : 'Carregando contas...'}
            </option>
            {port.banks.map((item) => (
              <option key={item.cod} value={item.cod}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <section className="erp-cr-cheques">
        <header>
          <b>Recebido em cheques?</b>
          <button
            type="button"
            className="erp-cr-link"
            disabled={busy}
            onClick={() =>
              setCheques((list) => [
                ...list,
                { key: Date.now() + list.length, num: '', banco: '', valor: '', bomPara: '' },
              ])
            }
          >
            ＋ Adicionar cheque
          </button>
        </header>
        {cheques.map((cheque, index) => (
          <div key={cheque.key} className="erp-cr-cheque-row">
            <input
              aria-label={'Número do cheque ' + (index + 1)}
              placeholder="Nº"
              value={cheque.num}
              onChange={(event) => setCheque(cheque.key, { num: event.target.value })}
            />
            <input
              aria-label={'Banco do cheque ' + (index + 1)}
              placeholder="Banco"
              value={cheque.banco}
              onChange={(event) => setCheque(cheque.key, { banco: event.target.value })}
            />
            <input
              aria-label={'Valor do cheque ' + (index + 1)}
              inputMode="decimal"
              placeholder="Valor"
              value={cheque.valor}
              onChange={(event) => setCheque(cheque.key, { valor: event.target.value })}
            />
            <input
              aria-label={'Bom para do cheque ' + (index + 1)}
              type="date"
              title="Bom para"
              value={cheque.bomPara}
              onChange={(event) => setCheque(cheque.key, { bomPara: event.target.value })}
            />
            <button
              type="button"
              aria-label="Remover cheque"
              onClick={() => setCheques((list) => list.filter((item) => item.key !== cheque.key))}
            >
              ✕
            </button>
          </div>
        ))}
        {cheques.length ? (
          <small className={difference ? 'erp-cr-warn' : ''}>
            Total em cheques: {money(total)}
            {difference ? ` (diferença de ${money(Math.abs(difference))})` : ' — confere com a conta'}
          </small>
        ) : (
          <small>Os cheques vão para a lista de cheques do cliente como pendentes.</small>
        )}
      </section>
      <div className="erp-cr-grid">
        <Field label="Observação" wide>
          <input value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
      <footer>
        <button type="button" className="erp-cr-outline" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="erp-cr-primary erp-cr-confirm"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? 'Salvando...' : '✅ Confirmar recebimento'}
        </button>
      </footer>
    </Dialog>
  );
}
