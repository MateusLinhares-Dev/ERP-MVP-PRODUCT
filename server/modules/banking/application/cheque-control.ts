import { fail } from '../../../shared/errors/app-error.js';
import { safeKey, type Row } from '../domain/bank-ledger-rules.js';
import {
  MAX_BATCH,
  MAX_IMPORT,
  applyDestination,
  chequeSlug,
  cleanCheque,
  duplicateOf,
  financialChange,
  nextChequeId,
} from '../domain/cheque-control-rules.js';
import {
  CHEQUES_LOCK,
  actor,
  clean,
  lock,
  read,
  requireKey,
  rows,
  text,
  type Context,
} from './ledger-support.js';

async function loadControl(context: Context) {
  const [control, deleted] = await Promise.all([
    read(context.db, 'erp/chequesControle'),
    read(context.db, 'erp/chequesControle_del'),
  ]);
  const deletedIds = new Set(
    rows(deleted)
      .map(([key]) => key)
      .concat(
        Object.entries(deleted && typeof deleted === 'object' ? (deleted as Row) : {})
          .filter(([, value]) => value === true)
          .map(([key]) => key),
      ),
  );
  const cheques = rows(control).filter(([id]) => !deletedIds.has(id));
  return {
    cheques,
    byId: new Map(cheques),
    deletedIds,
    taken: new Set([...rows(control).map(([id]) => id), ...deletedIds]),
  };
}

const duplicateMessage = (bank: string, number: string, found: Row) =>
  `Cheque ${bank} nº ${number} já está cadastrado` +
  (found.advanceCode
    ? ` (adiantamento ${text(found.advanceCode, 60)})`
    : found.c
      ? ` (${text(found.c, 80)})`
      : '') +
  '. O mesmo banco não pode ter dois cheques com o mesmo número.';

export async function saveCheque(context: Context, body: Row) {
  const { fields, problem } = cleanCheque(body.cheque);
  if (problem) fail(422, problem.code, problem.message);
  const id = body.id ? requireKey(body.id, 'Cheque inválido. Atualize a lista.') : '';
  return lock(context, [CHEQUES_LOCK], async () => {
    const { cheques, byId, taken } = await loadControl(context);
    const existing = id ? (byId.get(id) ?? null) : null;
    if (id && !existing) fail(404, 'CHEQUE_NOT_FOUND', 'Cheque não encontrado. Atualize a lista de cheques.');
    if (existing?.advanceCode)
      fail(
        422,
        'CHEQUE_FROM_ADVANCE',
        `Este cheque pertence ao adiantamento ${text(existing.advanceCode, 60)}. Corrija pelo próprio adiantamento.`,
      );
    if (existing?.movBancoId && financialChange(existing, fields))
      fail(
        409,
        'CHEQUE_ALREADY_DEBITED',
        'Este cheque já saiu do saldo do banco. Para mudar banco, número, valor, situação ou data de compensação, use Reabrir (o valor volta ao banco) e depois edite.',
      );
    const twin = duplicateOf(cheques, fields.b, fields.n, id);
    if (twin) fail(409, 'CHEQUE_ALREADY_EXISTS', duplicateMessage(fields.b, fields.n, twin));
    const chequeId = id || nextChequeId(taken, chequeSlug(fields.b, body.slug), fields.n);
    const base: Row = existing ? { ...existing, ...fields } : { id: chequeId, ...fields };
    const record = applyDestination(
      { ...base, id: chequeId, alteradoPor: actor(context.identity), _upd: context.now() },
      existing,
      body.destino,
    );
    await context.db
      .ref()
      .update({ ['erp/chequesControle/' + chequeId]: clean(record), 'erp/_ts': context.now() });
    return { action: 'save-cheque', cheque: record };
  });
}

