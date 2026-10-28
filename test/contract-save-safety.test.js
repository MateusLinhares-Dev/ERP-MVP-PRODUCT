import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const src=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const begin=src.indexOf('let _contratoSalvamentoEmAndamento=false;');
const end=src.indexOf('function renderContratos(){',begin);
assert.ok(begin>0 && end>begin,'Salvamento de contratos encontrado');
const unit=src.slice(begin,end);

function setup({update, file=null, input={}}={}){
  const values={
    'ct-desc':'Contrato teste','ct-forn':'Fornecedor teste','ct-ini':'2026-10-28','ct-fim':'2026-10-30',
    'ct-valor':'123','ct-debito':'Não','ct-banco':'','ct-obs':'',
    'ct-av-venc':'2026-10-29','ct-nparc':'2','ct-diaparc':'31','ct-mesparc':'2026-10',
    'ct-av-cat':'Outros','ct-parc-cat':'Outros',...input
  };
  const button={dataset:{},disabled:false,textContent:'Salvar'};
  const status={textContent:''};
  const pending=[];const database=[];const toasts=[];let cancelled=false;const uploads=[];
  const ref={put:async v=>{uploads.push(v);},delete:async()=>{}};
  const window={_fbDB:{ref:path=>{assert.equal(path,'erp');return {update:async patch=>{
    pending.push(patch);if(update)await update(patch);
  }};}},__FB_DATA_READY__:true,__fbRaw:{storage:{ref:path=>{database.push(path);return ref;}}},crypto:{randomUUID:()=> '01234567-89ab-4cde-a012-0123456789ab'}};
  const document={
    getElementById:id=>id==='ct-arquivo'?{files:file?[file]:[]}:id==='ct-arquivo-status'?status:({value:values[id]}),
    querySelector:selector=>selector.includes('ct-lanc')?{value:input.lancOpt||'nao'}:button,
  };
  const contracts=[],payables=[];
  const context={window,document,CONTRATOS_DB:contracts,CONTAS_PAGAR:payables,BANCOS_DB:[],
    _hojeISO:()=> '2026-10-28',_novoIdCP:(()=>{let i=0;return()=> 'CP'+(++i);})(),
    saveContratos(){},saveContasPagar(){},renderContratos(){},renderContasPagar(){},renderDashboard(){},renderFluxo(){},
    showToast:(...args)=>toasts.push(args),cm:()=>{cancelled=true;},console:{error(){},warn(){}},
    Date,Number,Math,Promise,
  };
  runInNewContext(unit,context);
  return {save:context.salvarContrato,pending,database,toasts,contracts,payables,button,status,uploads,isClosed:()=>cancelled};
}

test('duplo clique não cria contratos ou parcelas duplicadas',async()=>{
  let release;
  const deferred=new Promise(resolve=>release=resolve);
  const ctx=setup({update:()=>deferred,input:{lancOpt:'parcelado'}});
  const first=ctx.save();const second=ctx.save();
  assert.equal(ctx.pending.length,1);
  release();await Promise.all([first,second]);
  assert.equal(ctx.pending.length,1);
  assert.equal(ctx.contracts.length,1);
  assert.equal(ctx.payables.length,2);
  assert.equal(Object.keys(ctx.pending[0]).length,3,'contrato + duas parcelas em update atômico');
  assert.equal(ctx.toasts.at(-1)?.[1],'success');
});

test('falha remota não adiciona contrato local nem declara sucesso',async()=>{
  const ctx=setup({update:async()=>{throw Error('permission_denied');}});
  await ctx.save();
  assert.equal(ctx.contracts.length,0);
  assert.equal(ctx.payables.length,0);
  assert.equal(ctx.toasts.at(-1)?.[1],'error');
  assert.equal(ctx.isClosed(),false);
  assert.equal(ctx.button.disabled,false);
  assert.ok(ctx.button.dataset.contractPendingId,'mesmo ID preservado caso seja necessário repetir a tentativa');
});

test('documentos novos são enviados ao Storage e não entram como base64 no banco',async()=>{
  const ctx=setup({file:{type:'application/pdf',size:4500,name:'contrato.pdf'}});
  await ctx.save();
  assert.equal(ctx.uploads.length,1);
  assert.match(ctx.database[0],/^erp-files\/contracts\/CT[a-f\d]+\/document\.pdf$/);
  const contract=ctx.pending[0][Object.keys(ctx.pending[0])[0]];
  assert.equal(contract.arquivoBase64,'');
  assert.equal(contract.arquivoStoragePath,ctx.database[0]);
});

test('validação de parcelas falha antes de gravar qualquer registro',async()=>{
  const ctx=setup({input:{lancOpt:'parcelado','ct-nparc':'500'}});
  await ctx.save();
  assert.equal(ctx.pending.length,0);
  assert.equal(ctx.contracts.length,0);
  assert.equal(ctx.toasts[0]?.[1],'error');
});
