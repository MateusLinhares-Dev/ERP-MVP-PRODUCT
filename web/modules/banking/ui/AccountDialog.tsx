import { useState } from 'react';
import type { ReactNode } from 'react';
import { messageOf } from '../../../shared/domain/errors.js';
import { Dialog } from '../../../shared/ui/Dialog.js';
import { ACCOUNT_TYPES, accountForm, accountRequest } from '../domain/accounts.js';
import type { AccountForm } from '../domain/accounts.js';
import type { Raw } from '../domain/ledger.js';
import type { BankingPort } from './ports.js';

function Field({ label, children, wide }: { label: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={'erp-bk-field' + (wide ? ' wide' : '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function AccountDialog({
  account,
  port,
  onClose,
}: {
  account: Raw | null;
  port: BankingPort;
  onClose(): void;
}) {
  const [form, setForm] = useState<AccountForm>(() =>
    accountForm(account, { company: port.mainCompany, holder: port.mainHolder, address: port.addressOf }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<AccountForm>) => setForm((current) => ({ ...current, ...patch }));
  const companies = [...new Set([...port.companies, form.empresa].filter(Boolean))];
  const title = account ? 'Editar conta – ' + String(account.banco ?? '') : 'Nova conta bancária';

  async function save() {
    const request = accountRequest(form, account, port.mainHolder);
    if (!request.ok) {
      setError(request.message);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const reply = await port.request(request.payload);
      const saved = (reply.account ?? {}) as Raw;
      const code = String(saved.cod ?? '');
      const money = (value: unknown) =>
        (Number(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
      if (!account)
        port.history('Banco', 'Criado', request.summary.banco + ' — saldo inicial R$ ' + money(saved.saldo), {
          bancoCod: code,
        });
      else {
        const change = reply.codeChange as { from?: string; to?: string; movedEntries?: number } | undefined;
        if (change?.from && change.to)
          port.history(
            'Banco',
            'Código alterado',
            `${request.summary.banco} — código "${change.from}" trocado para "${change.to}" (${change.movedEntries ?? 0} lançamento(s) junto; corrige duplicidade)`,
            { bancoCodAntigo: change.from, bancoCodNovo: change.to },
          );
        if (Number(account.saldo || 0).toFixed(2) !== Number(saved.saldo || 0).toFixed(2))
          port.history(
            'Banco',
            'Saldo Inicial alterado',
            `${request.summary.banco} — de R$ ${money(account.saldo)} para R$ ${money(saved.saldo)}`,
            { bancoCod: code },
          );
      }
      port.notify(account ? 'Conta atualizada.' : 'Conta bancária ' + code + ' cadastrada.', 'success');
      onClose();
    } catch (failure) {
      setError(messageOf(failure, 'Não foi possível salvar a conta.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose} className="erp-bk-account-dialog">
      <div className="erp-bk-grid">
        {account ? (
          <Field
            wide
            label={
              <>
                Código <small>(só mude se este código estiver repetido em outra conta)</small>
              </>
            }
          >
            <input value={form.cod} onChange={(event) => set({ cod: event.target.value })} />
          </Field>
        ) : null}
        <Field label="Empresa dona da conta" wide>
          <select
            value={form.empresa}
            onChange={(event) => {
              const empresa = event.target.value;
              set({ empresa, endereco: form.endereco.trim() ? form.endereco : port.addressOf(empresa) });
            }}
          >
            {companies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
            <option value="Outra">Outra</option>
          </select>
        </Field>
        <Field label="Banco">
          <input
            value={form.banco}
            placeholder="Nome do banco"
            onChange={(event) => set({ banco: event.target.value })}
          />
        </Field>
        <Field label="Tipo">
          <select value={form.tipo} onChange={(event) => set({ tipo: event.target.value })}>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </Field>
        <Field label="Titular / Dono">
          <input
            value={form.titular}
            placeholder="Razão social ou nome do terceiro"
            onChange={(event) => set({ titular: event.target.value })}
          />
        </Field>
        {form.tipo === 'Conta Terceiro' ? (
          <Field label="CPF/CNPJ do terceiro">
            <input
              value={form.cpfcnpj}
              placeholder="000.000.000-00"
              onChange={(event) => set({ cpfcnpj: event.target.value })}
            />
          </Field>
        ) : null}
        <Field label="Agência">
          <input
            value={form.agencia}
            placeholder="0101"
            onChange={(event) => set({ agencia: event.target.value })}
          />
        </Field>
        <Field label="Conta">
          <input
            value={form.conta}
            placeholder="12345-6"
            onChange={(event) => set({ conta: event.target.value })}
          />
        </Field>
        <Field label="PIX">
          <input
            value={form.pix}
            placeholder="CNPJ, CPF ou telefone"
            onChange={(event) => set({ pix: event.target.value })}
          />
        </Field>
        <Field label="Endereço" wide>
          <input
            value={form.endereco}
            placeholder="Rua, número, bairro, cidade/UF, CEP"
            onChange={(event) => set({ endereco: event.target.value })}
          />
        </Field>
        <Field label="Saldo inicial R$">
          <input
            value={form.saldo}
            inputMode="decimal"
            placeholder="Ex: 1.524.205,97"
            onChange={(event) => set({ saldo: event.target.value })}
          />
        </Field>
        <Field label="Saldo lançado em (pode ser data passada)">
          <input type="date" value={form.data} onChange={(event) => set({ data: event.target.value })} />
        </Field>
        <Field label="Obs." wide>
          <input
            value={form.obs}
            placeholder="Observação opcional"
            onChange={(event) => set({ obs: event.target.value })}
          />
        </Field>
      </div>
      {error ? (
        <p className="erp-bk-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer>
        <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn-save" onClick={() => void save()} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </footer>
    </Dialog>
  );
}
