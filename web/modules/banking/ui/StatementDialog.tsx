import { useState } from 'react';
import { messageOf } from '../../../shared/domain/errors.js';
import { Dialog } from '../../../shared/ui/Dialog.js';
import { Pager, pageOf } from '../../../shared/ui/Pager.js';
import { brl } from '../domain/ledger.js';
import type { Raw } from '../domain/ledger.js';
import {
  brDate,
  emptyEntryForm,
  emptyStatementFilter,
  entryFormOf,
  entryRequest,
  expectedOf,
  statementView,
} from '../domain/statement-view.js';
import type { EntryForm, MovementLinks, StatementFilter } from '../domain/statement-view.js';
import type { BankingPort } from './ports.js';

const money = (value: unknown) => 'R$ ' + brl(value);

function EntryFields({ form, onChange }: { form: EntryForm; onChange(patch: Partial<EntryForm>): void }) {
  return (
    <>
      <label>
        Data
        <input type="date" value={form.data} onChange={(event) => onChange({ data: event.target.value })} />
      </label>
      <label className="erp-statement-wide">
        Descrição
        <input
          type="text"
          maxLength={240}
          value={form.descricao}
          placeholder="Descrição da movimentação"
          onChange={(event) => onChange({ descricao: event.target.value })}
        />
      </label>
      <label>
        Tipo
        <select
          value={form.tipo}
          onChange={(event) => onChange({ tipo: event.target.value === 'Saída' ? 'Saída' : 'Entrada' })}
        >
          <option value="Entrada">Entrada</option>
          <option value="Saída">Saída</option>
        </select>
      </label>
      <label>
        Valor (R$)
        <input
          inputMode="decimal"
          value={form.valor}
          placeholder="0,00"
          onChange={(event) => onChange({ valor: event.target.value })}
        />
      </label>
    </>
  );
}

