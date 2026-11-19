import { useCallback, useEffect, useMemo, useState } from 'react';
import { toBRDate } from '../../../shared/domain/dates.js';
import { formatBRL } from '../../../shared/domain/money.js';
import { pageOf, Pager } from '../../../shared/ui/Pager.js';
import {
  autoDebit,
  bankSummaries,
  csvOf,
  depositLines,
  pendingForDeposit,
  reviewOf,
  reviewText,
  sequences,
  SITUATION_FILTERS,
  SITUATION_LABEL,
  sumOf,
  totalsOf,
  visibleCheques,
  type ControlCheque,
  type Filters,
  type Raw,
} from '../domain/control.js';
import {
  batchPayload,
  deleteBlock,
  formFor,
  reopenBlock,
  savePayload,
  type BatchForm,
  type ChequeForm,
} from '../domain/forms.js';
import { BatchDialog, ChequeDialog, ClearDialog, DepositDialog } from './ChequeDialogs.js';
import {
  loadKey,
  movementKey,
  type ChequeControlController,
  type ChequeControlPort,
  type ChequeControlSnapshot,
} from './ports.js';

type Modal =
  | { kind: 'edit'; form: ChequeForm }
  | { kind: 'batch' }
  | { kind: 'deposit' }
  | { kind: 'clear'; cheque: ControlCheque };

const list = (value: unknown): Raw[] =>
  (Array.isArray(value) ? value : []).filter(
    (item): item is Raw => Boolean(item) && typeof item === 'object',
  );

