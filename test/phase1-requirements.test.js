import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const exists=(p)=>fs.existsSync(path.join(root,p));
const modules=['phase1-requirements','phase1-store','phase1-dom','phase1-purchase','phase1-agenda','phase1-alerts','phase1-commercial','phase1-usability','phase1-finance','phase1-operations','phase1-fiscal-admin'];

test('bootstrap carrega os módulos da Fase 1 depois do legado e da Prioridade 1',()=>{
  const bootstrap=read('public/app/bootstrap.js');
  const core=bootstrap.indexOf("await loadClassic('/legacy/app-core.js')");
  const weighing=bootstrap.indexOf("await loadClassic('/modules/weighing/road-weighing-flow.js')");
  let last=weighing;
  for(const name of modules){
    const file=`public/modules/phase1/${name}.js`;
    assert.equal(exists(file),true,file);
    const pos=bootstrap.indexOf(`await loadClassic('/modules/phase1/${name}.js')`);
    assert.ok(pos>last,`${name} deve carregar em ordem`);
    last=pos;
  }
  assert.ok(core>=0&&weighing>core);
  assert.match(bootstrap,/window\.__PHASE1_READY__ = true/);
});

test('manifesto implementa requisitos fechados e mantém apenas definições abertas fora da implementação',()=>{
  const context={window:{}};context.window.window=context.window;vm.createContext(context);
  vm.runInContext(read('public/modules/phase1/phase1-requirements.js'),context);
  const req=context.window.Phase1Requirements;
  for(const id of ['BAL-01','BAL-07','COM-01','COM-08','AGE-01','AGE-03','VEN-01','VEN-07','GER-01','GER-09','FIN-01','RN-02','RN-06','RH-01','RH-03','FRO-01','VIA-01','FIS-01','ADM-01','ADM-06'])assert.ok(req.implemented.includes(id),id);
  assert.deepEqual(Array.from(req.openDefinitions,x=>x.id),['AD-01','AD-03']);
  assert.deepEqual(Array.from(req.blockedByOpenDefinitions,x=>x.id),['RN-07']);
  assert.deepEqual(Array.from(req.outOfScope,x=>x.id),['FIS-03']);
  assert.equal(req.implemented.includes('FIS-02'),true);
  assert.equal(req.implemented.includes('RN-07'),false);
  assert.equal(req.implemented.includes('FIS-03'),false);
});

test('Compra de Sucata contém observação por item, peso bruto/líquido, desconto, extras, PDF e regra de material único',()=>{
  const s=read('public/modules/phase1/phase1-purchase.js');
  for(const token of ['phase1-purchase-item-obs','Peso Bruto','descontoCompra','acrescimos','phase1PurchasePrint','phase1PurchaseSharePdf','Peso bruto total','Peso líquido total'])assert.match(s,new RegExp(token));
  assert.match(s,/global\._matEfetivoEstoque=function\(base\)\{return normalizeMaterial\(base\);\}/);
  assert.match(s,/data-tab="canhoto_compra"/);
});

test('Agenda usa fluxo simples, cadastro rápido e template homologado do WhatsApp',()=>{
  const s=read('public/modules/phase1/phase1-agenda.js');
  for(const token of ['agd-novo-servico','agd-novo-pagamento','agd-novo-status','Cadastro rápido','Mais campos'])assert.match(s,new RegExp(token));
  assert.match(s,/Oi \$\{a\.nome\}, tudo bem\?/);
  assert.match(s,/PODENDO HAVER ATRASOS DEVIDO A DEMANDA\./);
  assert.match(s,/Obrigada    🤝/);
});

test('Comercial remove identificação operacional, registra adiantamento e simplifica Ficha Financeira',()=>{
  const s=read('public/modules/phase1/phase1-commercial.js');
  assert.match(s,/phase1-v-advance/);
  assert.match(s,/Adiantamento pago no fechamento da venda/);
  assert.match(s,/saldoAposAdiantamento/);
  assert.match(s,/fcQuitarSaldo\|fcSaldoAnteriorModal\|fcJuntarAbrir/);
  assert.match(s,/phase1FichaPdf/);
  assert.match(s,/phase1FichaShare/);
  assert.match(s,/phase1-client-ficha/);
});

test('Usabilidade cobre calendário, buscas estáveis, navegação por teclado, ativos e dados bancários múltiplos',()=>{
  const s=read('public/modules/phase1/phase1-usability.js');
  for(const token of ['Calendário','phase1-calendar-de','phase1-calendar-ate','phase1-annual-calendar','ArrowDown','ArrowUp','activeEmployees','partyBanks','phase1-selected-row','formatMoneyInput'])assert.match(s,new RegExp(token));
  assert.match(s,/toLocaleString\('pt-BR'.*minimumFractionDigits:2/);
  assert.match(s,/input\.type='text'/);
  assert.match(s,/FORN_DELETED/);
});

test('Financeiro contém contas fixas, simplificação aprovada, filtros e aviso não bloqueante de cheques',()=>{
  const s=read('public/modules/phase1/phase1-finance.js');
  for(const token of ['Contas a Pagar Fixas','fixedPayables','phase1-adt-bank','phase1-cheq-bank','phase1-cheq-client','Possível numeração|possível numeração','duplicad','zerarSaldosBancos','depositar.*lote'])assert.match(s,new RegExp(token,'i'));
});

test('RH/Frota/Viagem contém EPI x Almoxarifado, edição, competência e gastos extras',()=>{
  const s=read('public/modules/phase1/phase1-operations.js');
  for(const token of ['type=\'month\'','phase1EpiEdit','Baixa automática por entrega de EPI','phase1-maint-search','vg-gastos-extras','acertoDevolucao'])assert.match(s,new RegExp(token));
});

test('Fiscal/Admin mantém base independente e a Fase 2 fecha FIS-02 após autorização da contratante',()=>{
  const s=read('public/modules/phase1/phase1-fiscal-admin.js');
  assert.match(s,/fiscalParties/);
  assert.match(s,/campos fiscais adicionais não foram inferidos/i);
  assert.match(s,/phase1DocNewCategory/);
  for(const token of ['tab-contratos','tab-lista_compras','tab-custo_casa','tab-despesas_grupo','phase1-coord-month'])assert.match(s,new RegExp(token));
});

test('novos dados estruturais usam repositório Firebase e trilha de auditoria',()=>{
  const s=read('public/modules/phase1/phase1-store.js');
  assert.match(s,/__businessRepository/);
  assert.match(s,/\.upsert\(/);
  assert.match(s,/\.remove\(/);
  assert.match(s,/erpAudit/);
  assert.doesNotMatch(s,/localStorage\.setItem/);
});
