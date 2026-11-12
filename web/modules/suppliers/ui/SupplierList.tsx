import { useMemo, useRef, useState } from 'react';
import { Pager, pageOf } from '../../../shared/ui/Pager.js';
import { bankSummary, documentOf, searchSuppliers } from '../domain/suppliers.js';
import type { SupplierRow } from '../domain/suppliers.js';

export interface SupplierListProps {
  rows: SupplierRow[];
  canOperate: boolean;
  accountsOf(cod: string): number;
  onNew(): void;
  onEdit(cod: string): void;
  onLedger(cod: string): void;
  onLedgerSearch(): void;
  onDocs(cod: string): void;
  onPix(cod: string): void;
  onBanks(cod: string, name: string): void;
  onDelete(codes: string[]): Promise<boolean>;
  onImport(file: File): void;
}

export function SupplierList({
  rows,
  canOperate,
  accountsOf,
  onNew,
  onEdit,
  onLedger,
  onLedgerSearch,
  onDocs,
  onPix,
  onBanks,
  onDelete,
  onImport,
}: SupplierListProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => searchSuppliers(rows, query), [rows, query]);
  const current = pageOf(filtered, page, size);
  const visibleCodes = current.rows.map((row) => row.cod);
  const allVisible = visibleCodes.length > 0 && visibleCodes.every((cod) => selected.has(cod));
  const chosen = [...selected].filter((cod) => rows.some((row) => row.cod === cod));

  const toggle = (cod: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(cod)) next.delete(cod);
      else next.add(cod);
      return next;
    });

  const remove = async (codes: string[]) => {
    if (busy || !codes.length) return;
    setBusy(true);
    try {
      if (await onDelete(codes)) setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tcard erp-supplier-list">
      <div className="tcard-hdr">
        <div className="erp-supplier-title">
          <div className="tcard-title">Fornecedores de Compra (Sucata)</div>
          <button type="button" className="erp-supplier-ledger" onClick={onLedgerSearch}>
            📋 Ficha do fornecedor
          </button>
        </div>
        <div className="erp-supplier-actions">
          {canOperate ? (
            <button type="button" className="btn-add" onClick={onNew}>
              + Novo
            </button>
          ) : null}
          {canOperate ? (
            <>
              <input
                ref={file}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(event) => {
                  const chosenFile = event.target.files?.[0];
                  event.target.value = '';
                  if (chosenFile) onImport(chosenFile);
                }}
              />
              <button
                type="button"
                className="erp-supplier-import"
                title="Importar vários fornecedores de uma planilha Excel de uma vez"
                onClick={() => file.current?.click()}
              >
                📥 Importar planilha
              </button>
            </>
          ) : null}
          {canOperate && chosen.length ? (
            <button
              type="button"
              className="erp-supplier-delete-selected"
              disabled={busy}
              onClick={() => void remove(chosen)}
            >
              🗑️ Excluir selecionados ({chosen.length})
            </button>
          ) : null}
        </div>
      </div>
      <div className="erp-supplier-search">
        <input
          id="forn-busca-nome"
          type="search"
          placeholder="🔍 Buscar por nome, código, cidade, telefone ou CPF/CNPJ..."
          aria-label="Buscar fornecedor"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        <span>
          {filtered.length} de {rows.length} fornecedores
        </span>
      </div>
      <div className="erp-supplier-table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                {canOperate ? (
                  <input
                    id="chk-all-forn"
                    type="checkbox"
                    aria-label="Selecionar todos desta página"
                    checked={allVisible}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        for (const cod of visibleCodes) {
                          if (allVisible) next.delete(cod);
                          else next.add(cod);
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
              <th>Cidade/UF</th>
              <th>Banco / PIX</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="tb-fornecedores">
            {current.rows.length ? (
              current.rows.map((row) => {
                const accounts = accountsOf(row.cod);
                const bank = bankSummary(row);
                return (
                  <tr key={row.cod} className={selected.has(row.cod) ? 'selected' : ''}>
                    <td style={{ textAlign: 'center' }}>
                      {canOperate ? (
                        <input
                          type="checkbox"
                          className="forn-chk"
                          value={row.cod}
                          aria-label={'Selecionar ' + row.nome}
                          checked={selected.has(row.cod)}
                          onChange={() => toggle(row.cod)}
                        />
                      ) : null}
                    </td>
                    <td>{row.cod}</td>
                    <td>
                      <b>{row.nome}</b>
                      {row.fantasia && row.fantasia !== row.nome ? <small>{row.fantasia}</small> : null}
                    </td>
                    <td>{documentOf(row) || '—'}</td>
                    <td>{row.tel || row.wpp || '—'}</td>
                    <td>{row.cidade || '—'}</td>
                    <td className="erp-supplier-bank">{bank || '—'}</td>
                    <td className="erp-supplier-row-actions">
                      <button type="button" className="forn-ficha-btn" onClick={() => onLedger(row.cod)}>
                        📋 Ficha
                      </button>
                      {accounts ? (
                        <button type="button" className="erp-supplier-pix" onClick={() => onPix(row.cod)}>
                          💳 PIX{accounts > 1 ? ` (${accounts})` : ''}
                        </button>
                      ) : null}
                      {canOperate ? (
                        <button
                          type="button"
                          className="phase3-bank-btn"
                          onClick={() => onBanks(row.cod, row.nome)}
                        >
                          🏦 Bancos
                        </button>
                      ) : null}
                      {canOperate ? (
                        <button
                          type="button"
                          className="btn-edit"
                          title="Editar"
                          onClick={() => onEdit(row.cod)}
                        >
                          ✏️
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-edit erp-supplier-docs"
                        title="Documentos"
                        onClick={() => onDocs(row.cod)}
                      >
                        📄 Docs
                      </button>
                      {canOperate ? (
                        <button
                          type="button"
                          className="btn-edit-danger"
                          title="Excluir"
                          disabled={busy}
                          onClick={() => void remove([row.cod])}
                        >
                          🗑️
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8} className="erp-supplier-empty">
                  {rows.length
                    ? 'Nenhum fornecedor encontrado para a busca.'
                    : 'Nenhum fornecedor cadastrado.'}
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
