import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { messageOf } from '../../../shared/domain/errors.js';
import {
  CHEQUE_STATUSES,
  MONTHS,
  availableYears,
  chequeNumber,
  chequesCsv,
  chequesPrintHtml,
  chequesSummary,
  filterCheques,
  formatAmount,
  usableCheques,
} from '../domain/cheque-report.js';
import type { ChequeCriteria, ChequeRow } from '../domain/cheque-report.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; rows: ChequeRow[] }
  | { status: 'failed'; message: string };

interface ChequeReportProps {
  load(): Promise<unknown>;
  onClose(): void;
}

const PAGE_SIZE = 25;
const NO_ROWS: ChequeRow[] = [];

function withCriterion(criteria: ChequeCriteria, key: keyof ChequeCriteria, value: string): ChequeCriteria {
  const next = { ...criteria };
  next[key] = value;
  return next;
}

function loadedMessage(rows: readonly ChequeRow[]): string {
  const missing = rows.filter((row) => !String(row.numero || '').trim()).length;
  return (
    `${rows.length} cheque(s) de adiantamentos carregado(s).` +
    (missing ? ` ${missing} sem número de cheque cadastrado (aparecem como "não informado").` : '')
  );
}

function downloadCsv(content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cheques-adiantamentos.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ChequeReport({ load, onClose }: ChequeReportProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloads, setReloads] = useState(0);
  const [criteria, setCriteria] = useState<ChequeCriteria>({});
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    load().then(
      (data) => {
        if (active)
          setState({ status: 'ready', rows: usableCheques((data as { cheques?: unknown } | null)?.cheques) });
      },
      (error: unknown) => {
        if (active) setState({ status: 'failed', message: messageOf(error, 'erro desconhecido') });
      },
    );
    return () => {
      active = false;
    };
  }, [load, reloads]);

  const rows = state.status === 'ready' ? state.rows : NO_ROWS;
  const visible = useMemo(() => filterCheques(rows, criteria), [rows, criteria]);
  const years = useMemo(() => availableYears(rows), [rows]);
  const summary = chequesSummary(visible);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const pageRows = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const message =
    state.status === 'loading'
      ? 'Consultando cheques lançados no servidor…'
      : state.status === 'failed'
        ? `Falha ao consultar o relatório: ${state.message}`
        : notice || loadedMessage(rows);

  const change =
    (key: keyof ChequeCriteria) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target.value;
      setCriteria((previous) => withCriterion(previous, key, value));
      setPage(1);
    };
  const refresh = () => {
    setNotice('');
    setState({ status: 'loading' });
    setReloads((count) => count + 1);
  };
  const exportCsv = () => {
    if (visible.length) downloadCsv(chequesCsv(visible));
  };
  const print = () => {
    if (!visible.length) return;
    const popup = window.open('', '_blank', 'width=1100,height=780');
    if (!popup) {
      setNotice('O navegador bloqueou a impressão. Permita janelas para este site e tente novamente.');
      return;
    }
    popup.document.open();
    popup.document.write(chequesPrintHtml(visible));
    popup.document.close();
  };

  return (
    <>
      <div className="adt-report-header">
        <div>
          <h3>Relatório de cheques lançados</h3>
          <p>
            Cheques registrados em Adiantamentos. Somente cheques de adiantamentos; os filtros não alteram
            lançamentos.
          </p>
        </div>
        <div className="adt-report-actions">
          <button type="button" onClick={refresh}>
            Atualizar
          </button>
          <button type="button" onClick={exportCsv}>
            Exportar CSV
          </button>
          <button type="button" onClick={print}>
            Imprimir tabela
          </button>
          <button type="button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
      <div className="adt-report-filters">
        <label>
          Cliente / destinatário
          <input
            id="adt-report-cliente"
            type="search"
            placeholder="Ex.: CICLO"
            value={criteria.customer ?? ''}
            onChange={change('customer')}
          />
        </label>
        <label>
          Empresa / emitente
          <input
            id="adt-report-empresa"
            type="search"
            placeholder="Pesquisar empresa"
            value={criteria.company ?? ''}
            onChange={change('company')}
          />
        </label>
        <label>
          Ano
          <select id="adt-report-year" value={criteria.year ?? ''} onChange={change('year')}>
            <option value="">Todos</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mês
          <select id="adt-report-month" value={criteria.month ?? ''} onChange={change('month')}>
            <option value="">Todos</option>
            {MONTHS.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </label>
        <label>
          De
          <input type="date" id="adt-report-from" value={criteria.from ?? ''} onChange={change('from')} />
        </label>
        <label>
          Até
          <input type="date" id="adt-report-to" value={criteria.to ?? ''} onChange={change('to')} />
        </label>
        <label>
          Situação
          <select id="adt-report-status" value={criteria.status ?? ''} onChange={change('status')}>
            <option value="">Todas</option>
            {CHEQUE_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
      </div>
      <div id="adt-report-message" role="status" aria-live="polite">
        {message}
      </div>
      <div className="adt-report-summary">
        <strong>
          <span id="adt-report-count">{summary.count}</span> cheque(s)
        </strong>
        <strong>
          Total: <span id="adt-report-total">R$ {formatAmount(summary.total)}</span>
        </strong>
      </div>
      <div className="adt-report-table-wrap">
        <table className="adt-report-table">
          <thead>
            <tr>
              <th>CHEQUE</th>
              <th>EMPRESA</th>
              <th>CLIENTE</th>
              <th>NÚMERO</th>
              <th>DATA</th>
              <th>VALOR</th>
            </tr>
          </thead>
          <tbody id="adt-report-body">
            {pageRows.length ? (
              pageRows.map((row, index) => (
                <tr key={`${row.id ?? ''}|${row.numero}|${index}`}>
                  <td>CHEQUE</td>
                  <td>{row.empresa || '—'}</td>
                  <td>{row.cliente}</td>
                  <td>{chequeNumber(row)}</td>
                  <td>{row.data}</td>
                  <td className="adt-report-amount">R$ {formatAmount(row.valor)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="adt-report-empty">
                  Nenhum cheque corresponde aos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="adt-report-pagination" id="adt-report-pagination" hidden={!visible.length}>
        <button
          id="adt-report-prev"
          type="button"
          disabled={current <= 1}
          onClick={() => setPage(current - 1)}
        >
          Anterior
        </button>
        <span id="adt-report-page-text">
          Página {current} de {pages} · {visible.length} cheques
        </span>
        <button
          id="adt-report-next"
          type="button"
          disabled={current >= pages}
          onClick={() => setPage(current + 1)}
        >
          Próxima
        </button>
      </div>
    </>
  );
}
