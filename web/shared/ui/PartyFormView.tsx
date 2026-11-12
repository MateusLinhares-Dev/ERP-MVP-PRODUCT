import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatCep, formatCnpj, formatCpf, formatPhone } from '../domain/documents.js';
import { messageOf } from '../domain/errors.js';
import { CONTRIBUINTE_OPTIONS, checkPartyForm, partyPayload } from '../domain/party.js';
import type { PartyForm } from '../domain/party.js';

export interface PartyKind {
  noun: 'fornecedor' | 'cliente';
  title: string;
  subtitle: string;
  ids: { create: string; edit: string };
  className: string;
  withLimit: boolean;
}

export const SUPPLIER_KIND: PartyKind = {
  noun: 'fornecedor',
  title: 'fornecedor',
  subtitle: 'Cadastro comercial usado em compras, preços, financeiro e documentos.',
  ids: { create: 'nf', edit: 'ef' },
  className: 'erp-supplier',
  withLimit: false,
};

export const CUSTOMER_KIND: PartyKind = {
  noun: 'cliente',
  title: 'cliente',
  subtitle: 'Cadastro comercial usado em vendas, preços, contas a receber e documentos.',
  ids: { create: 'nc', edit: 'ec' },
  className: 'erp-customer',
  withLimit: true,
};

export interface PartyFormViewProps {
  kind: PartyKind;
  code: string;
  initial: PartyForm;
  hasLegacyBankText: boolean;
  save(payload: Record<string, string | number>): Promise<string>;
  confirm(message: string): boolean;
  notify(message: string, error?: boolean): void;
  onBankAccounts(code: string, name: string): void;
  onDone(): void;
}

type Field = keyof PartyForm;

