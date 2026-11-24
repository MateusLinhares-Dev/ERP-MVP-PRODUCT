import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/legacy/whatsapp-format.js', import.meta.url), 'utf8');

function load(mode) {
  const opened = [];
  const store = new Map(mode ? [['erp_whatsapp_modo', mode]] : []);
  const window = {
    open: (url, target) => { opened.push([url, target]); return {}; },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    document: { dispatchEvent() {} },
  };
  runInNewContext(source, { window, URL, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, encodeURIComponent });
  return { window, opened };
}

test('WhatsApp Web: links wa.me abrem web.whatsapp.com na mesma aba; no modo aplicativo nada muda', () => {
  const web = load('web');
  web.window.open('https://wa.me/5547999990000?text=' + encodeURIComponent('Olá, Mari!\nLembrete'), '_blank');
  web.window.open('https://wa.me/?text=' + encodeURIComponent('Tabela de preços'), '_blank');
  web.window.open('https://example.com/relatorio.pdf', '_blank');
  assert.deepEqual(web.opened, [
    ['https://web.whatsapp.com/send?phone=5547999990000&text=' + encodeURIComponent('Olá, Mari!\nLembrete'), 'erp_whatsapp_web'],
    ['https://web.whatsapp.com/send?text=' + encodeURIComponent('Tabela de preços'), 'erp_whatsapp_web'],
    ['https://example.com/relatorio.pdf', '_blank'],
  ]);
  const app = load(null);
  app.window.open('https://wa.me/5547999990000?text=oi', '_blank');
  assert.deepEqual(app.opened, [['https://wa.me/5547999990000?text=oi', '_blank']]);
  assert.equal(app.window.erpWhatsappMode(), 'app');
  assert.equal(app.window.erpSetWhatsappMode('web'), 'web');
  app.window.open('https://api.whatsapp.com/send?phone=5547888&text=ola', '_blank');
  assert.deepEqual(app.opened[1], ['https://web.whatsapp.com/send?phone=5547888&text=ola', 'erp_whatsapp_web']);
});
