import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function read(name){return fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');}
const core=read('public/legacy/app-core.js');
const sync=read('public/legacy/firebase-sync.js');
const boot=read('public/app/bootstrap.js');

function extract(source,start,end){
  const a=source.indexOf(start); assert.ok(a>=0,start);
  const b=source.indexOf(end,a+start.length); assert.ok(b>a,end);
  return source.slice(a,b).trim();
}
function memoryStorage(initial={}){
  const data={...initial};
  return {
    getItem:k=>Object.hasOwn(data,k)?data[k]:null,
    setItem:(k,v)=>{data[k]=String(v)},
    removeItem:k=>{delete data[k]},
    inspect:()=>({...data})
  };
}

test('v28: banco nao nasce da copia antiga nem mistura colecoes de usuarios',()=>{
  const load=extract(core,'function loadBancos(){','// Corrige contas antigas');
  const oldBanks=Array.from({length:30},(_,i)=>({id:`BC_${i}`,cod:`BC-${i}`,banco:`Banco ${i}`}));
  const storage=memoryStorage({mm_bancos:JSON.stringify(oldBanks),mm_lanc_banco:JSON.stringify([{id:'L1'}])});
  const ctx={localStorage:storage,BANCOS_DB:[],LANC_BANCO_DB:[],console};
  vm.runInNewContext(`(${load})()`,ctx);
  assert.equal(ctx.BANCOS_DB.length,0);
  assert.equal(ctx.LANC_BANCO_DB.length,0);
  assert.equal(JSON.parse(storage.getItem('mm_bancos_backup_pre_cloud_v28')).length,30);
  assert.equal(JSON.parse(storage.getItem('mm_lanc_banco_backup_pre_cloud_v28')).length,1);
});

test('v28: bootstrap arquiva caches ANTES de Firebase sobrescrever os valores',()=>{
  assert.ok(boot.indexOf('arquivarCachesAntigosAntesDaNuvem();')<boot.indexOf("fetch('/api/config'"));
  const code=extract(boot,'function arquivarCachesAntigosAntesDaNuvem(){','async function main()');
  const storage=memoryStorage({mm_bancos:JSON.stringify([{id:'A'}]),mm_cr:JSON.stringify([{cli:'ANALISE'}])});
  vm.runInNewContext(`(${code})()`,{localStorage:storage,console});
  storage.setItem('mm_bancos','[]');storage.setItem('mm_cr','[]');
  assert.equal(JSON.parse(storage.getItem('mm_bancos_backup_pre_cloud_v28'))[0].id,'A');
  assert.equal(JSON.parse(storage.getItem('mm_cr_backup_pre_cloud_v28'))[0].cli,'ANALISE');
});

test('v28: IDs estaveis provenientes das chaves do RTDB, sem novas contas a cada F5',()=>{
  const fn=extract(core,'function _normalizarBancosRemotos(remoto){','async function recarregarBancosDoBanco(){');
  const normalizar=vm.runInNewContext(`(${fn})`);
  const cloud={BAN001:{cod:'BAN001',banco:'Santander'},id_b:{id:'BC_X',cod:'BAN002',banco:'Sicredi'}};
  const one=normalizar(cloud),two=normalizar(cloud);
  assert.equal(one.BAN001.id,'BAN001');
  assert.equal(two.BAN001.id,'BAN001');
  assert.equal(one.id_b.id,'BC_X');
  assert.equal(cloud.BAN001.id,undefined,'a normalizacao nao altera o snapshot remoto original');
  assert.match(sync,/_normalizarBancosRemotos\(d\.bancos\)/);
  assert.match(core,/_normalizarBancosRemotos\(remoto\|\|\{\}\)/);
});

test('v28: render bancario é somente leitura e nunca apaga registro ao abrir',()=>{
  const render=extract(core,'function renderBancos(){','// ACHADO (30/07)');
  assert.match(render,/__ERP_BANKS_CLOUD_READY__/);
  assert.doesNotMatch(render,/_syncBancos\.limparDuplicatasExatas\(/);
  assert.doesNotMatch(render,/(?<![A-Za-z])saveBancos\(/);
  assert.doesNotMatch(render,/(?<![A-Za-z])fbSalvar\(/);
  assert.doesNotMatch(render,/(?<![A-Za-z])bancosCorrigeEmpresa\(/);
  assert.match(core,/await window\.__businessRepository\.read\('bancos'\)/);
  assert.match(core,/idsLocal\.size!==idsCloud\.size/);
});

test('v28: snapshots parciais nunca sao tomados como exclusao de bancos',()=>{
  assert.match(sync,/d\._shallowKeys\.includes\('bancos'\) \|\| d\.bancos!=null/);
  assert.match(sync,/snapshot parcial, cadastro remoto não foi carregado/);
  assert.match(sync,/if\(window\.__ERP_BANKS_CLOUD_READY__\)/);
});

test('v28: tela financeira descarta SOMENTE lixo local, mas mantém livro financeiro real',()=>{
  const fn=extract(sync,'function _fcAplicarNuvem(d){','function _fcRedesenharSeAberta(){');
  const ctx={window:{},console,
    ADT_CLI:{'CLIENTE QA 01':[{valor:1200}]}, CHEQUES_CLI:{'CLIENTE QA 01':[{valor:34}]},
    FC_LANC:{'CLIENTE QA 01':[{credito:1}]}, FC_SALDO_INI:{'CLIENTE QA 01':{valor:123}}};
  const apply=vm.runInNewContext(`(${fn})`,ctx);
  const parsed={_shallowKeys:[]};
  assert.equal(apply(parsed),true);
  assert.equal(Object.keys(ctx.ADT_CLI).length,0);
  assert.equal(Object.keys(ctx.CHEQUES_CLI).length,0);
  assert.equal(Object.keys(ctx.FC_LANC).length,0);
  assert.equal(Object.keys(ctx.FC_SALDO_INI).length,0);
  const hist={_shallowKeys:['chequesCli'],chequesCli:{'CLIENTE QA 01':[{valor:12345}]}};
  assert.equal(apply(hist),true);
  assert.equal(ctx.CHEQUES_CLI['CLIENTE QA 01'][0].valor,12345,'historico legitimo do RTDB nao deve ser apagado');
  const partial={_shallowKeys:['chequesCli'],chequesCli:undefined};
  assert.equal(apply(partial),false);
  assert.equal(ctx.CHEQUES_CLI['CLIENTE QA 01'][0].valor,12345,'snapshot incompleto nao pode apagar historico');
  assert.equal(ctx.window.__ERP_FINANCE_CLOUD_READY__,true);
});

test('v28: login nao injeta credito/cheque/CR de outro usuario via localStorage',()=>{
  const load=extract(core,'function loadDB(){','// ══════════════════════════════════════════\n//  HISTÓRICO / AUDITORIA');
  assert.doesNotMatch(load,/Object\.assign\(ADT_CLI, JSON\.parse\(ac\)\)/);
  assert.doesNotMatch(load,/Object\.assign\(CHEQUES_CLI, JSON\.parse\(cc\)\)/);
  assert.doesNotMatch(load,/Object\.assign\(FC_LANC, JSON\.parse\(fcl\)\)/);
  const loadContas=extract(core,'function loadContas(){','function excluirContaReceber(');
  assert.doesNotMatch(loadContas,/CONTAS_RECEBER\.length=0; JSON\.parse\(cr\)/);
  assert.match(core,/function _fcClientesHistoricosSemCadastro/);
  assert.match(core,/⚠️ Histórico sem cadastro: /);
  assert.match(sync,/_fcAplicarNuvem\(d\)/);
  assert.match(sync,/if\(window\.__ERP_FINANCE_CLOUD_READY__\)/);
});

test('v28: tombstones bancarios antigos sao arquivados, nunca executados automaticamente',()=>{
  const src=extract(core,'function _bancosPrepararTombstonesCloud(){','// IDs permanentes:');
  const oldIds=['BAN002','BAN003'];
  const store=memoryStorage({mm_bancos_deletados:JSON.stringify(oldIds),mm_fb_pendente:'1'});
  const deletedSet=new Set(oldIds);
  vm.runInNewContext(`(${src})()`,{window:{},localStorage:store,_syncBancos:{deletedSet},console});
  assert.equal(deletedSet.size,0);
  assert.equal(store.getItem('mm_bancos_deletados'),'[]');
  assert.equal(JSON.parse(store.getItem('mm_bancos_deletados_backup_pre_cloud_v28')).length,2);
  assert.match(sync,/_bancosPrepararTombstonesCloud\(\)/);
});

test('v28: diagnostico não acessa projetos reais nem exclui cadastros',()=>{
  const diag=read('scripts/diagnose-emulator.mjs');
  assert.match(diag,/!project\.startsWith\('demo-'\)/);
  assert.match(diag,/read\('bancos'\)/);
  assert.match(diag,/\['adtCli','chequesCli','fcLanc','fcSaldoIni','contasReceber','vendas','chequesControle'\]/);
  assert.doesNotMatch(diag,/method:\s*['"](?:DELETE|PUT|PATCH|POST)/);
});

test('v28: 30 contas reais permanecem 30 apos duas hidratacoes e uma nova conta vira 31',()=>{
  const create=extract(core,'function _criarSincroniaPorChave(nome, lista, prefixoId){','// Resolve a posição ATUAL');
  const normSrc=extract(core,'function _normalizarBancosRemotos(remoto){','async function recarregarBancosDoBanco(){');
  const ctx={localStorage:memoryStorage(),window:{},console,setTimeout:()=>0};
  const factory=vm.runInNewContext(`(${create})`,ctx);
  const normalize=vm.runInNewContext(`(${normSrc})`,ctx);
  const list=[];const s=factory('bancos',list,'BC');
  const cloud=Object.fromEntries(Array.from({length:30},(_,i)=>[`BAN${i+1}`,{cod:`BAN${i+1}`,banco:`Banco ${i+1}`} ]));
  s.carregarDeRemoto(normalize(cloud),true);
  s.carregarDeRemoto(normalize(cloud),true);
  assert.equal(list.length,30);
  const created={id:'BC_CUSTOM',cod:'BAN31',banco:'Banco novo'};
  list.push(created);cloud[created.id]=created;
  s.carregarDeRemoto(normalize(cloud),true);
  assert.equal(list.length,31);
  s.carregarDeRemoto(normalize(cloud),true);
  assert.equal(list.length,31);
  assert.equal(new Set(list.map(x=>x.id)).size,31);
});

test('v28: RTDB valido vazio libera telas; falha de leitura nao finge lista vazia',()=>{
  assert.match(sync,/if\(!shallow \|\| typeof shallow !== 'object'\)\{ onOk\(null\); return; \}/);
  assert.match(sync,/onOk\(d\);\s*\}catch\(e\)/);
});
