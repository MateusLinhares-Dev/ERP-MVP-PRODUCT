import test from 'node:test';
import assert from 'node:assert/strict';
import { queryAuditLog } from '../server/modules/audit/application/audit-log.ts';

function auditDb(rows) {
  const keys = Object.keys(rows).sort();
  const reads = [];
  return {
    reads,
    ref() {
      const q = { end: null, last: Infinity };
      const api = {
        orderByKey: () => api,
        endAt: (key) => ((q.end = key), api),
        limitToLast: (n) => ((q.last = n), api),
        async get() {
          reads.push({ ...q });
          const eligible = keys.filter((k) => q.end === null || k <= q.end);
          const picked = eligible.slice(Math.max(0, eligible.length - q.last));
          return { val: () => Object.fromEntries(picked.map((k) => [k, rows[k]])) };
        },
      };
      return api;
    },
  };
}
const key = (n) => 'K' + String(n).padStart(6, '0');

test('filtro por módulo acha eventos antigos escondidos atrás de muitos eventos novos', async () => {
  const rows = {};
  for (let i = 0; i < 50; i++) rows[key(i)] = { module: 'phase1', action: 'upsert', actorLogin: 'elaine', ts: 1000 + i, source: 'browser' };
  for (let i = 50; i < 550; i++) rows[key(i)] = { module: 'auth', action: 'login', actorLogin: 'elaine', ts: 1000 + i, source: 'server' };
  const db = auditDb(rows);
  const result = await queryAuditLog(db, { module: 'PHASE1', limit: '50' });
  assert.equal(result.events.length, 50, 'antes: 0 eventos (só olhava os 150 mais recentes)');
  assert.ok(result.events.every((event) => event.module === 'phase1'));
  assert.equal(result.nextCursor, null, 'chegou ao começo do histórico');
  assert.equal(result.scanned, 550);
});

test('página sem filtro continua igual: 50 mais recentes, ordenados por horário, com cursor para a próxima', async () => {
  const rows = {};
  for (let i = 0; i < 120; i++) rows[key(i)] = { module: 'phase1', action: 'upsert', ts: i % 2 ? 5000 - i : 9000 - i };
  const db = auditDb(rows);
  const first = await queryAuditLog(db, { limit: '50' });
  assert.equal(first.events.length, 50);
  assert.equal(first.nextCursor, key(70));
  const times = first.events.map((event) => Number(event.ts));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'página ordenada pelo horário do evento');
  const second = await queryAuditLog(db, { limit: '50', cursor: first.nextCursor });
  assert.equal(second.events.length, 50);
  assert.ok(second.events.every((event) => event.id < key(70)), 'sem repetir eventos da página anterior');
  const third = await queryAuditLog(db, { limit: '50', cursor: second.nextCursor });
  assert.equal(third.events.length, 20);
  assert.equal(third.nextCursor, null);
});

test('busca tem limite de segurança e devolve cursor para continuar', async () => {
  const rows = {};
  for (let i = 0; i < 7000; i++) rows[key(i)] = { module: 'auth', action: 'login', ts: i };
  const db = auditDb(rows);
  const result = await queryAuditLog(db, { module: 'fiscal' });
  assert.equal(result.events.length, 0);
  assert.equal(result.scanned, 6000);
  assert.equal(result.nextCursor, key(1000), 'o próximo clique continua de onde parou');
  assert.ok(db.reads.length <= 21);
});

test('filtros de nível, usuário, termo e período', async () => {
  const rows = {
    [key(1)]: { module: 'fiscal', action: 'import', actorLogin: 'thais', outcome: 'failed', ts: 100, entityId: 'NF-77' },
    [key(2)]: { module: 'fiscal', action: 'import', actorLogin: 'elaine', ts: 200 },
    [key(3)]: { module: 'compras', action: 'save', actorLogin: 'thais', ts: 300 },
  };
  const db = auditDb(rows);
  assert.deepEqual((await queryAuditLog(db, { level: 'error' })).events.map((e) => e.id), [key(1)]);
  assert.deepEqual((await queryAuditLog(db, { actor: 'THAIS' })).events.map((e) => e.id), [key(3), key(1)]);
  assert.deepEqual((await queryAuditLog(db, { term: 'nf-77' })).events.map((e) => e.id), [key(1)]);
  assert.deepEqual((await queryAuditLog(db, { from: '150', to: '250' })).events.map((e) => e.id), [key(2)]);
});
