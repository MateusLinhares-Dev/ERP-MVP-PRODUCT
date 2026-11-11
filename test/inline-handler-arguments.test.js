import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const slice = (name) => {
  const start = core.indexOf('function ' + name + '(');
  return core.slice(start, core.indexOf('\n', start));
};

test('_jsArg: nome com apóstrofo, aspas e barra chega inteiro na função do botão', () => {
  const ctx = {};
  runInNewContext(slice('_jsArg') + slice('esc') + ';this.arg=_jsArg;', ctx);
  const nomes = ["JOÃO D'ÁVILA", 'SANT"ANNA', 'A\\B <b>', '', null];
  for (const nome of nomes) {
    const attribute = 'abrir(' + ctx.arg(nome) + ')';
    const decoded = attribute.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const received = [];
    runInNewContext(decoded, { abrir: (value) => received.push(value) });
    assert.deepEqual(received, [String(nome ?? '')]);
  }
});

test('nenhum onclick/onchange/oninput monta texto com esc() entre aspas simples', () => {
  const offending = core.split('\n').filter((line) => /on(click|change|input)=/.test(line) && (/'\$\{esc\(/.test(line) || /\\''\+esc\(/.test(line)));
  assert.deepEqual(offending, []);
});
