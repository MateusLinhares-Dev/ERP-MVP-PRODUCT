import { useId, useRef, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { formatMoney } from '../../../../shared/domain/format.js';
import { classNames } from '../../../../shared/ui/class-names.js';
import { Icon } from '../../../../shared/ui/icons.js';
import type { SpeechControls } from '../../application/use-speech-recognition.js';
import type { Party, QuickOptions } from '../../domain/contracts.js';
import {
  DATE_FIELD,
  DUE_DATE_FIELD,
  INVOICE_FIELD,
  NOTE_FIELD,
  PARTY_FIELD,
  addItem,
  applyTablePrice,
  chooseParty,
  draftTotal,
  editItem,
  isPurchase,
  itemField,
  itemPrice,
  itemTotal,
  partiesFor,
  partyLabel,
  removeItem,
  searchParties,
  tablePrice,
  withoutMarks,
} from '../../domain/entry-draft.js';
import type { EntryDraft, IdFactory, ItemDraft, ItemField } from '../../domain/entry-draft.js';

export type DraftChange = (change: (draft: EntryDraft) => EntryDraft) => void;

interface EntryScreenProps {
  draft: EntryDraft;
  options: QuickOptions;
  understanding: boolean;
  speech: SpeechControls;
  nextId: IdFactory;
  onChange: DraftChange;
  onUnderstand(): void;
  onSpeechUnsupported(): void;
  onAddFiles(files: File[]): void;
  onRemoveAttachment(localId: string): void;
  onReview(): boolean;
  onHome(): void;
}

type FormField = 'date' | 'dueDate' | 'invoice' | 'note';

function markClass(draft: EntryDraft, field: string): string | undefined {
  return (
    classNames(
      draft.speechFilled.includes(field) && 'speech-filled',
      draft.invalid.includes(field) && 'field-error',
    ) || undefined
  );
}

function scrollIntoCenterAfterRender(target: () => Element | null | undefined): void {
  requestAnimationFrame(() => target()?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

interface SpeechCardProps {
  draft: EntryDraft;
  understanding: boolean;
  speech: SpeechControls;
  doubtsRef: RefObject<HTMLDivElement | null>;
  onChange: DraftChange;
  onUnderstand(): void;
  onSpeechUnsupported(): void;
}

function SpeechCard({
  draft,
  understanding,
  speech,
  doubtsRef,
  onChange,
  onUnderstand,
  onSpeechUnsupported,
}: SpeechCardProps) {
  const textId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const tapMicrophone = () => {
    if (speech.supported) {
      speech.toggle(draft.spokenText);
      return;
    }
    onSpeechUnsupported();
    textRef.current?.focus();
  };
  return (
    <div className="tcard">
      <div className="tcard-hdr">
        <span className="tcard-title">Falar o lançamento</span>
      </div>
      <div className="tcard-body speech">
        <button
          type="button"
          className={classNames('microphone', speech.listening && 'listening')}
          onClick={tapMicrophone}
        >
          <span className="mic-circle">
            <Icon name="mic" />
          </span>
          <span>{speech.listening ? 'Ouvindo… fale agora (toque para parar)' : 'Toque e fale'}</span>
        </button>
        <p className="hint">
          {isPurchase(draft.kind)
            ? 'Exemplo: "Comprei 350 quilos de cobre mel do João a 42 reais."'
            : 'Exemplo: "Vendi 2 toneladas de ferro para a Gerdau a 1 real e 20, vence dia 20."'}
        </p>
        <div className="fg">
          <label htmlFor={textId}>O que foi entendido (pode escrever ou corrigir)</label>
          <textarea
            id={textId}
            ref={textRef}
            rows={3}
            placeholder="Ou escreva aqui. O microfone do teclado também funciona."
            value={draft.spokenText}
            onChange={(event) => {
              const spokenText = event.target.value;
              onChange((current) => ({ ...current, spokenText }));
            }}
          />
        </div>
        <button
          type="button"
          className="btn primary with-icon"
          disabled={understanding}
          onClick={onUnderstand}
        >
          <Icon name="spark" />
          {understanding ? 'Entendendo…' : 'Preencher com o que eu falei'}
        </button>
        {draft.doubts.length ? (
          <div className="notice" ref={doubtsRef}>
            <strong>Confira:</strong>
            <ul>
              {draft.doubts.map((doubt, index) => (
                <li key={index}>{doubt}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface PartyCardProps {
  draft: EntryDraft;
  options: QuickOptions;
  onChange: DraftChange;
}

function PartyCard({ draft, options, onChange }: PartyCardProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const parties = partiesFor(options, draft.kind);
  const label = partyLabel(draft.kind);
  const found = listOpen ? searchParties(parties, term) : [];
  const placeholder = parties.length
    ? `Toque para ver a lista ou digite o nome (${parties.length} cadastrados)`
    : `Nenhum ${label} encontrado no cadastro`;

  const choose = (party: Party) => {
    onChange((current) => chooseParty(current, party));
    setTerm('');
    setListOpen(false);
  };
  const replace = () => {
    onChange((current) => chooseParty(current, null));
    setTerm('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="tcard">
      <div className="tcard-hdr">
        <label className="tcard-title" htmlFor={inputId}>
          {isPurchase(draft.kind) ? 'Fornecedor (de quem comprou)' : 'Cliente (para quem vendeu)'}
        </label>
      </div>
      <div className="tcard-body">
        {draft.party ? (
          <div className={classNames('chosen', draft.speechFilled.includes(PARTY_FIELD) && 'speech-filled')}>
            <span>{draft.party.nome}</span>
            <button type="button" onClick={replace}>
              Trocar
            </button>
          </div>
        ) : (
          <>
            <input
              id={inputId}
              ref={inputRef}
              type="search"
              className={markClass(draft, PARTY_FIELD)}
              placeholder={placeholder}
              autoComplete="off"
              enterKeyHint="search"
              value={term}
              onFocus={() => setListOpen(true)}
              onChange={(event) => {
                setTerm(event.target.value);
                setListOpen(true);
              }}
            />
            {listOpen ? (
              <div className="option-list">
                {found.length ? (
                  found.map((party) => (
                    <button
                      key={`${party.cod}|${party.nome}`}
                      type="button"
                      className="option"
                      onClick={() => choose(party)}
                    >
                      {party.nome}
                    </button>
                  ))
                ) : (
                  <p className="hint">
                    Nenhum {label} encontrado com esse nome. Cadastro novo é feito no escritório.
                  </p>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

interface ItemRowProps {
  item: ItemDraft;
  position: number;
  removable: boolean;
  draft: EntryDraft;
  options: QuickOptions;
  nextId: IdFactory;
  onChange: DraftChange;
}

function ItemRow({ item, position, removable, draft, options, nextId, onChange }: ItemRowProps) {
  const fieldClass = (field: ItemField) => markClass(draft, itemField(item.id, field));
  const edit = (field: ItemField) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.value;
    onChange((current) => editItem(current, item.id, field, value));
  };
  const table = tablePrice(options, draft.kind, draft.party, item.material);
  const hasPrice = (itemPrice(item) ?? 0) > 0;
  const total = itemTotal(item);
  const unknownMaterial = item.material && !options.materials.includes(item.material);

  return (
    <div className="item">
      <div className="item-header">
        <span>Material {position}</span>
        {removable ? (
          <button type="button" onClick={() => onChange((current) => removeItem(current, item.id, nextId))}>
            Tirar
          </button>
        ) : null}
      </div>
      <select
        aria-label={`Material ${position}`}
        className={fieldClass('material')}
        value={item.material}
        onChange={edit('material')}
      >
        <option value="">Escolha o material…</option>
        {options.materials.map((material) => (
          <option key={material} value={material}>
            {material}
          </option>
        ))}
        {unknownMaterial ? <option value={item.material}>{item.material}</option> : null}
      </select>
      {item.spokenMaterial && !item.material ? (
        <div className="spoken">Você falou: "{item.spokenMaterial}" — escolha na lista acima.</div>
      ) : null}
      <div className="item-fields">
        <label>
          <span>Peso (kg)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            className={fieldClass('kg')}
            value={item.kgText}
            onChange={edit('kg')}
          />
        </label>
        <label>
          <span>Preço por kg (R$)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            className={fieldClass('price')}
            value={item.priceText}
            onChange={edit('price')}
          />
        </label>
      </div>
      {table && !hasPrice ? (
        <button
          type="button"
          className="use-table-price"
          onClick={() => onChange((current) => applyTablePrice(current, item.id, table))}
        >
          Usar preço da tabela: {formatMoney(table)} por kg
        </button>
      ) : null}
      {total ? <div className="subtotal">= {formatMoney(total)}</div> : null}
    </div>
  );
}

function ItemsCard({ draft, options, nextId, onChange }: PartyCardProps & { nextId: IdFactory }) {
  const listRef = useRef<HTMLDivElement>(null);
  const add = () => {
    onChange((current) => addItem(current, nextId));
    scrollIntoCenterAfterRender(() => listRef.current?.lastElementChild);
  };
  return (
    <div className="tcard">
      <div className="tcard-hdr">
        <span className="tcard-title">Materiais</span>
      </div>
      <div className="tcard-body">
        <div className="items" ref={listRef}>
          {draft.items.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              position={index + 1}
              removable={draft.items.length > 1}
              draft={draft}
              options={options}
              nextId={nextId}
              onChange={onChange}
            />
          ))}
        </div>
        <button type="button" className="btn secondary" onClick={add}>
          + Adicionar outro material
        </button>
      </div>
    </div>
  );
}

function setFormField(draft: EntryDraft, field: FormField, value: string): EntryDraft {
  const next = { ...draft };
  next[field] = value;
  return next;
}

function DatesCard({ draft, onChange }: { draft: EntryDraft; onChange: DraftChange }) {
  const dateId = useId();
  const dueDateId = useId();
  const invoiceId = useId();
  const noteId = useId();
  const purchase = isPurchase(draft.kind);
  const change = (field: FormField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    onChange((current) => setFormField(withoutMarks(current, field), field, value));
  };
  return (
    <div className="tcard">
      <div className="tcard-hdr">
        <span className="tcard-title">Datas e observação</span>
      </div>
      <div className="tcard-body">
        <div className="two-columns">
          <div className="fg">
            <label htmlFor={dateId}>{purchase ? 'Data da compra' : 'Data da venda'}</label>
            <input
              type="date"
              id={dateId}
              className={markClass(draft, DATE_FIELD)}
              value={draft.date}
              onChange={change('date')}
            />
          </div>
          <div className="fg">
            <label htmlFor={dueDateId}>
              {purchase ? 'Vencimento (pagar até)' : 'Vencimento (receber até)'}
            </label>
            <input
              type="date"
              id={dueDateId}
              className={markClass(draft, DUE_DATE_FIELD)}
              value={draft.dueDate}
              onChange={change('dueDate')}
            />
          </div>
        </div>
        {purchase ? null : (
          <div className="fg">
            <label htmlFor={invoiceId}>Nota fiscal (opcional)</label>
            <input
              id={invoiceId}
              inputMode="numeric"
              maxLength={40}
              className={markClass(draft, INVOICE_FIELD)}
              value={draft.invoice}
              onChange={change('invoice')}
            />
          </div>
        )}
        <div className="fg">
          <label htmlFor={noteId}>Observação (opcional)</label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={1000}
            className={markClass(draft, NOTE_FIELD)}
            value={draft.note}
            onChange={change('note')}
          />
        </div>
      </div>
    </div>
  );
}

interface AttachmentsCardProps {
  draft: EntryDraft;
  onAddFiles(files: File[]): void;
  onRemove(localId: string): void;
}

function AttachmentsCard({ draft, onAddFiles, onRemove }: AttachmentsCardProps) {
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length) onAddFiles(files);
  };
  return (
    <div className="tcard">
      <div className="tcard-hdr">
        <span className="tcard-title">Fotos e arquivos</span>
        <span className="tcard-extra">opcional</span>
      </div>
      <div className="tcard-body">
        <div className="two-columns">
          <label className="btn secondary file-picker with-icon">
            <Icon name="camera" />
            Tirar foto
            <input type="file" accept="image/*" capture="environment" onChange={pick} />
          </label>
          <label className="btn secondary file-picker with-icon">
            <Icon name="clip" />
            Foto ou PDF
            <input type="file" accept="image/*,application/pdf" multiple onChange={pick} />
          </label>
        </div>
        {draft.attachments.length ? (
          <ul className="attachments">
            {draft.attachments.map((attachment) => (
              <li key={attachment.localId}>
                {attachment.preview ? (
                  <img src={attachment.preview} alt="" />
                ) : (
                  <span className="file-type" aria-hidden="true">
                    PDF
                  </span>
                )}
                <span className="name">
                  {attachment.nome}
                  <br />
                  <span className="status">{attachment.status}</span>
                </span>
                <button type="button" aria-label="Tirar anexo" onClick={() => onRemove(attachment.localId)}>
                  Tirar
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function EntryScreen({
  draft,
  options,
  understanding,
  speech,
  nextId,
  onChange,
  onUnderstand,
  onSpeechUnsupported,
  onAddFiles,
  onRemoveAttachment,
  onReview,
  onHome,
}: EntryScreenProps) {
  const doubtsRef = useRef<HTMLDivElement>(null);
  const review = () => {
    if (!onReview()) scrollIntoCenterAfterRender(() => doubtsRef.current);
  };
  return (
    <section>
      <div className="title-bar">
        <button type="button" className="back-button" aria-label="Voltar ao início" onClick={onHome}>
          <Icon name="back" />
          Início
        </button>
        <h1 className="sec-title">{isPurchase(draft.kind) ? 'Nova compra' : 'Nova venda'}</h1>
      </div>
      <SpeechCard
        draft={draft}
        understanding={understanding}
        speech={speech}
        doubtsRef={doubtsRef}
        onChange={onChange}
        onUnderstand={onUnderstand}
        onSpeechUnsupported={onSpeechUnsupported}
      />
      <PartyCard draft={draft} options={options} onChange={onChange} />
      <ItemsCard draft={draft} options={options} nextId={nextId} onChange={onChange} />
      <DatesCard draft={draft} onChange={onChange} />
      <AttachmentsCard draft={draft} onAddFiles={onAddFiles} onRemove={onRemoveAttachment} />
      <div className="total-bar">
        <div className="total-label">
          Total<strong>{formatMoney(draftTotal(draft))}</strong>
        </div>
        <button type="button" className="btn primary confirm" onClick={review}>
          Conferir e salvar
        </button>
      </div>
    </section>
  );
}