export async function batchCheques(context: Context, body: Row) {
  const start = Number(body.start);
  const count = Number(body.count);
  if (!Number.isSafeInteger(start) || start < 1)
    fail(422, 'INVALID_START', 'Informe o número inicial do cheque.');
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BATCH)
    fail(422, 'INVALID_COUNT', `Quantidade deve ser entre 1 e ${MAX_BATCH}.`);
  const status = body.s === 'C' ? 'C' : 'A';
  const { fields, problem } = cleanCheque({ ...(body.cheque as Row), n: String(start), s: status });
  if (problem) fail(422, problem.code, problem.message);
  return lock(context, [CHEQUES_LOCK], async () => {
    const { cheques, taken } = await loadControl(context);
    const slug = chequeSlug(fields.b, body.slug);
    const now = context.now();
    const updates: Row = {};
    const created: Row[] = [];
    const skipped: string[] = [];
    const known: [string, Row][] = [...cheques];
    for (let index = 0; index < count; index++) {
      const number = String(start + index);
      if (duplicateOf(known, fields.b, number)) {
        skipped.push(number);
        continue;
      }
      const id = nextChequeId(taken, slug, number);
      taken.add(id);
      const record: Row = {
        ...fields,
        id,
        n: number,
        cd: status === 'C' ? fields.d : '',
        dc: body.dc === true,
        alteradoPor: actor(context.identity),
        _upd: now,
      };
      known.push([id, record]);
      created.push(record);
      updates['erp/chequesControle/' + id] = clean(record);
    }
    if (created.length) {
      updates['erp/_ts'] = now;
      await context.db.ref().update(updates);
    }
    return { action: 'batch-cheques', cheques: created, skipped };
  });
}

export async function toggleChequeDiscount(context: Context, body: Row) {
  const id = requireKey(body.id, 'Cheque inválido. Atualize a lista.');
  return lock(context, [CHEQUES_LOCK], async () => {
    const { byId } = await loadControl(context);
    const existing = byId.get(id);
    if (!existing) fail(404, 'CHEQUE_NOT_FOUND', 'Cheque não encontrado. Atualize a lista de cheques.');
    const cheque = existing as Row;
    if (cheque.advanceCode)
      fail(
        422,
        'CHEQUE_FROM_ADVANCE',
        `Cheque do adiantamento ${text(cheque.advanceCode, 60)}: o vínculo com a compra é controlado pelo próprio adiantamento.`,
      );
    const record: Row = { ...cheque, _upd: context.now(), alteradoPor: actor(context.identity) };
    if (cheque.dc) delete record.dc;
    else record.dc = true;
    await context.db.ref().update({ ['erp/chequesControle/' + id]: clean(record), 'erp/_ts': context.now() });
    return { action: 'toggle-cheque-discount', cheque: record };
  });
}

export async function importLegacyCheques(context: Context, body: Row) {
  const items = Array.isArray(body.items) ? body.items : [];
  const ghosts = Array.isArray(body.ghosts) ? body.ghosts : [];
  if (items.length + ghosts.length > MAX_IMPORT)
    fail(422, 'TOO_MANY_CHEQUES', `Envie no máximo ${MAX_IMPORT} cheques por vez.`);
  return lock(context, [CHEQUES_LOCK], async () => {
    const { byId, deletedIds } = await loadControl(context);
    const now = context.now();
    const updates: Row = {};
    const changed: Row[] = [];
    let created = 0;
    let updated = 0;
    let marked = 0;
    const kept: string[] = [];
    for (const item of items) {
      const id = safeKey((item as Row)?.id);
      const { fields, problem } = cleanCheque(item);
      if (!id || problem || deletedIds.has(id)) continue;
      const existing = byId.get(id);
      if (existing?.advanceCode) {
        kept.push(id);
        continue;
      }
      const record: Row = existing?.movBancoId
        ? { ...existing, c: fields.c, d: fields.d }
        : { ...existing, ...fields, id, dc: true };
      if (existing?.movBancoId) kept.push(id);
      record._upd = now;
      record.alteradoPor = actor(context.identity);
      if (existing) updated++;
      else created++;
      changed.push(record);
      updates['erp/chequesControle/' + id] = clean(record);
    }
    for (const raw of ghosts) {
      const id = safeKey(raw);
      const existing = id ? byId.get(id) : undefined;
      if (!existing || updates['erp/chequesControle/' + id]) continue;
      if (existing.advanceCode || existing.movBancoId || String(existing.s || 'A') !== 'A') {
        kept.push(id);
        continue;
      }
      const record: Row = { ...existing, s: 'N', _upd: now, alteradoPor: actor(context.identity) };
      marked++;
      changed.push(record);
      updates['erp/chequesControle/' + id] = clean(record);
    }
    if (changed.length) {
      updates['erp/_ts'] = now;
      await context.db.ref().update(updates);
    }
    return { action: 'import-legacy-cheques', cheques: changed, created, updated, marked, kept };
  });
}