export function ChequeControlWorkspace({
  snapshot,
  port,
  controller,
}: {
  snapshot: ChequeControlSnapshot;
  port: ChequeControlPort;
  controller: ChequeControlController;
}) {
  const [filters, setFilters] = useState<Filters>({ situation: 'A', bank: 'TODOS', search: '' });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { cheques, banks, destinations, loadDiscounts, advanceOwners, advanceMovements } = snapshot;
  const secretary = port.secretary;

  const hasMovement = useCallback(
    (supplierCode: string, advanceCode: string) =>
      advanceMovements.has(movementKey(supplierCode, advanceCode)),
    [advanceMovements],
  );
  const bankCode = useCallback(
    (name: string) => banks.find((bank) => bank.name === name)?.code ?? '',
    [banks],
  );

  const openNew = useCallback(
    (prefill?: Partial<ChequeForm>) => setModal({ kind: 'edit', form: formFor(null, banks, prefill) }),
    [banks],
  );
  useEffect(
    () =>
      controller.register((command) => {
        if (command.kind === 'new')
          openNew({
            ...(command.bank ? { bank: command.bank } : {}),
            ...(command.number ? { number: command.number } : {}),
          });
      }),
    [controller, openNew],
  );

  const totals = useMemo(() => totalsOf(cheques), [cheques]);
  const cards = useMemo(() => bankSummaries(cheques, banks), [cheques, banks]);
  const visible = useMemo(() => visibleCheques(cheques, filters, banks), [cheques, filters, banks]);
  const review = useMemo(() => reviewOf(sequences(cheques)), [cheques]);
  const shown = pageOf(visible, page, size);

  const change = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      port.notify('Erro: ' + (error instanceof Error ? error.message : String(error)), 'error', 9000);
    } finally {
      setBusy(false);
    }
  }

  const warnings = (result: Raw) => {
    for (const warning of Array.isArray(result.warnings) ? (result.warnings as unknown[]) : [])
      port.notify(String(warning), 'warn', 10000);
  };

  function save(form: ChequeForm, check: { duplicate: boolean; confirm: string }) {
    if (!form.number.trim()) return port.notify('Preencha o número do cheque.', 'error');
    if (check.duplicate) return port.notify('Esse número de cheque já existe neste banco.', 'error', 6500);
    if (check.confirm && !port.confirm('Atenção: ' + check.confirm + '\n\nDeseja salvar mesmo assim?'))
      return;
    void run(async () => {
      await port.request(savePayload(form, banks, destinations));
      setModal(null);
      port.notify('Cheque salvo.', 'success');
    });
  }

  function edit(cheque: ControlCheque) {
    if (cheque.advanceCode) {
      const owner =
        cheque.supplierCode && advanceOwners.get(cheque.advanceCode) === cheque.supplierCode
          ? cheque.supplierCode
          : (advanceOwners.get(cheque.advanceCode) ?? '');
      if (!owner)
        return port.notify(
          'Este cheque pertence ao adiantamento ' +
            cheque.advanceCode +
            ', que não foi encontrado. Abra Adiantamentos e atualize.',
          'error',
          8000,
        );
      return port.editAdvance(owner, cheque.advanceCode);
    }
    setModal({ kind: 'edit', form: formFor(cheque, banks) });
  }

  function clear(cheque: ControlCheque, date: string, choice: boolean | null) {
    const auto = autoDebit(cheque, hasMovement);
    const debit = choice ?? auto ?? true;
    void run(async () => {
      const result = await port.request({
        action: 'clear-cheques',
        mode: 'controle',
        date: toBRDate(date),
        cheques: [{ id: cheque.id, bankCode: bankCode(cheque.bank), debit }],
      });
      setModal(null);
      warnings(result);
      if (Array.isArray(result.skipped) && result.skipped.length)
        return port.notify(
          'O cheque ' + cheque.number + ' já não estava a compensar. A lista foi atualizada.',
          'info',
        );
      port.notify(
        'Cheque ' +
          cheque.number +
          ' compensado' +
          (Array.isArray(result.movements) && result.movements.length ? ' — saiu do saldo do banco.' : '.'),
        'success',
      );
    });
  }

  function deposit(date: string, selected: ControlCheque[]) {
    const lines = depositLines(selected, bankCode, hasMovement);
    if (!lines.length)
      return port.notify('Os cheques marcados já foram compensados. A lista foi atualizada.', 'info');
    if (
      !port.confirm(
        'Depositar ' +
          lines.length +
          ' cheque(s) na data ' +
          toBRDate(date) +
          '? Eles viram Compensados e saem do saldo do banco (os de adiantamento não descontam de novo).',
      )
    )
      return;
    void run(async () => {
      const result = await port.request({ action: 'clear-cheques', mode: 'remessa', date, cheques: lines });
      setModal(null);
      warnings(result);
      const ids = new Set(list(result.cleared).map((row) => String(row.id ?? '')));
      const total = sumOf(selected.filter((cheque) => ids.has(cheque.id)));
      port.notify(
        'Remessa depositada: ' + ids.size + ' cheque(s) · ' + formatBRL(total) + '. Saiu do saldo do banco.',
        'success',
        6000,
      );
    });
  }

  function batch(form: BatchForm) {
    const payload = batchPayload(form, banks);
    if (payload.start < 1) return port.notify('Informe o número inicial do cheque.', 'error');
    if (payload.count < 1 || payload.count > 200)
      return port.notify('Quantidade deve ser entre 1 e 200.', 'error');
    void run(async () => {
      const result = await port.request(payload);
      const added = list(result.cheques).length;
      const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
      if (!added) return port.notify('Nada a lançar — esses números já existem nesse banco.', 'info', 6000);
      setModal(null);
      port.notify(
        'Remessa lançada: ' +
          added +
          ' cheque(s)' +
          (skipped ? ' (' + skipped + ' já existiam, pulei)' : '') +
          '.',
        'success',
        7000,
      );
    });
  }

  function reopen(cheque: ControlCheque) {
    const blocked = reopenBlock(cheque, port.canBank);
    if (blocked) return port.alert(blocked);
    void run(async () => {
      await port.request({ action: 'reopen-cheque', id: cheque.id });
      port.notify(
        'Cheque ' +
          cheque.number +
          ' voltou para A Compensar' +
          (cheque.bankMovementId ? ' — devolvido ao saldo do banco.' : '.'),
        'success',
      );
    });
  }

  function remove(cheque: ControlCheque) {
    const blocked = deleteBlock(cheque, port.canBank);
    if (blocked) return port.alert(blocked);
    if (
      !port.confirm(
        'Excluir o cheque nº ' +
          cheque.number +
          ' (' +
          cheque.bank +
          ', ' +
          formatBRL(cheque.value) +
          ')?\n\nEle sai do controle em todos os computadores.',
      )
    )
      return;
    void run(async () => {
      await port.request({ action: 'delete-cheque', id: cheque.id });
      port.notify('Cheque excluído.', 'success');
    });
  }

  function togglePurchase(cheque: ControlCheque) {
    if (cheque.advanceCode)
      return port.notify(
        'Cheque do adiantamento ' +
          cheque.advanceCode +
          ': o vínculo com a compra é controlado pelo próprio adiantamento.',
        'info',
      );
    void run(async () => {
      const result = await port.request({ action: 'toggle-cheque-discount', id: cheque.id });
      const marked = (result.cheque as Raw | undefined)?.dc === true;
      port.notify(marked ? 'Marcado: abate compra (adiantamento).' : 'Desmarcado.', 'success');
    });
  }

  function toggleLoad(cheque: ControlCheque) {
    const load = loadDiscounts.get(loadKey(cheque.bank, cheque.number));
    if (!load) return port.notify('Esse cheque não está no adiantamento (não é de carga).', 'info');
    const value = load.status === 'Descontado' ? 'A descontar' : 'Descontado';
    void run(async () => {
      await port.supplierCheque({
        action: 'discount',
        fornCod: load.supplierCode,
        value,
        ids: [{ id: load.ref, index: load.index }],
      });
      port.notify(
        value === 'Descontado' ? 'Cheque descontado da carga.' : 'Desconto da carga desfeito.',
        'success',
      );
    });
  }

  function exportCsv() {
    port.download('cheques_controle.csv', csvOf(cheques));
  }

  if (!snapshot.ready) return <div className="erp-cc-loading">Carregando cheques...</div>;

  return (
    <div className="erp-cc">
      <div className="erp-cc-help">
        <b>“Abate compra?”</b> Use <strong>Sim</strong> somente quando o cheque for um{' '}
        <strong>adiantamento ao fornecedor</strong>. Assim ele pode reduzir o saldo da compra. Compensar o
        cheque no banco é outra operação.
      </div>
      <div className="erp-cc-head">
        <div>
          <b>Controle de cheques</b>
          <small>Confira números faltantes por banco sem carregar listas extensas.</small>
        </div>
        <button
          type="button"
          id="erp-cc-attention"
          className={'erp-cc-attention' + (review.total ? ' has-attention' : '')}
          aria-expanded={reviewOpen}
          aria-controls="erp-cc-review"
          onClick={() => setReviewOpen((current) => !current)}
        >
          {review.total ? `Atenções da numeração (${review.total})` : 'Numeração sem lacunas'}
        </button>
      </div>
      {reviewOpen ? (
        <section id="erp-cc-review" className="erp-cc-review">
          <div className="erp-cc-review-heading">
            <div>
              <strong>Conferência de numeração</strong>
              <small>
                {review.total} intervalo(s) para analisar
                {review.jumps ? ` · ${review.jumps} possível(is) novo(s) talão(ões)` : ''}
              </small>
            </div>
            <button type="button" className="erp-cp-outline" onClick={() => setReviewOpen(false)}>
              Fechar
            </button>
          </div>
          <div className="erp-cc-review-scroll">
            {review.rows.map((row) => (
              <div
                className="erp-cc-review-row"
                key={row.bank + '|' + row.type + '|' + row.gap.start + '|' + String(row.number)}
              >
                <span>
                  <b>{row.bank}</b>
                  <small>{reviewText(row)}</small>
                </span>
                {row.type === 'jump' || row.number == null ? (
                  <span className="erp-cc-review-caution">Conferir talão</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openNew({ bank: row.bank, number: String(row.number) })}
                  >
                    + Cadastrar nº {row.number.toLocaleString('pt-BR')}
                  </button>
                )}
              </div>
            ))}
            {!review.rows.length ? <p>Nenhuma lacuna na numeração.</p> : null}
          </div>
          {review.limited ? (
            <p className="erp-cc-review-more">
              Existem outras ocorrências. Após tratar os primeiros números, atualize a consulta. Nenhuma
              sequência foi alterada automaticamente.
            </p>
          ) : null}
        </section>
      ) : null}

      {!secretary ? (
        <div className="kpi-grid">
          <div className="kpi o">
            <div className="kpi-lbl">A Compensar</div>
            <div className="kpi-val">{formatBRL(totals.A.value)}</div>
            <div className="kpi-sub">{totals.A.count} cheque(s) pendente(s)</div>
          </div>
          <div className="kpi g">
            <div className="kpi-lbl">Compensados</div>
            <div className="kpi-val">{totals.C.count}</div>
            <div className="kpi-sub">{formatBRL(totals.C.value)} já caíram</div>
          </div>
          <div className="kpi">
            <div className="kpi-lbl">Cancelados</div>
            <div className="kpi-val">{totals.X.count}</div>
            <div className="kpi-sub">cheques cancelados</div>
          </div>
          <div className="kpi r">
            <div className="kpi-lbl">Total no controle</div>
            <div className="kpi-val">{totals.all}</div>
            <div className="kpi-sub">cheques registrados</div>
          </div>
        </div>
      ) : null}

      {!secretary && cards.length ? (
        <div className="erp-cc-banks">
          {cards.map((card) => (
            <button
              type="button"
              key={card.bank}
              className="erp-cc-bank"
              style={{ borderTopColor: card.color }}
              title="Ver todos os cheques deste banco em ordem"
              onClick={() => change({ bank: card.bank, situation: 'TODOS' })}
            >
              <span className="erp-cc-bank-name" style={{ color: card.color }}>
                {card.bank}
              </span>
              <span className="erp-cc-bank-line pending">
                <span>A compensar</span>
                <b>{formatBRL(card.pendingValue)}</b>
              </span>
              <small>{card.pendingCount} cheque(s)</small>
              <span className="erp-cc-bank-line cleared">
                <span>Compensado</span>
                <b>{formatBRL(card.clearedValue)}</b>
              </span>
              <small>{card.clearedCount} cheque(s)</small>
            </button>
          ))}
        </div>
      ) : null}

      <div className="erp-cc-toolbar">
        <div className="erp-cc-segments" role="group" aria-label="Situação">
          {SITUATION_FILTERS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={filters.situation === option.value ? 'is-active' : ''}
              aria-pressed={filters.situation === option.value}
              onClick={() => change({ situation: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Banco"
          value={filters.bank}
          onChange={(event) => change({ bank: event.target.value })}
        >
          <option value="TODOS">Todos os bancos</option>
          {banks.map((bank) => (
            <option key={bank.name} value={bank.name}>
              {bank.name}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Buscar cheque"
          placeholder="Nº ou cliente..."
          value={filters.search}
          onChange={(event) => change({ search: event.target.value })}
        />
        <span className="erp-cc-spacer" />
        <button type="button" className="btn-add" id="erp-cc-new" onClick={() => openNew()}>
          + Novo Cheque
        </button>
        <button type="button" className="btn-add erp-cc-batch" onClick={() => setModal({ kind: 'batch' })}>
          Remessa (vários)
        </button>
        {!secretary ? (
          <button
            type="button"
            className="btn-add erp-cc-deposit"
            id="erp-cc-deposit"
            onClick={() => {
              if (!pendingForDeposit(cheques, filters.bank).length)
                return port.notify(
                  'Não há cheques "A compensar" para depositar' +
                    (filters.bank !== 'TODOS' ? ' nesse banco' : '') +
                    '.',
                  'info',
                );
              setModal({ kind: 'deposit' });
            }}
          >
            Depositar em lote
          </button>
        ) : null}
        {!secretary ? (
          <button type="button" className="btn-edit" onClick={exportCsv} title="Baixar em Excel/CSV">
            Exportar
          </button>
        ) : null}
      </div>

      <div className="erp-cc-count">
        Mostrando <b>{visible.length}</b> cheque(s)
        {!secretary ? (
          <>
            {' '}
            — total <b>{formatBRL(sumOf(visible))}</b>
          </>
        ) : null}
      </div>

      <div className="erp-bk-table-wrap">
        <table className="erp-cc-table">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Banco</th>
              <th>Cliente</th>
              <th className="erp-bk-right">Valor</th>
              <th>Data saída</th>
              <th>Vencimento</th>
              <th>Caiu em</th>
              <th>Situação</th>
              <th
                className="erp-cc-center"
                title="Sim = este cheque representa um adiantamento e deve ser abatido do valor da compra."
              >
                Abate compra?
              </th>
              <th className="erp-cc-center">Ações</th>
            </tr>
          </thead>
          <tbody>
            {shown.rows.length ? (
              shown.rows.map((cheque) => {
                const load = loadDiscounts.get(loadKey(cheque.bank, cheque.number));
                const color = banks.find((bank) => bank.name === cheque.bank)?.color ?? '#999';
                const struck = cheque.situation === 'X' || cheque.situation === 'N';
                return (
                  <tr
                    key={cheque.id}
                    className={'erp-cc-row s-' + cheque.situation}
                    data-cheque-id={cheque.id}
                  >
                    <td className="erp-cc-number">{cheque.number}</td>
                    <td className="erp-bk-nowrap">
                      <span className="erp-cc-dot" style={{ background: color }} />
                      {cheque.bank}
                    </td>
                    <td className={struck ? 'erp-cc-struck' : ''}>
                      {cheque.holder || (cheque.situation === 'N' ? 'não emitido' : '')}
                    </td>
                    <td className="erp-bk-right erp-cc-value">{formatBRL(cheque.value)}</td>
                    <td className="erp-bk-muted">{cheque.issued}</td>
                    <td className="erp-cc-due">{cheque.due}</td>
                    <td className="erp-bk-muted">{cheque.cleared}</td>
                    <td>
                      <span className={'erp-cc-status s-' + cheque.situation}>
                        {SITUATION_LABEL[cheque.situation]}
                      </span>
                    </td>
                    <td className="erp-cc-center">
                      <button
                        type="button"
                        className={'erp-cc-purchase' + (cheque.discountsPurchase ? ' is-on' : '')}
                        disabled={busy}
                        title={
                          cheque.discountsPurchase
                            ? 'Este cheque será considerado adiantamento e poderá abater o valor da compra. Clique para desmarcar.'
                            : 'Marcar: este cheque é adiantamento e abate a compra'
                        }
                        onClick={() => togglePurchase(cheque)}
                      >
                        {cheque.discountsPurchase ? 'Sim · adiantamento' : '—'}
                      </button>
                    </td>
                    <td className="erp-cc-actions">
                      {!secretary && cheque.situation === 'A' ? (
                        <button
                          type="button"
                          className="erp-cc-act clear"
                          disabled={busy}
                          onClick={() => setModal({ kind: 'clear', cheque })}
                        >
                          Compensou
                        </button>
                      ) : null}
                      {!secretary && cheque.situation === 'C' ? (
                        <button
                          type="button"
                          className="erp-cc-act reopen"
                          disabled={busy}
                          onClick={() => reopen(cheque)}
                        >
                          Reabrir
                        </button>
                      ) : null}
                      {load ? (
                        <button
                          type="button"
                          className={'erp-cc-act load' + (load.status === 'Descontado' ? ' done' : '')}
                          disabled={busy}
                          title={
                            load.status === 'Descontado'
                              ? 'Já descontado da carga do fornecedor. Clique para desfazer.'
                              : 'Marcar como descontado da carga do fornecedor'
                          }
                          onClick={() => toggleLoad(cheque)}
                        >
                          {load.status === 'Descontado' ? 'Desfazer carga' : 'Descontar carga'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="erp-cc-act icon"
                        title="Editar"
                        aria-label={'Editar cheque ' + cheque.number}
                        disabled={busy}
                        onClick={() => edit(cheque)}
                      >
                        ✏️
                      </button>
                      {!secretary ? (
                        <button
                          type="button"
                          className="erp-cc-act icon danger"
                          title="Excluir"
                          aria-label={'Excluir cheque ' + cheque.number}
                          disabled={busy}
                          onClick={() => remove(cheque)}
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
                <td colSpan={10} className="erp-bk-empty">
                  Nenhum cheque neste filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager
        total={visible.length}
        page={shown.page}
        pages={shown.pages}
        size={size}
        onPage={setPage}
        onSize={(next) => {
          setSize(next);
          setPage(1);
        }}
      />

      {modal?.kind === 'edit' ? (
        <ChequeDialog
          initial={modal.form}
          banks={banks}
          destinations={destinations}
          cheques={cheques}
          busy={busy}
          onSave={save}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'batch' ? (
        <BatchDialog banks={banks} busy={busy} onSave={batch} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'deposit' ? (
        <DepositDialog
          pending={pendingForDeposit(cheques, filters.bank)}
          today={port.today()}
          busy={busy}
          onConfirm={deposit}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'clear' ? (
        <ClearDialog
          cheque={modal.cheque}
          today={port.today()}
          askDebit={autoDebit(modal.cheque, hasMovement) === null && modal.cheque.discountsPurchase}
          busy={busy}
          onConfirm={(date, choice) => clear(modal.cheque, date, choice)}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}
