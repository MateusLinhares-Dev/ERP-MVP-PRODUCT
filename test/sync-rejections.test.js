import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const plain = (value) => JSON.parse(JSON.stringify(value));
const sync = readFileSync(new URL('../public/legacy/firebase-sync.js', import.meta.url), 'utf8');
const telemetry = readFileSync(new URL('../server/modules/audit/application/client-telemetry.ts', import.meta.url), 'utf8');

function fn(name) {
  const start = sync.search(new RegExp('(async )?function ' + name + '\\('));
  assert.ok(start > 0, name);
  const rest = sync.slice(start + 10);
  const end = rest.search(/\n {2}(async )?function |\n {2}const |\n {2}let /);
  return sync.slice(start, start + 10 + end);
}

function isolator(rejectWhen) {
  const sent = [];
  const scope = {
    calls: 0,
    marked: {},
    async _enviarMapaErp(part) {
      scope.calls++;
      if (Object.keys(part).some(rejectWhen)) {
        const error = new Error('PERMISSION_DENIED: Permission denied');
        error.code = 'PERMISSION_DENIED';
        throw error;
      }
      sent.push(...Object.keys(part));
    },
    _fbMarcarEnviado(part) {
      Object.keys(part).forEach((key) => (scope.marked[key] = true));
    },
  };
  runInNewContext(fn('_fbErroDeRegra') + '\n' + fn('_fbEnviarIsolando') + '\nthis.isolate=_fbEnviarIsolando;', scope);
  return { scope, sent };
}

test('chave com . # $ [ ] (nome de cliente antigo, por exemplo) sai do lote antes do envio', () => {
  const scope = {};
  runInNewContext(fn('_fbChaveInvalida') + '\n' + fn('_fbSepararChavesInvalidas') + '\nthis.split=_fbSepararChavesInvalidas;', scope);
  const { validos, invalidas } = scope.split({ 'chequesCli/J.B. SUCATAS': [1], 'chequesCli/TUPY': [2], 'tickets/T1': null, _ts: 1, _user: 'ana' });
  assert.deepEqual(plain(Object.keys(validos).sort()), ['_ts', '_user', 'chequesCli/TUPY', 'tickets/T1']);
  assert.deepEqual(plain(invalidas.map((item) => [item.chave, item.motivo])), [['chequesCli/J.B. SUCATAS', 'INVALID_KEY']]);
});

test('lote recusado: separa por nó e ao meio, grava o resto e devolve só o item recusado', async () => {
  const lote = { _ts: 9, _user: 'ana', 'afazeres/A1': { t: 1 }, 'afazeres/A2': { t: 2 }, 'tickets/T999': null, 'tickets/T1': { a: 1 }, 'vales/V1': { v: 1 } };
  const { scope, sent } = isolator((key) => key === 'tickets/T999');
  const result = await scope.isolate(lote, { restante: 200 });
  assert.deepEqual(plain(result.rejeitadas.map((item) => [item.chave, item.valor, item.motivo])), [['tickets/T999', null, 'PERMISSION_DENIED']]);
  assert.deepEqual(plain(result.pendentes), []);
  assert.deepEqual(sent.sort(), ['afazeres/A1', 'afazeres/A2', 'tickets/T1', 'vales/V1']);
  assert.equal(scope.marked['tickets/T999'], undefined);
  assert.equal(sent.includes('_ts') || sent.includes('_user'), false, '_ts vai por último, separado');
  assert.ok(scope.calls <= 6, String(scope.calls));
});

test('limite de tentativas: o que não deu para testar fica pendente para a próxima gravação', async () => {
  const lote = {};
  for (let i = 0; i < 50; i++) lote['vendas/V' + i] = { i };
  const { scope } = isolator((key) => key.startsWith('vendas/'));
  const result = await scope.isolate(lote, { restante: 10 });
  assert.equal(scope.calls, 10);
  assert.equal(result.rejeitadas.length + result.pendentes.length, 50);
  assert.ok(result.pendentes.length > 0);
});

test('erro de rede não é tratado como recusa de regra', async () => {
  const scope = {
    async _enviarMapaErp() {
      throw new Error('Tempo esgotado aguardando o Firebase');
    },
    _fbMarcarEnviado() {},
  };
  runInNewContext(fn('_fbErroDeRegra') + '\n' + fn('_fbEnviarIsolando') + '\nthis.isolate=_fbEnviarIsolando;', scope);
  await assert.rejects(scope.isolate({ 'a/1': 1, 'a/2': 2 }, { restante: 10 }), /Tempo esgotado/);
});

test('sessão sem permissão não vira quarentena; desfazer do _ts recusado não recarrega a tela', () => {
  assert.match(sync, /if\(!\(await _fbSessaoGrava\(meta\)\)\) throw e;/);
  assert.match(sync, /if\(sessaoOk===null\) sessaoOk=await _fbSessaoGrava\(meta\);\n\s*if\(!sessaoOk\) throw e;/);
  assert.match(sync, /window\._fbTsAntesDoEnvio = window\._fbUltimoTs;\n\s*window\._fbUltimoTs = dados\._ts;/);
  assert.match(sync, /if\(window\._fbTsAntesDoEnvio != null && ts === window\._fbTsAntesDoEnvio\)\{ window\._fbUltimoTs = ts; return; \}/);
  assert.match(sync, /_FB_REJEICAO_VALIDADE=\{dado:12\*3600\*1000,ausente:30\*24\*3600\*1000\}/);
});

test('recusa vai para Engenharia (nó e id, sem valores) e o servidor aceita o tipo', () => {
  const report = fn('_fbReportarRejeicao');
  assert.match(report, /kind:'sync_rejected',module:partes\[0\]/);
  assert.doesNotMatch(report, /item\.valor/);
  assert.match(telemetry, /'sync_rejected'/);
});
