import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { toISODate } from '../../../shared/domain/dates.js';
import { formatBRL } from '../../../shared/domain/money.js';
import { Dialog } from '../../../shared/ui/Dialog.js';
import {
  checkNumber,
  matchDestinations,
  type ChequeBank,
  type ControlCheque,
  type Destination,
  type Situation,
} from '../domain/control.js';
import type { BatchForm, ChequeForm } from '../domain/forms.js';

interface Busy {
  busy: boolean;
}

function DestinationField({
  form,
  destinations,
  onChange,
}: {
  form: ChequeForm;
  destinations: readonly Destination[];
  onChange(patch: Partial<ChequeForm>): void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const options = useMemo(
    () => matchDestinations(destinations, form.holder, Boolean(form.destinationType)),
    [destinations, form.holder, form.destinationType],
  );
  const choose = (item: Destination | undefined) => {
    if (!item) return;
    onChange({ holder: item.name, destinationCode: item.code, destinationType: item.type });
    setOpen(false);
    setCursor(-1);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setCursor((current) =>
        Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))),
      );
      return;
    }
    if (event.key === 'Enter' && open && options.length) {
      event.preventDefault();
      choose(options[cursor < 0 ? 0 : cursor]);
    }
  };
  let lastType = '';
  return (
    <div className="erp-cc-destination wide">
      <label htmlFor="erp-cc-holder">Cliente / Fornecedor / Destino</label>
      <div className="erp-cc-combo">
        <input
          id="erp-cc-holder"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="erp-cc-destinations"
          aria-expanded={open}
          autoComplete="off"
          placeholder="Buscar cliente ou fornecedor"
          value={form.holder}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          onChange={(event) => {
            onChange({ holder: event.target.value, destinationCode: '', destinationType: '' });
            setOpen(true);
            setCursor(-1);
          }}
        />
        <button
          type="button"
          aria-label="Mostrar clientes e fornecedores"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
        >
          ▾
        </button>
      </div>
      {form.destinationType ? (
        <small className="erp-cc-hint">
          {form.destinationType}
          {form.destinationCode ? ' · ' + form.destinationCode : ''}
        </small>
      ) : null}
      {open ? (
        <div id="erp-cc-destinations" role="listbox" className="erp-cc-options">
          {options.length ? (
            options.map((item, index) => {
              const header = item.type !== lastType ? item.type : '';
              lastType = item.type;
              return (
                <div key={item.type + '|' + item.code + '|' + item.name}>
                  {header ? <div className="erp-cc-options-group">{header}</div> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === cursor}
                    className={index === cursor ? 'is-active' : ''}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(item)}
                  >
                    <span>{item.name}</span>
                    <small>{item.code}</small>
                  </button>
                </div>
              );
            })
          ) : (
            <div className="erp-cc-options-empty">
              Nenhum cadastro encontrado. É possível informar um destino manualmente.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ChequeDialog({
  initial,
  banks,
  destinations,
  cheques,
  busy,
  onSave,
  onClose,
}: Busy & {
  initial: ChequeForm;
  banks: readonly ChequeBank[];
  destinations: readonly Destination[];
  cheques: readonly ControlCheque[];
  onSave(form: ChequeForm, numberCheck: ReturnType<typeof checkNumber>): void;
  onClose(): void;
}) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<ChequeForm>) => setForm((current) => ({ ...current, ...patch }));
  const check = checkNumber(cheques, form.bank, form.number, form.id);
  const bankNames = banks.map((bank) => bank.name);
  if (form.bank && !bankNames.includes(form.bank)) bankNames.push(form.bank);
  return (
    <Dialog title={form.id ? 'Editar cheque' : 'Novo cheque'} onClose={onClose} className="erp-cc-dialog">
      <div className="erp-cc-grid">
        <label className="erp-cp-field">
          <span>Banco</span>
          <select id="erp-cc-bank" value={form.bank} onChange={(event) => set({ bank: event.target.value })}>
            {bankNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-cp-field">
          <span>Nº do cheque</span>
          <input
            id="erp-cc-number"
            value={form.number}
            onChange={(event) => set({ number: event.target.value })}
          />
          {check.message ? (
            <small className={'erp-cc-number-hint ' + check.tone}>{check.message}</small>
          ) : null}
        </label>
        <DestinationField form={form} destinations={destinations} onChange={set} />
        <label className="erp-cp-field">
          <span>Valor (R$)</span>
          <input
            id="erp-cc-value"
            inputMode="decimal"
            placeholder="4990,00"
            value={form.value}
            onChange={(event) => set({ value: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Situação</span>
          <select
            id="erp-cc-situation"
            value={form.situation}
            onChange={(event) => set({ situation: event.target.value as Situation })}
          >
            <option value="A">A Compensar</option>
            <option value="C">Compensado</option>
            <option value="X">Cancelado</option>
          </select>
        </label>
        <label className="erp-cp-field">
          <span>Data de saída</span>
          <input
            id="erp-cc-issued"
            type="date"
            value={form.issued}
            onChange={(event) => set({ issued: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Vencimento (bom para)</span>
          <input
            id="erp-cc-due"
            type="date"
            value={form.due}
            onChange={(event) => set({ due: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Caiu em (compensado)</span>
          <input
            id="erp-cc-cleared"
            type="date"
            value={form.cleared}
            onChange={(event) => set({ cleared: event.target.value })}
          />
        </label>
      </div>
      <footer>
        <button type="button" className="erp-cp-outline" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="erp-cp-primary"
          id="erp-cc-save"
          disabled={busy}
          onClick={() => onSave(form, check)}
        >
          {busy ? 'Salvando...' : 'Salvar'}
        </button>
      </footer>
    </Dialog>
  );
}

export function BatchDialog({
  banks,
  busy,
  onSave,
  onClose,
}: Busy & { banks: readonly ChequeBank[]; onSave(form: BatchForm): void; onClose(): void }) {
  const [form, setForm] = useState<BatchForm>({
    bank: banks[0]?.name ?? '',
    holder: '',
    start: '',
    count: '',
    value: '',
    issued: '',
    due: '',
    situation: 'A',
    discountsPurchase: true,
  });
  const set = (patch: Partial<BatchForm>) => setForm((current) => ({ ...current, ...patch }));
  const start = Number.parseInt(form.start, 10) || 0;
  const count = Number.parseInt(form.count, 10) || 0;
  return (
    <Dialog title="Remessa de cheques" onClose={onClose} className="erp-cc-dialog">
      <p className="erp-cc-lead">Lança vários cheques de uma vez, com os números em sequência.</p>
      <div className="erp-cc-grid">
        <label className="erp-cp-field">
          <span>Banco</span>
          <select
            id="erp-cc-batch-bank"
            value={form.bank}
            onChange={(event) => set({ bank: event.target.value })}
          >
            {banks.map((bank) => (
              <option key={bank.name} value={bank.name}>
                {bank.name}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-cp-field">
          <span>Cliente / Destino (todos)</span>
          <input
            id="erp-cc-batch-holder"
            placeholder="Ex: FERRO VELHO"
            value={form.holder}
            onChange={(event) => set({ holder: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Nº inicial</span>
          <input
            id="erp-cc-batch-start"
            type="number"
            min={1}
            placeholder="180"
            value={form.start}
            onChange={(event) => set({ start: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Quantidade</span>
          <input
            id="erp-cc-batch-count"
            type="number"
            min={1}
            max={200}
            placeholder="10"
            value={form.count}
            onChange={(event) => set({ count: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Valor por cheque (R$)</span>
          <input
            id="erp-cc-batch-value"
            inputMode="decimal"
            placeholder="4990,00"
            value={form.value}
            onChange={(event) => set({ value: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Data de saída (todos)</span>
          <input
            id="erp-cc-batch-issued"
            type="date"
            value={form.issued}
            onChange={(event) => set({ issued: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Vencimento — bom para (todos)</span>
          <input
            id="erp-cc-batch-due"
            type="date"
            value={form.due}
            onChange={(event) => set({ due: event.target.value })}
          />
        </label>
        <label className="erp-cp-field">
          <span>Situação</span>
          <select
            id="erp-cc-batch-situation"
            value={form.situation}
            onChange={(event) => set({ situation: event.target.value === 'C' ? 'C' : 'A' })}
          >
            <option value="A">A Compensar</option>
            <option value="C">Compensado</option>
          </select>
        </label>
        <label className="erp-cc-check wide">
          <input
            type="checkbox"
            checked={form.discountsPurchase}
            onChange={(event) => set({ discountsPurchase: event.target.checked })}
          />
          Abate compra (adiantamento ao fornecedor)
        </label>
      </div>
      <div className="erp-cc-preview">
        {start > 0 && count > 0
          ? `Vai lançar ${count} cheque(s): nº ${start} até ${start + count - 1}.`
          : 'Preencha o nº inicial e a quantidade.'}
      </div>
      <footer>
        <button type="button" className="erp-cp-outline" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="erp-cp-primary" disabled={busy} onClick={() => onSave(form)}>
          {busy ? 'Lançando...' : 'Lançar todos'}
        </button>
      </footer>
    </Dialog>
  );
}

export function DepositDialog({
  pending,
  today,
  busy,
  onConfirm,
  onClose,
}: Busy & {
  pending: readonly ControlCheque[];
  today: string;
  onConfirm(date: string, selected: ControlCheque[]): void;
  onClose(): void;
}) {
  const [date, setDate] = useState(today);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(pending.map((cheque) => cheque.id)));
  const selected = pending.filter((cheque) => chosen.has(cheque.id));
  const total = Math.round(selected.reduce((sum, cheque) => sum + cheque.value, 0) * 100) / 100;
  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <Dialog title="Depositar cheques em lote (remessa)" onClose={onClose} className="erp-cc-dialog wide">
      <div className="erp-cc-deposit-top">
        <label className="erp-cp-field">
          <span>Data do depósito</span>
          <input
            id="erp-cc-deposit-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label className="erp-cc-check">
          <input
            type="checkbox"
            checked={selected.length === pending.length}
            onChange={(event) =>
              setChosen(event.target.checked ? new Set(pending.map((cheque) => cheque.id)) : new Set())
            }
          />
          Marcar todos
        </label>
      </div>
      <p className="erp-cc-lead">
        Marque os cheques que estão indo para o depósito. Ao confirmar, eles viram <b>Compensados</b> e o
        valor <b>sai do saldo do banco</b> (os marcados como “adiant.” não descontam de novo).
      </p>
      <div className="erp-cc-deposit-list">
        <table>
          <thead>
            <tr>
              <th />
              <th>Banco</th>
              <th>Nº</th>
              <th>Cliente</th>
              <th className="erp-bk-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((cheque) => (
              <tr key={cheque.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={'Depositar cheque ' + cheque.number}
                    checked={chosen.has(cheque.id)}
                    onChange={(event) => toggle(cheque.id, event.target.checked)}
                  />
                </td>
                <td>{cheque.bank || '—'}</td>
                <td>{cheque.number || '—'}</td>
                <td>
                  {cheque.holder || '—'}
                  {cheque.discountsPurchase ? <span className="erp-cc-tag">adiant.</span> : null}
                </td>
                <td className="erp-bk-right">{formatBRL(cheque.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="erp-cc-deposit-total">
        Selecionados: <span>{selected.length}</span> cheque(s) · Total: <span>{formatBRL(total)}</span>
      </div>
      <footer>
        <button type="button" className="erp-cp-outline" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button
          type="button"
          className="erp-cp-primary"
          id="erp-cc-deposit-confirm"
          disabled={busy || !selected.length || !date}
          onClick={() => onConfirm(date, selected)}
        >
          {busy ? 'Enviando...' : 'Confirmar depósito'}
        </button>
      </footer>
    </Dialog>
  );
}

export function ClearDialog({
  cheque,
  today,
  askDebit,
  busy,
  onConfirm,
  onClose,
}: Busy & {
  cheque: ControlCheque;
  today: string;
  askDebit: boolean;
  onConfirm(date: string, debit: boolean | null): void;
  onClose(): void;
}) {
  const [date, setDate] = useState(toISODate(cheque.cleared) || today);
  return (
    <Dialog title={'Compensar cheque nº ' + cheque.number} onClose={onClose}>
      <p className="erp-cc-lead">
        {cheque.bank} · {formatBRL(cheque.value)}
        {cheque.holder ? ' · ' + cheque.holder : ''}
      </p>
      <label className="erp-cp-field">
        <span>Data em que o cheque caiu no banco</span>
        <input
          id="erp-cc-clear-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      {askDebit ? (
        <p className="erp-cc-warning">
          Este cheque está marcado como “abate compra” (adiantamento). Se você já lançou ele como
          adiantamento, o saldo do banco já baixou e não precisa descontar de novo (senão conta em dobro).
        </p>
      ) : null}
      <footer>
        <button type="button" className="erp-cp-outline" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        {askDebit ? (
          <>
            <button
              type="button"
              className="erp-cp-outline"
              id="erp-cc-clear-no-debit"
              disabled={busy || !date}
              onClick={() => onConfirm(date, false)}
            >
              Só marcar como compensado
            </button>
            <button
              type="button"
              className="erp-cp-primary"
              id="erp-cc-clear-debit"
              disabled={busy || !date}
              onClick={() => onConfirm(date, true)}
            >
              Compensar e descontar do banco
            </button>
          </>
        ) : (
          <button
            type="button"
            className="erp-cp-primary"
            id="erp-cc-clear-confirm"
            disabled={busy || !date}
            onClick={() => onConfirm(date, null)}
          >
            {busy ? 'Enviando...' : 'Confirmar'}
          </button>
        )}
      </footer>
    </Dialog>
  );
}
