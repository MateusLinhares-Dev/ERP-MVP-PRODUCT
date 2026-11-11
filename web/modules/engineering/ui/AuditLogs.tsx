import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { messageOf } from '../../../shared/domain/errors.js';
import {
  LOG_LEVELS,
  auditEvents,
  eventIdentification,
  logsCsv,
  logsHint,
  logsQuery,
} from '../domain/audit-logs.js';
import type { AuditEvent, LogFilters } from '../domain/audit-logs.js';

type LogState =
  | { status: 'loading' }
  | { status: 'ready'; events: AuditEvent[]; nextCursor: string | null; scanned: number }
  | { status: 'failed'; message: string };

interface AuditLogsProps {
  load(query: string): Promise<unknown>;
}

function downloadCsv(content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'auditoria-erp.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filtersOf(form: HTMLFormElement): LogFilters {
  const data = new FormData(form);
  const value = (name: string) => String(data.get(name) ?? '');
  return {
    module: value('module'),
    level: value('level'),
    actor: value('actor'),
    term: value('term'),
    from: value('from'),
    to: value('to'),
  };
}

export function AuditLogs({ load }: AuditLogsProps) {
  const [filters, setFilters] = useState<LogFilters>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const [reloads, setReloads] = useState(0);
  const [state, setState] = useState<LogState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    load(logsQuery(filters, cursor)).then(
      (data) => {
        if (active) setState({ status: 'ready', ...auditEvents(data) });
      },
      (error: unknown) => {
        if (active)
          setState({ status: 'failed', message: messageOf(error, 'Erro de comunicação com o servidor.') });
      },
    );
    return () => {
      active = false;
    };
  }, [load, filters, cursor, reloads]);

  const restart = (next: LogFilters) => {
    setState({ status: 'loading' });
    setPrevious([]);
    setCursor(null);
    setFilters(next);
    setReloads((count) => count + 1);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    restart(filtersOf(event.currentTarget));
  };
  const events = state.status === 'ready' ? state.events : [];

  return (
    <>
      <header className="mm-eng-hero">
        <div>
          <small>ENGENHARIA · OBSERVABILIDADE</small>
          <h1>Auditoria e logs</h1>
          <p>
            Eventos de negócio, autenticação e falhas recebidas pelo ERP. Sem expor tokens, senhas ou conteúdo
            dos documentos.
          </p>
        </div>
        <button type="button" id="eng-logs-refresh" onClick={() => restart(filters)}>
          Atualizar
        </button>
      </header>
      <section className="mm-eng-card">
        <form id="eng-filters" className="mm-eng-filters" onSubmit={submit} onReset={() => restart({})}>
          <label>
            Módulo
            <input name="module" placeholder="Ex.: fiscal, contratos" />
          </label>
          <label>
            Nível
            <select name="level">
              <option value="">Todos</option>
              {LOG_LEVELS.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </label>
          <label>
            Usuário
            <input name="actor" placeholder="Login" />
          </label>
          <label>
            Buscar evento
            <input name="term" placeholder="Ação, código, entidade" />
          </label>
          <label>
            De
            <input type="datetime-local" name="from" />
          </label>
          <label>
            Até
            <input type="datetime-local" name="to" />
          </label>
          <button className="mm-eng-primary" type="submit">
            Filtrar
          </button>
          <button type="reset" id="eng-clear">
            Limpar
          </button>
        </form>
      </section>
      <section className="mm-eng-card">
        <div className="mm-eng-row">
          <div>
            <h2>Histórico de eventos</h2>
            <p id="eng-logs-hint">
              {state.status === 'ready'
                ? logsHint(events.length, state.scanned, Boolean(state.nextCursor))
                : 'Consultando...'}
            </p>
          </div>
          <button
            type="button"
            id="eng-csv"
            disabled={!events.length}
            onClick={() => downloadCsv(logsCsv(events))}
          >
            Exportar página (CSV)
          </button>
        </div>
        <div className="mm-eng-overflow">
          <table className="mm-eng-table">
            <thead>
              <tr>
                <th>Data / hora</th>
                <th>Nível</th>
                <th>Módulo</th>
                <th>Evento</th>
                <th>Usuário</th>
                <th>Origem</th>
                <th>Identificação</th>
              </tr>
            </thead>
            <tbody id="eng-logs-body">
              {state.status === 'loading' ? (
                <tr>
                  <td colSpan={7}>Consultando registros...</td>
                </tr>
              ) : null}
              {state.status === 'failed' ? (
                <tr>
                  <td colSpan={7}>{state.message}</td>
                </tr>
              ) : null}
              {state.status === 'ready' && !events.length ? (
                <tr>
                  <td colSpan={7}>Sem eventos nesta página para os filtros escolhidos.</td>
                </tr>
              ) : null}
              {events.map((event, index) => (
                <tr key={`${event.ts}-${index}`}>
                  <td>{new Date(event.ts).toLocaleString('pt-BR')}</td>
                  <td>
                    <span className={`mm-eng-level ${event.level}`}>{event.level}</span>
                  </td>
                  <td>{event.module}</td>
                  <td>{event.action}</td>
                  <td>{event.actorLogin}</td>
                  <td>{event.source}</td>
                  <td>{eventIdentification(event)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div id="eng-logs-pager" className="mm-eng-row">
          <span>Histórico paginado · filtros aplicados à janela consultada</span>
          <div>
            <button
              type="button"
              id="eng-prev"
              disabled={!previous.length}
              onClick={() => {
                setState({ status: 'loading' });
                setCursor(previous.at(-1) ?? null);
                setPrevious(previous.slice(0, -1));
              }}
            >
              Anterior
            </button>
            <button
              type="button"
              id="eng-next"
              disabled={state.status !== 'ready' || !state.nextCursor}
              onClick={() => {
                if (state.status !== 'ready' || !state.nextCursor) return;
                setPrevious([...previous, cursor]);
                setState({ status: 'loading' });
                setCursor(state.nextCursor);
              }}
            >
              Próxima
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
