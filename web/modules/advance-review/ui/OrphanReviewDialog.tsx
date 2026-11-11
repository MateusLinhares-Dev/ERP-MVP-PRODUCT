import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../../../shared/domain/format.js';
import { newId } from '../../../shared/domain/ids.js';
import {
  REVIEW_CHOICES,
  canSubmit,
  confirmationOf,
  guidanceOf,
  reviewPayload,
  submitLabel,
} from '../domain/orphan-review.js';
import type { OrphanPreview, OrphanReply, ReviewChoice } from '../domain/orphan-review.js';

interface OrphanReviewDialogProps {
  preview: OrphanPreview;
  supplierCode: string;
  advanceCode: string;
  send(payload: Record<string, unknown>): Promise<OrphanReply>;
  onDone(reply: OrphanReply | null): void;
}

const RETRY_MESSAGE =
  'Ainda não conseguimos confirmar o resultado. Clique em “Verificar novamente” para consultar a mesma operação, sem enviar outro lançamento.';

export function OrphanReviewDialog({
  preview,
  supplierCode,
  advanceCode,
  send,
  onDone,
}: OrphanReviewDialogProps) {
  const [choice, setChoice] = useState<ReviewChoice>('');
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const select = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    select.current?.focus();
  }, []);

  const retrying = pending !== null;
  const form = { choice, confirmed, note, reference };
  const enabled = !busy && canSubmit(preview, form, retrying);
  const locked = retrying || busy;

  const submit = async () => {
    if (!enabled) return;
    const payload =
      pending ??
      reviewPayload(form, { supplierCode, advanceCode, signature: preview.signature, operationId: newId() });
    setPending(payload);
    setBusy(true);
    setFeedback('Conferindo e registrando no servidor…');
    try {
      const reply = await send(payload);
      if (!reply.confirmed) throw new Error('O sistema não confirmou a conferência.');
      onDone(reply);
    } catch (error) {
      console.warn('advance.business.reconciliation.failed', {
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : '',
      });
      setFeedback(RETRY_MESSAGE);
      setBusy(false);
    }
  };

  return (
    <div className="erp-orphan-review-overlay">
      <section
        className="erp-orphan-review"
        role="dialog"
        aria-modal="true"
        aria-label="Conferir adiantamento"
      >
        <h2>Conferir pagamento do adiantamento</h2>
        <p>
          O adiantamento está cadastrado, mas não encontramos o lançamento correspondente no extrato do ERP.
          Vamos conferir o que aconteceu.
        </p>
        <div className="erp-orphan-review-box">
          <strong>
            {formatMoney(preview.amount)} — {preview.supplierName || 'Fornecedor'}
          </strong>
          <p>
            Conta: {preview.bankName || 'não identificada'} | Data: {preview.date || 'não informada'}
          </p>
        </div>
        <p>
          1. Abra o extrato real dessa conta (aplicativo do banco ou comprovante). Confira a data, o valor e o
          favorecido. Não use apenas o extrato do ERP.
        </p>
        <label className="erp-orphan-review-field">
          2. O que aconteceu com esse pagamento?
          <select
            ref={select}
            value={choice}
            disabled={locked}
            onChange={(event) => {
              setChoice(event.target.value as ReviewChoice);
              setConfirmed(false);
            }}
          >
            {REVIEW_CHOICES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="erp-orphan-review-guidance">{guidanceOf(choice, preview)}</p>
        {choice === 'paid' ? (
          <input
            className="erp-orphan-review-reference"
            placeholder="Número do comprovante ou referência do extrato"
            maxLength={120}
            disabled={locked}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        ) : null}
        {choice && choice !== 'uncertain' ? (
          <label className="erp-orphan-review-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={locked}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>{confirmationOf(choice)}</span>
          </label>
        ) : null}
        <label className="erp-orphan-review-field">
          3. Descreva o que conferiu
          <textarea
            maxLength={500}
            placeholder="Ex.: Conferi o extrato da conta e o comprovante da data ..."
            disabled={locked}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <p className="erp-orphan-review-feedback" role="status">
          {feedback}
        </p>
        <div className="erp-orphan-review-actions">
          <button type="button" disabled={busy} onClick={() => onDone(null)}>
            Voltar
          </button>
          <button type="button" className="primary" disabled={!enabled} onClick={() => void submit()}>
            {submitLabel(choice, retrying)}
          </button>
        </div>
      </section>
    </div>
  );
}
