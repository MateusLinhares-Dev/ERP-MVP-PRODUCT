import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function loadPhase1Dom() {
  const frames = [];
  let observer = null;
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.records = [];
      observer = this;
    }
    observe() {}
    takeRecords() {
      const taken = this.records;
      this.records = [];
      return taken;
    }
    deliver() {
      if (!this.records.length) return;
      const pending = this.takeRecords();
      this.callback(pending);
    }
  }
  const window = {};
  runInNewContext(read('public/modules/phase1/phase1-dom.js'), {
    window,
    document: { documentElement: {} },
    MutationObserver: FakeObserver,
    requestAnimationFrame: (fn) => frames.push(fn),
    console,
  });
  return { api: window.Phase1Dom, frames, observer: () => observer };
}

test('melhorador que sempre altera a página não cria ciclo infinito (no máximo 2 rodadas por mudança)', () => {
  const { api, frames, observer } = loadPhase1Dom();
  let calls = 0;
  api.register(() => {
    calls += 1;
    observer().records.push({ type: 'childList' });
  });
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(calls, 2, 'roda de novo uma vez para quem depende do que outro criou');
  observer().deliver();
  assert.equal(frames.length, 0, 'as alterações feitas pelos próprios melhoradores não agendam outra rodada');
  observer().records.push({ type: 'childList' });
  observer().deliver();
  assert.equal(frames.length, 1, 'uma mudança de fora agenda uma nova rodada');
});

test('melhorador que não altera nada roda uma vez só', () => {
  const { api, frames } = loadPhase1Dom();
  let calls = 0;
  api.register(() => {
    calls += 1;
  });
  frames.shift()();
  assert.equal(calls, 1);
});

test('painel de Cadastros Fiscais não relê o Firebase a cada rodada da tela', () => {
  const source = read('public/modules/phase2/phase2-feedback.js');
  assert.match(source, /if\(old\.dataset\.phase2==='1'&&old\.querySelector\('#p2fis-list'\)\)return;/);
  assert.doesNotMatch(source, /if\(old\.dataset\.phase2==='1'\)\{loadFiscalParties\(\);return;\}/);
});

test('melhoradores não brigam entre si (calendário e aviso da Casa Glória)', () => {
  const usability = read('public/modules/phase1/phase1-usability.js');
  assert.match(usability, /document\.getElementById\('phase2-calendar-tools'\)\)return;/);
  const feedback = read('public/modules/phase2/phase2-feedback.js');
  assert.doesNotMatch(feedback, /Casa e Casa Glória foram consolidadas em Casa/);
});