function Labeled({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={'phase4-master-field' + (wide ? ' span-2' : '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="phase4-master-section">
      <header>
        <div>
          <h4>{title}</h4>
          <p>{subtitle}</p>
        </div>
      </header>
      <div className="phase4-master-grid">{children}</div>
    </section>
  );
}

export function PartyFormView({
  kind,
  code,
  initial,
  hasLegacyBankText,
  save,
  confirm,
  notify,
  onBankAccounts,
  onDone,
}: PartyFormViewProps) {
  const [form, setForm] = useState<PartyForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const editing = Boolean(code);

  useEffect(() => {
    refs.current.nome?.focus({ preventScroll: true });
  }, []);

  const set = (field: Field, format?: (value: string) => string) => (value: string) =>
    setForm((previous) => ({ ...previous, [field]: format ? format(value) : value }));
  const input = (
    field: Field,
    attrs: {
      placeholder?: string;
      type?: string;
      maxLength?: number;
      format?: (value: string) => string;
      disabled?: boolean;
    } = {},
  ) => (
    <input
      ref={(element) => {
        refs.current[field] = element;
      }}
      id={(editing ? kind.ids.edit : kind.ids.create) + '-' + field}
      type={attrs.type ?? 'text'}
      placeholder={attrs.placeholder}
      maxLength={attrs.maxLength}
      disabled={busy || attrs.disabled}
      value={form[field]}
      onChange={(event) => set(field, attrs.format)(event.target.value)}
    />
  );

  const submit = async () => {
    if (busy) return;
    setError('');
    const check = checkPartyForm(form, kind.noun);
    if (check.ok === false) {
      setError(check.message);
      refs.current[check.field]?.focus();
      return;
    }
    if (check.ok === 'confirm' && !confirm(check.message)) return;
    setBusy(true);
    try {
      const saved = await save(partyPayload(form, kind.withLimit));
      notify(editing ? `${label} atualizado.` : `${label} ${saved} cadastrado.`);
      onDone();
    } catch (failure) {
      setError(messageOf(failure, `Não foi possível salvar o ${kind.noun}.`));
      setBusy(false);
    }
  };

  const pf = form.personType === 'PF';
  const label = kind.title.charAt(0).toUpperCase() + kind.title.slice(1);
  const prefix = editing ? kind.ids.edit : kind.ids.create;
  return (
    <div
      className={kind.className + '-form'}
      onKeyDown={(event) => event.key === 'Escape' && !busy && onDone()}
    >
      <div className="phase4-master-head">
        <div>
          <h2>{(editing ? 'Editar ' : 'Novo ') + kind.title}</h2>
          <p>{kind.subtitle}</p>
        </div>
        <div className="phase4-master-actions">
          <button type="button" className="phase4-master-outline" disabled={busy} onClick={onDone}>
            Cancelar
          </button>
          <button type="button" className="phase4-master-save" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
      {error ? (
        <p className={kind.className + '-form-error'} role="alert">
          {error}
        </p>
      ) : null}
      <Section title="Dados cadastrais" subtitle={`Identificação principal do ${kind.noun}.`}>
        <Labeled label="Nome / Razão Social *" wide>
          {input('nome', { maxLength: 160, format: (value) => value.toUpperCase() })}
        </Labeled>
        <Labeled label="Nome fantasia">{input('fantasia', { maxLength: 160 })}</Labeled>
        <Labeled label="Código">
          <input id="phase4-master-code" value={code || 'Automático'} readOnly />
        </Labeled>
        <Labeled label="Tipo de pessoa">
          <select
            id={prefix + '-pessoa'}
            disabled={busy}
            value={form.personType}
            onChange={(event) => set('personType')(event.target.value)}
          >
            <option value="PJ">Pessoa Jurídica</option>
            <option value="PF">Pessoa Física</option>
          </select>
        </Labeled>
        <Labeled label={label + ' desde'}>{input('desde', { type: 'date' })}</Labeled>
        <Labeled label="CPF">
          {input('cpf', { placeholder: '000.000.000-00', format: formatCpf, disabled: !pf })}
        </Labeled>
        <Labeled label="CNPJ">
          {input('cnpj', { placeholder: '00.000.000/0001-00', format: formatCnpj, disabled: pf })}
        </Labeled>
        <Labeled label="Inscrição Estadual">{input('ie', { maxLength: 30 })}</Labeled>
        <Labeled label="RG">{input('rg', { maxLength: 30 })}</Labeled>
        <Labeled label="Órgão emissor">{input('orgaoEmissor', { maxLength: 30 })}</Labeled>
        <Labeled label="Contribuinte">
          <select
            disabled={busy}
            value={form.contribuinte}
            onChange={(event) => set('contribuinte')(event.target.value)}
          >
            {CONTRIBUINTE_OPTIONS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </Labeled>
      </Section>
      <Section title="Contato" subtitle="Canais usados pela operação e pelo financeiro.">
        <Labeled label="Telefone">{input('tel', { format: formatPhone })}</Labeled>
        <Labeled label="WhatsApp">{input('wpp', { format: formatPhone })}</Labeled>
        <Labeled label="E-mail" wide>
          {input('email', { type: 'email', maxLength: 120 })}
        </Labeled>
      </Section>
      <Section title="Endereço" subtitle={`Endereço principal do ${kind.noun}.`}>
        <Labeled label="CEP">{input('cep', { format: formatCep })}</Labeled>
        <Labeled label="UF">{input('uf', { maxLength: 2, format: (value) => value.toUpperCase() })}</Labeled>
        <Labeled label="Cidade" wide>
          {input('cidadeNome', { maxLength: 80 })}
        </Labeled>
        <Labeled label="Rua / Logradouro" wide>
          {input('rua', { maxLength: 160 })}
        </Labeled>
        <Labeled label="Número">{input('num', { maxLength: 20 })}</Labeled>
        <Labeled label="Complemento">{input('compl', { maxLength: 80 })}</Labeled>
        <Labeled label="Bairro" wide>
          {input('bairro', { maxLength: 80 })}
        </Labeled>
      </Section>
      {kind.withLimit ? (
        <Section title="Financeiro" subtitle="Limite usado nas vendas a prazo.">
          <Labeled label="Limite de crédito R$">{input('limite', { placeholder: '0,00' })}</Labeled>
        </Section>
      ) : null}
      <Section title="Dados bancários" subtitle="Conta principal e chave PIX usadas nos pagamentos.">
        <Labeled label="Chave PIX" wide>
          {input('pix', { maxLength: 160 })}
        </Labeled>
        <Labeled label="Banco principal" wide>
          {input('banco', { maxLength: 80 })}
        </Labeled>
        <Labeled label="Agência">{input('agencia', { maxLength: 20 })}</Labeled>
        <Labeled label="Conta">{input('conta', { maxLength: 30 })}</Labeled>
        <div className="phase4-master-bank-action span-2">
          {editing ? (
            <button
              type="button"
              className="phase4-master-secondary"
              disabled={busy}
              onClick={() => onBankAccounts(code, form.nome)}
            >
              🏦 Gerenciar contas bancárias
            </button>
          ) : (
            <span className="phase4-master-bank-hint">
              Salve o cadastro para liberar múltiplas contas bancárias.
            </span>
          )}
        </div>
      </Section>
      <Section title="Observações" subtitle="Informações adicionais.">
        {hasLegacyBankText ? (
          <Labeled label="Dados bancários antigos" wide>
            <textarea
              rows={2}
              disabled={busy}
              value={form.obs}
              onChange={(event) => set('obs')(event.target.value)}
            />
          </Labeled>
        ) : null}
        <Labeled label="Observações" wide>
          <textarea
            id={prefix + '-nota'}
            rows={3}
            placeholder="Informações adicionais..."
            disabled={busy}
            value={form.nota}
            onChange={(event) => set('nota')(event.target.value)}
          />
        </Labeled>
      </Section>
    </div>
  );
}
