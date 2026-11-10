import { formatDate, formatMoney, formatNumber } from '../../../../shared/domain/format.js';
import { Icon } from '../../../../shared/ui/icons.js';
import {
  draftTotal,
  isPurchase,
  itemPrice,
  itemQuantity,
  itemTotal,
  uploadedAttachments,
} from '../../domain/entry-draft.js';
import type { EntryDraft } from '../../domain/entry-draft.js';

interface ReviewScreenProps {
  draft: EntryDraft;
  saving: boolean;
  saveLabel: string;
  onBack(): void;
  onSave(): void;
}

export function ReviewScreen({ draft, saving, saveLabel, onBack, onSave }: ReviewScreenProps) {
  const purchase = isPurchase(draft.kind);
  const total = draftTotal(draft);
  const invoice = draft.invoice.trim();
  const note = draft.note.trim();
  const attachments = uploadedAttachments(draft).length;
  return (
    <section>
      <div className="title-bar">
        <button type="button" className="back-button" onClick={onBack}>
          <Icon name="back" />
          Corrigir
        </button>
        <h1 className="sec-title">Está tudo certo?</h1>
      </div>
      <div className="tcard summary">
        <h2>
          {purchase ? 'Compra de ' : 'Venda para '}
          {draft.party?.nome}
        </h2>
        {draft.items.map((item) => (
          <div className="line" key={item.id}>
            <span>
              {item.material}
              <br />
              <small>
                {formatNumber(itemQuantity(item))} kg × {formatMoney(itemPrice(item))}
              </small>
            </span>
            <strong>{formatMoney(itemTotal(item))}</strong>
          </div>
        ))}
        <div className="summary-total">Total: {formatMoney(total)}</div>
        <div className="effect">
          Data: <b>{formatDate(draft.date)}</b>
          <br />
          Vai gerar <b>{purchase ? 'conta a pagar' : 'conta a receber'}</b> de {formatMoney(total)} com
          vencimento em <b>{formatDate(draft.dueDate || draft.date)}</b>.
          {!purchase && invoice ? (
            <>
              <br />
              Nota fiscal: {invoice}
            </>
          ) : null}
          {attachments ? (
            <>
              <br />
              Anexos: {attachments}
            </>
          ) : null}
          {note ? (
            <>
              <br />
              Observação: {note}
            </>
          ) : null}
        </div>
      </div>
      <button type="button" className="btn primary large with-icon" disabled={saving} onClick={onSave}>
        <Icon name="check" />
        {saveLabel}
      </button>
      <button type="button" className="btn secondary" onClick={onBack}>
        Não, quero corrigir
      </button>
    </section>
  );
}
