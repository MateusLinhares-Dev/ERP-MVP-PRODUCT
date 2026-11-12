import { useMemo, useState } from 'react';
import { bankSummary, documentOf } from '../../../shared/domain/party.js';
import { Pager, pageOf } from '../../../shared/ui/Pager.js';
import { searchCustomers } from '../domain/customers.js';
import type { CustomerRow } from '../domain/customers.js';

export interface CustomerListProps {
  rows: CustomerRow[];
  canOperate: boolean;
  onNew(): void;
  onEdit(key: string): void;
  onLedger(name: string): void;
  onLedgerSearch(): void;
  onDocs(key: string): void;
  onBanks(row: CustomerRow): void;
  onDelete(keys: string[]): Promise<boolean>;
}

export function CustomerList({
  rows,
  canOperate,
  onNew,
  onEdit,
  onLedger,
  onLedgerSearch,
  onDocs,
  onBanks,
  onDelete,
}: CustomerListProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => searchCustomers(rows, query), [rows, query]);
  const current = pageOf(filtered, page, size);
  const visible = current.rows.map((row) => row.key);
  const allVisible = visible.length > 0 && visible.every((key) => selected.has(key));
  const chosen = [...selected].filter((key) => rows.some((row) => row.key === key));

  const toggle = (key: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const remove = async (keys: string[]) => {
    if (busy || !keys.length) return;
    setBusy(true);
    try {
      if (await onDelete(keys)) setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tcard erp-customer-list">
      <div className="tcard-hdr">
        <div className="erp-customer-title">
          <div className="tcard-title">Cadastro de Clientes</div>
          <button type="button" className="erp-customer-ledger" onClick={onLedgerSearch}>
            📋 Ficha Financeira
          </button>
        </div>
        <div className="erp-customer-actions">
          {canOperate ? (
            <button type="button" className="btn-add" onClick={onNew}>
              + Novo Cliente
            </button>
          ) : null}
          {canOperate && chosen.length ? (
            <button
              type="button"
              className="erp-customer-delete-selected"
              disabled={busy}
              onClick={() => void remove(chosen)}
            >
              🗑️ Excluir selecionados ({chosen.length})
            </button>
          ) : null}
        </div>
      </div>
      <div className="erp-customer-search">
        <input
          id="cli-busca-nome"
          type="search"
          placeholder="🔍 Buscar por nome, código, cidade, telefone, e-mail ou CPF/CNPJ..."
          aria-label="Buscar cliente"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        <span>
          {filtered.length} de {rows.length} clientes
        </span>
      </div>
      <div className="erp-customer-table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                {canOperate ? (
                  <input
                    id="chk-all-cli"
                    type="checkbox"
                    aria-label="Selecionar todos desta página"
                    checked={allVisible}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        for (const key of visible) {
                          if (allVisible) next.delete(key);
                          else next.add(key);
                        }
                        return next;
                      })
                    }
                  />
                ) : null}
              </th>
              <th>Cód.</th>
              <th>Nome / Razão Social</th>
              <th>CPF / CNPJ</th>
              <th>Telefone</th>
              <th>E-mail</th>
              <th>Cidade/UF</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="tb-clientes-list">
            {current.rows.length ? (
              current.rows.map((row) => (
                <tr key={row.key} className={selected.has(row.key) ? 'selected' : ''}>
                  <td style={{ textAlign: 'center' }}>
                    {canOperate ? (
                      <input
                        type="checkbox"
                        className="cli-chk"
                        value={row.key}
                        aria-label={'Selecionar ' + row.nome}
                        checked={selected.has(row.key)}
                        onChange={() => toggle(row.key)}
                      />
                    ) : null}
                  </td>
                  <td>{row.cod || '—'}</td>
                  <td>
                    <b>{row.nome}</b>
                    {row.fantasia && row.fantasia !== row.nome ? <small>{row.fantasia}</small> : null}
                    {bankSummary(row) ? <small>{bankSummary(row)}</small> : null}
                  </td>
                  <td>{documentOf(row) || '—'}</td>
                  <td>{row.tel || row.wpp || '—'}</td>
                  <td>{row.email || '—'}</td>
                  <td>{row.cidade || '—'}</td>
                  <td className="erp-customer-row-actions">
                    <button type="button" className="cli-ficha-btn" onClick={() => onLedger(row.nome)}>
                      📋 Ficha
                    </button>
                    {canOperate ? (
                      <button type="button" className="phase3-bank-btn" onClick={() => onBanks(row)}>
                        🏦 Bancos
                      </button>
                    ) : null}
                    {canOperate ? (
                      <button
                        type="button"
                        className="btn-edit"
                        title="Editar"
                        onClick={() => onEdit(row.key)}
                      >
                        ✏️ Editar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-edit erp-customer-docs"
                      title="Documentos"
                      onClick={() => onDocs(row.key)}
                    >
                      📄 Docs
                    </button>
                    {canOperate ? (
                      <button
                        type="button"
                        className="btn-edit-danger"
                        title="Excluir cliente"
                        disabled={busy}
                        onClick={() => void remove([row.key])}
                      >
                        🗑️
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="erp-customer-empty">
                  {rows.length
                    ? 'Nenhum cliente encontrado para a busca.'
                    : 'Nenhum cliente cadastrado ainda.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager
        total={filtered.length}
        page={current.page}
        pages={current.pages}
        size={size}
        onPage={setPage}
        onSize={(next) => {
          setSize(next);
          setPage(1);
        }}
      />
    </div>
  );
}
