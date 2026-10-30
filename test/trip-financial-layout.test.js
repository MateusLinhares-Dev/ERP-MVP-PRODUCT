import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync(new URL('../public/modules/phase2/phase2-feedback.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/modules/phase2/phase2-feedback.css',import.meta.url),'utf8');
const fragment=js.split('function phase2TripFullFinancialDetail(v,parts,advance,settlement){')[1]?.split('function phase2TripShowSelected(host){')[0];
assert.ok(fragment,'função de detalhe não encontrada');
const sandbox={
  phase2TripCostValue:value=>Number(value)||0,
  phase2TripDate:value=>String(value||''),
  money:value=>Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),
  esc:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  $:()=>({value:'120'})
};
vm.createContext(sandbox);
vm.runInContext(`this.render=function phase2TripFullFinancialDetail(v,parts,advance,settlement){${fragment}`,sandbox);

test('detalhe financeiro mostra rótulo e valor juntos sem herdar grid global de table',()=>{
 const html=sandbox.render({numDiarias:3,diaria:80,pernoite:40,refeicoesPorDia:[{data:'2026-10-21',cafeManha:20,almoco:40,cafeTarde:20,janta:40}]},{diarias:240,alimentacao:240,combustivel:0,extras:120},300,-60);
 assert.equal((html.match(/class="phase2-trip-financial-group"/g)||[]).length,3);
 assert.equal((html.match(/class="phase2-trip-financial-row"/g)||[]).length,16);
 assert.match(html,/<dt>Combustível<\/dt><dd>R\$ 0,00<\/dd>/);
 assert.match(html,/<dt>Acerto financeiro<\/dt><dd>Reembolsar R\$ 60,00<\/dd>/);
 assert.doesNotMatch(html,/<th scope="row">/);
 assert.match(html,/phase2-trip-financial-scroll/);
 assert.match(css,/phase2-trip-financial-row\{display:grid/);
 assert.match(css,/phase2-trip-financial-grid\{display:grid/);
});
test('texto longo não injeta HTML nem precisa alargar a página',()=>{
 const html=sandbox.render({numDiarias:2,refeicoesPorDia:[]},{diarias:0,alimentacao:0,combustivel:0,extras:0},0,0);
 assert.match(html,/class="phase2-trip-financial-row"/);
 assert.match(css,/phase2-trip-financial-row dt\{[^}]*overflow-wrap:anywhere/);
 assert.match(css,/phase2-trip-financial-row dd\{[^}]*overflow-wrap:anywhere/);
 assert.match(css,/phase2-trip-full-financial\{[^}]*max-width:100%/);
});
