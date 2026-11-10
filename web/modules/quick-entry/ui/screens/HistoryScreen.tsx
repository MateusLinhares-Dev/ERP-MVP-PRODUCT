import { useEffect, useState } from 'react';
import { messageOf } from '../../../../shared/domain/errors.js';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../../../../shared/domain/format.js';
import { classNames } from '../../../../shared/ui/class-names.js';
import { Icon } from '../../../../shared/ui/icons.js';
import type { QuickEntryApi } from '../../application/quick-entry-api.js';
import type { AttachmentRef, HistoryResult, QuickEntry } from '../../domain/contracts.js';
import { statusTone } from '../../domain/entry-draft.js';

type HistoryState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; result: HistoryResult };

interface HistoryScreenProps {
  api: QuickEntryApi;
  onHome(): void;
  onError(message: string): void;
}

const DOWNLOAD_URL_LIFETIME_MS = 60000;

const attachmentKey = (attachment: AttachmentRef): string => `${attachment.dono}/${attachment.id}`;

function saveFile(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
}

interface EntryCardProps {
  entry: QuickEntry;
  viewAll: boolean;
  opening: string | null;
  onOpen(attachment: AttachmentRef): void;
}

function EntryCard({ entry, viewAll, opening, onOpen }: EntryCardProps) {
  const purchase = entry.tipo === 'compra';
  return (
    <article className="history-item">
      <div className="head">
        <span>{purchase ? `Compra ${entry.referencia}` : 'Venda'}</span>
        <span>{formatMoney(entry.total)}</span>
      </div>
      <div className="meta">
        {entry.parte} · {formatDate(entry.data)}
        {viewAll && entry.criadoPor ? ` · por ${entry.criadoPor}` : ''}
      </div>
      <span className={classNames('status-badge', statusTone(entry.situacao))}>{entry.situacao}</span>
      <details>
        <summary>Ver detalhes</summary>
        {(entry.itens ?? []).map((item, index) => (
          <div key={index}>
            {item.material}: {formatNumber(item.quantidadeKg)} kg × {formatMoney(item.precoKg)} ={' '}
            {formatMoney(item.total)}
          </div>
        ))}
        <div className="meta">
          Vencimento: {formatDate(entry.vencimento)}
          {entry.nf ? ` · NF ${entry.nf}` : ''} · lançado em {formatDateTime(entry.criadoEm)}
        </div>
        {entry.observacao ? <div className="meta">Observação: {entry.observacao}</div> : null}
        {entry.textoFalado ? <div className="meta">Falado: "{entry.textoFalado}"</div> : null}
        {(entry.anexos ?? []).map((attachment) => (
          <button
            key={attachmentKey(attachment)}
            type="button"
            className="attachment-link"
            disabled={opening === attachmentKey(attachment)}
            onClick={() => onOpen(attachment)}
          >
            {attachment.tipo === 'application/pdf' ? 'PDF · ' : 'Foto · '}
            {attachment.nome}
          </button>
        ))}
      </details>
    </article>
  );
}

function AttachmentViewer({ url, onClose }: { url: string; onClose(): void }) {
  return (
    <div className="viewer">
      <button type="button" className="close" onClick={onClose}>
        Fechar
      </button>
      <img src={url} alt="Anexo" />
    </div>
  );
}

export function HistoryScreen({ api, onHome, onError }: HistoryScreenProps) {
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const [opening, setOpening] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.history().then(
      (result) => {
        if (active) setState({ status: 'ready', result });
      },
      (error: unknown) => {
        if (active) setState({ status: 'failed', message: messageOf(error, 'Não foi possível carregar.') });
      },
    );
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!viewerUrl) return undefined;
    return () => URL.revokeObjectURL(viewerUrl);
  }, [viewerUrl]);

  const open = async (attachment: AttachmentRef) => {
    setOpening(attachmentKey(attachment));
    try {
      const url = URL.createObjectURL(await api.downloadAttachment(attachment));
      if (attachment.tipo.startsWith('image/')) setViewerUrl(url);
      else saveFile(url, attachment.nome || 'anexo.pdf');
    } catch (error) {
      onError(messageOf(error, 'Não consegui abrir o anexo.'));
    } finally {
      setOpening(null);
    }
  };

  const viewAll = state.status === 'ready' && state.result.viewAll;
  return (
    <section>
      <div className="title-bar">
        <button type="button" className="back-button" onClick={onHome}>
          <Icon name="back" />
          Início
        </button>
        <h1 className="sec-title">{viewAll ? 'Lançamentos pelo celular' : 'Meus lançamentos'}</h1>
      </div>
      <div className="history-list">
        {state.status === 'loading' ? <p className="hint">Carregando…</p> : null}
        {state.status === 'failed' ? <p className="hint">{state.message}</p> : null}
        {state.status === 'ready' && !state.result.entries.length ? (
          <p className="hint">Nenhum lançamento ainda.</p>
        ) : null}
        {state.status === 'ready'
          ? state.result.entries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                viewAll={viewAll}
                opening={opening}
                onOpen={(attachment) => void open(attachment)}
              />
            ))
          : null}
      </div>
      {viewerUrl ? <AttachmentViewer url={viewerUrl} onClose={() => setViewerUrl(null)} /> : null}
    </section>
  );
}
