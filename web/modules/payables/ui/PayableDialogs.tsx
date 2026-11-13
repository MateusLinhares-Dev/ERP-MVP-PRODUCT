import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { toFieldText } from '../../../shared/domain/decimal.js';
import { messageOf } from '../../../shared/domain/errors.js';
import { formatAmount } from '../../../shared/domain/money.js';
import { formRequest, installmentPreview } from '../domain/payables.js';
import type { PayableForm, PayableKind, PayableRow } from '../domain/payables.js';
import type { PayablesPort } from './ports.js';

const CATEGORIES = [
  'Aluguel',
  'Energia',
  'Água',
  'Internet/Telefone',
  'Frete',
  'Folha de Pagamento',
  'Imposto / FGTS',
  'Manutenção',
  'Combustível',
  'Material de Escritório',
  'Serviços Terceiros',
  'Seguro',
  'Contabilidade',
  'Advocacia',
  'Financiamento',
  'Limpeza',
  'Alimentação',
  'Transporte',
  'Equipamentos',
  'Peças e Insumos',
  'Outros',
];

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="erp-cp-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="erp-cp-dialog">
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
    <label className={'erp-cp-field' + (wide ? ' wide' : '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

interface FormProps {
  row: PayableRow | null;
  port: PayablesPort;
  onClose(): void;
}

function initialForm(row: PayableRow | null, port: PayablesPort): PayableForm {
  const today = port.today();
  return {
    description: row?.description ?? '',
    kind: row?.kind ?? 'despesa',
    supplier: row?.supplier ?? '',
    company: row?.company ?? '',
    category: row?.category ?? '',
    bankCode: row?.bankCode ?? '',
    amount: row ? toFieldText(row.amount) : '',
    due: row?.due ?? '',
    notes: row?.notes ?? '',
    installments: false,
    count: '12',
    day: today.slice(8, 10).replace(/^0/, ''),
    firstMonth: today.slice(0, 7),
  };
}

export function PayableFormDialog({ row, port, onClose }: FormProps) {
  const [form, setForm] = useState<PayableForm>(() => initialForm(row, port));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<PayableForm>) => setForm((current) => ({ ...current, ...patch }));
  const suppliers = port.suppliers(form.kind);
  const preview = form.installments ? installmentPreview(form) : '';

  useEffect(() => {
    if (!port.banksReady) port.loadBanks();
  }, [port]);

  const chooseBank = (code: string) => {
    const bank = port.banks.find((item) => item.cod === code);
    set({ bankCode: code, ...(bank?.company && !form.company ? { company: bank.company } : {}) });
  };

  const save = async () => {
    const result = formRequest(form, row);
    if (!result.ok) return setError(result.message);
    setBusy(true);
    setError('');
    try {
      const reply = (await port.request(result.payload)) as { payables?: unknown[] } | null;
      const created = Array.isArray(reply?.payables) ? reply.payables.length : 1;
      port.notify(
        row
          ? 'Conta a pagar atualizada.'
          : created > 1
            ? `${created} parcelas lançadas em Contas a Pagar.`
            : 'Conta a pagar lançada.',
        'success',
      );
      onClose();
    } catch (failure) {
      setError(messageOf(failure, 'Não foi possível salvar.'));
      setBusy(false);
    }
  };

  return (
    <Dialog title={row ? 'Editar conta a pagar' : 'Nova conta a pagar'} onClose={onClose}>
      {error ? (
        <p className="erp-cp-error" role="alert">
          {error}
        </p>
      ) : null}
      {row ? (
        <p className="erp-cp-hint">
          Situação: <b>{row.paid ? 'Paga' : row.partial ? 'Paga em parte' : 'Pendente'}</b>. Para pagar use ✅
          Pagar; para desfazer um pagamento use o histórico (🕒).
        </p>
      ) : null}
      <div className="erp-cp-grid">
        <Field label="Descrição *" wide>
          <input
            id="erp-cp-desc"
            value={form.description}
            placeholder="Ex.: Energia, Aluguel, Financiamento..."
            disabled={busy}
            onChange={(event) => set({ description: event.target.value })}
          />
        </Field>
        {row ? null : (
          <Field label="Tipo de credor">
            <select
              id="erp-cp-kind"
              value={form.kind}
              disabled={busy}
              onChange={(event) => set({ kind: event.target.value as PayableKind })}
            >
              <option value="despesa">🧾 Despesa</option>
              <option value="compra">🏭 Fornecedor de compra</option>
            </select>
          </Field>
        )}
        <Field label="Fornecedor / credor">
          <input
            id="erp-cp-supplier"
            list="erp-cp-suppliers"
            autoComplete="off"
            value={form.supplier}
            disabled={busy}
            onChange={(event) => set({ supplier: event.target.value })}
          />
          <datalist id="erp-cp-suppliers">
            {suppliers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Empresa *">
          <select
            id="erp-cp-company"
            value={form.company}
            disabled={busy}
            onChange={(event) => set({ company: event.target.value })}
          >
            <option value="">— Selecione —</option>
            {[...new Set([...port.companies, form.company].filter(Boolean))].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categoria">
          <input
            id="erp-cp-category"
            list="erp-cp-categories"
            value={form.category}
            placeholder="Escolha ou digite"
            disabled={busy}
            onChange={(event) => set({ category: event.target.value })}
          />
          <datalist id="erp-cp-categories">
            {[...new Set([...CATEGORIES, ...port.categories])].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Banco de pagamento">
          <select
            id="erp-cp-bank"
            value={form.bankCode}
            disabled={busy}
            onChange={(event) => chooseBank(event.target.value)}
          >
            <option value="">{port.banksReady ? '— Sem banco definido —' : 'Carregando contas...'}</option>
            {[
              ...port.banks,
              ...(form.bankCode && !port.banks.some((bank) => bank.cod === form.bankCode)
                ? [{ cod: form.bankCode, label: row?.bankName || form.bankCode, company: '' }]
                : []),
            ].map((bank) => (
              <option key={bank.cod} value={bank.cod}>
                {bank.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={
            row?.paid
              ? 'Valor R$ (conta paga: travado)'
              : form.installments
                ? 'Valor R$ por parcela *'
                : 'Valor R$ *'
          }
        >
          <input
            id="erp-cp-amount"
            inputMode="decimal"
            placeholder="0,00"
            value={form.amount}
            disabled={busy || row?.paid}
            onChange={(event) => set({ amount: event.target.value })}
          />
        </Field>
        {row ? null : (
          <label className="erp-cp-check wide">
            <input
              id="erp-cp-installments"
              type="checkbox"
              checked={form.installments}
              disabled={busy}
              onChange={(event) => set({ installments: event.target.checked })}
            />
            📅 Parcelado / recorrente (financiamento, mensalidade...)
          </label>
        )}
        {form.installments ? (
          <>
            <Field label="Nº de parcelas">
              <input
                id="erp-cp-count"
                type="number"
                min={1}
                max={600}
                value={form.count}
                disabled={busy}
                onChange={(event) => set({ count: event.target.value })}
              />
            </Field>
            <Field label="Dia do vencimento">
              <input
                id="erp-cp-day"
                type="number"
                min={1}
                max={31}
                value={form.day}
                disabled={busy}
                onChange={(event) => set({ day: event.target.value })}
              />
            </Field>
            <Field label="Mês da 1ª parcela">
              <input
                id="erp-cp-first"
                type="month"
                value={form.firstMonth}
                disabled={busy}
                onChange={(event) => set({ firstMonth: event.target.value })}
              />
            </Field>
            {preview ? <p className="erp-cp-preview wide">{preview}</p> : null}
          </>
        ) : (
          <Field label="Vencimento *">
            <input
              id="erp-cp-due"
              type="date"
              value={form.due}
              disabled={busy}
              onChange={(event) => set({ due: event.target.value })}
            />
          </Field>
        )}
        <Field label="Observação" wide>
          <input
            id="erp-cp-notes"
            value={form.notes}
            disabled={busy}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
      </div>
      <footer>
        <button type="button" className="erp-cp-outline" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="erp-cp-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Salvando...' : 'Salvar'}
        </button>
      </footer>
    </Dialog>
  );
}

interface GroupProps {
  row: PayableRow;
  choices: { size: number; pending: string[]; all: string[] };
  onChoose(ids: string[], message: string): void;
  onClose(): void;
}

export function GroupDeleteDialog({ row, choices, onChoose, onClose }: GroupProps) {
  const kept = choices.size - choices.all.length;
  return (
    <Dialog title="Excluir parcela" onClose={onClose}>
      <p className="erp-cp-hint">
        <b>{row.description || row.supplier}</b> — R$ {formatAmount(row.amount)} faz parte de um lançamento
        com <b>{choices.size} parcelas</b>. O que deseja fazer?
      </p>
      <div className="erp-cp-choices">
        <button type="button" onClick={() => onChoose([row.id], 'Parcela excluída.')}>
          📌 Excluir só esta parcela
        </button>
        {choices.pending.length > 1 ? (
          <button type="button" onClick={() => onChoose(choices.pending, '{n} parcela(s) excluída(s).')}>
            ⏳ Excluir esta e as {choices.pending.length - 1} pendente(s) do grupo
          </button>
        ) : null}
        <button
          type="button"
          className="danger"
          onClick={() => onChoose(choices.all, '{n} parcela(s) excluída(s).')}
        >
          🗑️ Excluir todas as {choices.all.length} parcelas{kept ? ` (${kept} com pagamento ficam)` : ''}
        </button>
      </div>
      <footer>
        <button type="button" className="erp-cp-outline" onClick={onClose}>
          Cancelar
        </button>
      </footer>
    </Dialog>
  );
}
