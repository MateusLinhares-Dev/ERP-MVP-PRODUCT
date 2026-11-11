import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { auditEvents, eventIdentification, logsCsv, logsHint, logsQuery } from '../web/modules/engineering/domain/audit-logs.ts';
import { articleToForm, filterEditorArticles, formToPayload } from '../web/modules/engineering/domain/help-editor.ts';

test('logs: filtros viram consulta paginada; datas viram milissegundos', () => {
  const query = new URLSearchParams(logsQuery({ module: 'fiscal', level: '', from: '2026-11-10T08:00', actor: 'elaine' }, 'c1'));
  assert.equal(query.get('limit'), '50');
  assert.equal(query.get('cursor'), 'c1');
  assert.equal(query.get('module'), 'fiscal');
  assert.equal(query.has('level'), false);
  assert.equal(query.get('from'), String(new Date('2026-11-10T08:00').getTime()));
  assert.deepEqual(auditEvents({ events: [{ ts: 1 }], nextCursor: '' }), { events: [{ ts: 1 }], nextCursor: null, scanned: 0 });
  assert.deepEqual(auditEvents({ events: [], nextCursor: 'k9', scanned: '600' }), { events: [], nextCursor: 'k9', scanned: 600 });
  assert.match(logsHint(0, 6000, true), /Próxima para continuar/);
  assert.match(logsHint(3, 900, false), /^3 evento\(s\) exibido\(s\) · 900 registro/);
  assert.equal(eventIdentification({ entityType: 'ticket', entityId: 'T1', code: '' }), 'ticket / T1');
});

test('logs: CSV protege contra fórmula e tem BOM para o Excel', () => {
  const csv = logsCsv([{ ts: 1, level: 'error', module: '=cmd', action: 'x"y', actorLogin: 'a', source: 's' }]);
  assert.ok(csv.startsWith('﻿ts;level;module'));
  assert.match(csv, /"'=cmd"/);
  assert.match(csv, /"x""y"/);
});

test('editor da ajuda: passos um por linha, rascunho por padrão e busca simples', () => {
  const form = articleToForm(undefined, 'compras');
  assert.equal(form.status, 'draft');
  assert.deepEqual(formToPayload({ ...form, title: 'T', steps: ' Um \n\n Dois ' }).steps, ['Um', 'Dois']);
  const loaded = articleToForm({ id: 'a', title: 'Baixa', summary: 's', category: 'financeiro', steps: ['A', 'B'], status: 'published' }, 'compras');
  assert.equal(loaded.steps, 'A\nB');
  assert.equal(loaded.status, 'published');
  assert.equal(filterEditorArticles([{ id: '1', title: 'Baixa parcial', summary: '', category: 'financeiro' }], 'BAIXA').length, 1);
});

test('engenharia virou ilha React; menu só para a conta técnica', () => {
  const islands = readFileSync(new URL('../web/erp/islands.tsx', import.meta.url), 'utf8');
  assert.match(islands, /claims\.engineer === true && claims\.erpUser === ENGINEER_LOGIN/);
  assert.match(islands, /erpIsEngineer\?\.\(\) === true/);
  assert.match(islands, /installErrorTelemetry\(erpSessionUser\)/);
  assert.equal(existsSync(new URL('../public/modules/engineering/engineering.js', import.meta.url)), false);
});