function EditEntryDialog({ entry, port, onClose }: { entry: Raw; port: BankingPort; onClose(): void }) {
  const [form, setForm] = useState<EntryForm>(() => entryFormOf(entry));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    const request = entryRequest(form);
    if (!request.ok) return setError(request.message);
    setBusy(true);
    setError('');
    try {
      await port.request({
        action: 'update-entry',
        id: String(entry.id ?? ''),
        expected: expectedOf(entry),
        entry: request.entry,
      });
      port.notify('Lançamento atualizado.', 'success');
      onClose();
    } catch (failure) {
      setError(messageOf(failure, 'Não foi possível salvar o lançamento.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Editar lançamento bancário" onClose={onClose}>
      <div className="erp-statement-entry-fields erp-bk-edit-entry">
        <EntryFields form={form} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} />
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

export function StatementDialog({
  account,
  entries,
  links,
  port,
  onClose,
}: {
  account: Raw;
  entries: unknown[];
  links: MovementLinks;
  port: BankingPort;
  onClose(): void;
}) {
  const [filter, setFilter] = useState<StatementFilter>(emptyStatementFilter);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [form, setForm] = useState<EntryForm>(() => emptyEntryForm(port.today()));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Raw | null>(null);
  const [busyId, setBusyId] = useState('');
  const code = String(account.cod ?? '');
  const view = statementView(account, entries, filter, links);
  const shown = pageOf(view.lines, page, size);
  const change = (patch: Partial<StatementFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  async function add() {
    const request = entryRequest(form);
    if (!request.ok) return port.notify(request.message, 'error');
    setAdding(true);
    try {
      await port.request({ action: 'add-entry', bankCode: code, entry: request.entry });
      setForm(emptyEntryForm(port.today()));
      port.notify('Lançamento registrado.', 'success');
    } catch (failure) {
      port.notify(messageOf(failure, 'Não foi possível registrar o lançamento.'), 'error');
    } finally {
      setAdding(false);
    }
  }

  async function remove(entry: Raw) {
    if (!port.confirm('Excluir este lançamento?')) return;
    const id = String(entry.id ?? '');
    setBusyId(id);
    try {
      await port.request({ action: 'delete-entry', id, expected: expectedOf(entry) });
      port.notify('Lançamento excluído.', 'success');
    } catch (failure) {
      port.notify(messageOf(failure, 'Não foi possível excluir o lançamento.'), 'error');
    } finally {
      setBusyId('');
    }
  }

  return (
    <Dialog title="Extrato bancário" onClose={onClose} className="erp-bank-statement">
      <p className="erp-bk-statement-bank">{String(account.banco ?? 'Conta bancária')}</p>
      <div className="erp-statement-totals">
        <div>
          <small>Saldo inicial</small>
          <strong>{money(view.totals.openingBalance)}</strong>
        </div>
        <div>
          <small>Entradas</small>
          <strong>{money(view.totals.credits)}</strong>
        </div>
        <div>
          <small>Saídas</small>
          <strong>{money(view.totals.debits)}</strong>
        </div>
        <div>
          <small>Saldo atual</small>
          <strong>{money(view.totals.closingBalance)}</strong>
        </div>
      </div>
      {view.totals.hasUnsafeLegacyValues ? (
        <p className="erp-ledger-precision-warning" role="status">
          Existem valores antigos acima do limite de precisão. Revise os lançamentos destacados.
        </p>
      ) : null}
      {view.totals.invalidValues ? (
        <p className="erp-ledger-precision-warning" role="status">
          Existem {view.totals.invalidValues} valores bancários inválidos. Foram desconsiderados no cálculo;
          revise os registros.
        </p>
      ) : null}
      {port.canOperate ? (
        <details className="erp-statement-entry">
          <summary>Novo lançamento</summary>
          <div className="erp-statement-entry-fields">
            <EntryFields form={form} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} />
            <button type="button" className="btn-save" disabled={adding} onClick={() => void add()}>
              {adding ? 'Registrando…' : 'Registrar'}
            </button>
          </div>
        </details>
      ) : null}
      <div className="erp-statement-filters">
        <input
          type="search"
          aria-label="Buscar movimentações"
          placeholder="Buscar descrição, data ou valor"
          value={filter.query}
          onChange={(event) => change({ query: event.target.value })}
        />
        <select
          aria-label="Tipo de movimentação"
          value={filter.kind}
          onChange={(event) => change({ kind: event.target.value as StatementFilter['kind'] })}
        >
          <option value="">Todas</option>
          <option value="entrada">Entradas</option>
          <option value="saida">Saídas</option>
        </select>
        <label>
          De
          <input type="date" value={filter.from} onChange={(event) => change({ from: event.target.value })} />
        </label>
        <label>
          Até
          <input type="date" value={filter.to} onChange={(event) => change({ to: event.target.value })} />
        </label>
        <span aria-live="polite">
          {view.lines.length} de {view.all} lançamentos
        </span>
      </div>
      <div className="erp-statement-table-wrap">
        <table className="erp-statement-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Descrição</th>
              <th>Tipo</th>
              <th>Valor</th>
              <th>Saldo acumulado</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {shown.rows.length ? (
              shown.rows.map((line) => (
                <tr key={line.id + ':' + line.index} data-type={line.incoming ? 'entrada' : 'saida'}>
                  <td>{brDate(line.date, line.entry.data)}</td>
                  <td className="erp-ledger-description">{String(line.entry.descricao ?? '') || '—'}</td>
                  <td>
                    <span className={'erp-entry-kind ' + (line.incoming ? 'is-income' : 'is-expense')}>
                      {line.incoming ? 'Entrada' : 'Saída'}
                    </span>
                  </td>
                  <td className={'erp-money ' + (line.incoming ? 'is-income' : 'is-expense')}>
                    {(line.incoming ? '+ ' : '- ') + money(line.amount)}
                  </td>
                  <td className="erp-money">{money(line.balance)}</td>
                  <td className="erp-row-actions">
                    {line.automatic ? (
                      <small title="Lançado por pagamento, venda, recebimento, adiantamento ou cheque. Altere pela tela de origem.">
                        Automático
                      </small>
                    ) : port.canOperate ? (
                      <>
                        <button
                          type="button"
                          className="btn-edit"
                          aria-label="Editar lançamento"
                          onClick={() => setEditing(line.entry)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn-edit-danger"
                          aria-label="Excluir lançamento"
                          disabled={busyId === line.id}
                          onClick={() => void remove(line.entry)}
                        >
                          Excluir
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="erp-statement-empty">
                  {view.all
                    ? 'Nenhum lançamento para os filtros escolhidos.'
                    : 'Nenhum lançamento para esta conta.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager
        total={view.lines.length}
        page={shown.page}
        pages={shown.pages}
        size={size}
        onPage={setPage}
        onSize={(next) => {
          setSize(next);
          setPage(1);
        }}
      />
      <footer>
        <button type="button" className="btn-cancel" onClick={onClose}>
          Fechar
        </button>
      </footer>
      {editing ? <EditEntryDialog entry={editing} port={port} onClose={() => setEditing(null)} /> : null}
    </Dialog>
  );
}
