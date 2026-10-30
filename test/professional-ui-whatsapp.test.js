import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const root=new URL('../public/',import.meta.url);
const html=readFileSync(new URL('index.template.html',root),'utf8');
const app=readFileSync(new URL('legacy/app-core.js',root),'utf8');
const bootstrap=readFileSync(new URL('app/bootstrap.js',root),'utf8');
const styles=readFileSync(new URL('legacy/professional-ui.css',root),'utf8');
const whatsapp=readFileSync(new URL('legacy/whatsapp-format.js',root),'utf8');

function formatter(){
  const context={window:{}};
  runInNewContext(whatsapp,context);
  return context.window.erpWhatsFormat;
}

test('WhatsApp mantém acentos e valores sem pictogramas ou linhas decorativas',()=>{
  const text=formatter()('🏦 *DADOS BANCÁRIOS*\r\n━━━━━━━━━━━━\r\n👤 Titular: José Çação\r\n⚡ PIX: joao@example.com\r\n💰 Valor: R$ 1.234,56');
  assert.match(text,/José Çação/);
  assert.match(text,/R\$ 1\.234,56/);
  assert.match(text,/PIX: joao@example\.com/);
  assert.doesNotMatch(text,/[🏦👤⚡💰━]/u);
  assert.equal(decodeURIComponent(encodeURIComponent(text)),text);
});

test('lista de compras usa seções profissionais, preserva quantidade e responsável',()=>{
  const source=app.slice(app.indexOf('function _lcTexto(){'),app.indexOf('function lcWhats(){'));
  assert.match(source,/\*LISTA DE COMPRAS\*/);
  assert.match(source,/Quantidade:/);
  assert.match(source,/Solicitante:/);
  assert.match(source,/Status:/);
  assert.doesNotMatch(source,/🛒|✅|📱/u);
});

test('interface mantém painel financeiro e elimina apenas o acesso visual ao suporte',()=>{
  assert.doesNotMatch(html,/id="tab-suporte_tecnico"/);
  assert.doesNotMatch(app,/'config','suporte_tecnico','senhas'/);
  assert.match(app,/if\(tid==='suporte_tecnico'\) tid='dashboard'/);
  assert.match(html,/id="tab-cheques_compensar"/);
  assert.match(html,/id="tab-fiscal"/);
  assert.match(html,/id="tab-despesas_grupo"/);
  assert.match(html,/href="\/legacy\/professional-ui\.css"/);
  assert.match(styles,/#tab-viagem_motorista/);
  assert.match(styles,/#tab-coordenacao/);
});

test('formatação é carregada antes do núcleo, e URL codifica uma vez',()=>{
  assert.ok(bootstrap.indexOf("loadClassic('/legacy/whatsapp-format.js')")<bootstrap.indexOf("loadClassic('/legacy/app-core.js')"));
  assert.match(app,/encodeURIComponent\(_erpWhatsFormat\(msg\)\)/);
  assert.doesNotMatch(app,/decodeURIComponent\(_erpWhatsFormat/);
});
