import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const template=readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../public/modules/phase2/phase2-feedback.js',import.meta.url),'utf8');
const uiCss=readFileSync(new URL('../public/legacy/professional-ui.css',import.meta.url),'utf8');
const between=(source,start,end)=>source.split(start)[1]?.split(end)[0]||'';

test('viagens: as três visualizações têm navegação própria sem substituir elementos do formulário',()=>{
  const code=between(workspace,'function workspaceTrip(){','function workspacePoint(){');
  assert.match(code,/key:'history',label:'Viagens'/);
  assert.match(code,/key:'register',label:'Nova viagem'/);
  assert.match(code,/key:'cost',label:'Custos e limites'/);
  assert.match(code,/views\.history\.panel\.appendChild\(history\)/);
  assert.match(code,/views\.register\.panel\.appendChild\(register\)/);
  assert.match(code,/views\.cost\.panel\.appendChild\(kpis\)/);
  assert.match(code,/views\.cost\.panel\.appendChild\(cost\)/);
  assert.match(code,/views\.cost\.panel\.appendChild\(limit\)/);
  for(const field of ['vg-motorista','vg-data','vg-volta','vg-destino','vg-diaria','vg-pernoite','vg-obs','vg-comb','vg-dinheiro-alim','vg-limite-alim','vg-fil-mot','vg-fil-mes','tb-viagens']){
    assert.match(template,new RegExp(`id="${field}"`),field);
  }
});

test('viagens: campos financeiros são movidos e não recriados; refeições seguem opcionais',()=>{
  const code=between(workspace,'function workspaceTripExpenses(){','function workspaceTrip(){');
  assert.match(code,/details\.className='erp-trip-expenses'/);
  assert.match(code,/\['vg-comb','vg-dinheiro-alim'\]/);
  assert.match(code,/fields\.appendChild\(el\.parentElement\)/);
  assert.match(code,/fields\.appendChild\(extra\)/);
  assert.match(code,/fields\.appendChild\(change\)/);
  assert.match(uiCss,/#tab-viagem_motorista \.phase2-trip-meals/);
});

test('ponto: cada visão preserva tabela, importação RH iD e funções legadas',()=>{
  const code=between(workspace,'function workspacePoint(){','/* ---------- Aplicação recorrente ---------- */');
  assert.match(code,/key:'manual',label:'Lançamentos'/);
  assert.match(code,/key:'imported',label:'Cartões importados'/);
  assert.match(code,/views\.manual\.panel\.appendChild\(manual\)/);
  assert.match(code,/views\.imported\.panel\.appendChild\(imported\)/);
  assert.match(code,/scroll\.appendChild\(manualTable\)/);
  assert.match(template,/id="ponto-rhid-input"[^>]*onchange="importarCartaoPontoRHiD\(this\)"/);
  assert.match(template,/id="ponto-cartao-func" onchange="renderCartaoPontoImportado\(\)"/);
  assert.match(template,/id="tb-ponto"/);
});

test('navegação é idempotente, permite teclado e esconde painéis inativos',()=>{
  const code=between(workspace,'function workspaceCreate(','function workspaceTripExpenses(){');
  assert.match(code,/tab\.querySelector\('\.erp-workspace-nav'\)/);
  assert.match(code,/button\.setAttribute\('role','tab'\)/);
  assert.match(code,/panel\.setAttribute\('role','tabpanel'\)/);
  assert.match(code,/ev\.key==='ArrowLeft'/);
  assert.match(code,/ev\.key!=='ArrowRight'/);
  assert.match(code,/panel\.hidden=!on/);
  assert.match(uiCss,/\.erp-workspace-panel\[hidden\]\{display:none!important\}/);
});

test('menu lateral mantém os ícones e separa cabeçalhos dos módulos',()=>{
  assert.match(uiCss,/#app-screen \.sidebar \.sb-group:not\(\.sb-standalone\)/);
  assert.match(uiCss,/#app-screen \.sidebar \.sb-group\.open:not\(\.sb-standalone\) \.sb-group-hdr/);
  assert.match(uiCss,/#app-screen \.sidebar \.sb-group:not\(\.sb-standalone\) \.nav-tab\.active/);
  assert.match(uiCss,/#app-screen \.sidebar :is\(\.nt-icon,\.sb-gicon\) svg/);
});
