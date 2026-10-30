import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const code=readFileSync(new URL('../public/modules/phase2/phase2-feedback.js',import.meta.url),'utf8');
const start=code.indexOf('function phase2ContractAt(index){');
const end=code.indexOf('function mergeCasaGloria(){',start);
assert.ok(start>0&&end>start,'Implementação da renomeação encontrada');
const unit=code.slice(start,end);

function setup({fail=false, connected=true, initialName='aluguel.pdf'}={}){
  const contract={id:'CT99',arquivoBase64:'data:application/pdf;base64,UEZERg==',arquivoMime:'application/pdf',arquivoNome:initialName};
  const saved=[],toasts=[],cache=[];
  let download;
  const link={click(){download={name:this.download,url:this.href};},remove(){}};
  const global={prompt(){return 'aluguel outubro';},renderContratos(){},_fbDB:connected?{
    ref(path){return {async once(){return {val(){return 'CT99';}};},async update(value){if(fail)throw new Error('permission_denied');saved.push({path,value});}};}
  }:undefined};
  const context={
    global,CONTRATOS_DB:[contract],notify:(...args)=>toasts.push(args),
    localStorage:{setItem:(key,value)=>cache.push({key,value})},
    renderContratos(){},
    document:{body:{appendChild(){}},querySelector(){return null;},createElement(tag){assert.equal(tag,'a');return link;}},
    Blob, Uint8Array, atob, URL:{createObjectURL:()=> 'blob:fake',revokeObjectURL(){}},
    setTimeout(){}, console:{error(){},warn(){}},
  };
  runInNewContext(unit,context);
  return {global,contract,saved,toasts,cache,getDownload:()=>download};
}

test('renomeia somente o metadado do arquivo no Firebase, preservando o PDF e a extensão',async()=>{
  const t=setup();
  assert.equal(await t.global.phase2ContractRename(0),true);
  assert.equal(t.contract.arquivoNome,'aluguel outubro.pdf');
  assert.equal(t.contract.arquivoBase64,'data:application/pdf;base64,UEZERg==');
  assert.equal(t.saved.length,1);
  assert.equal(t.saved[0].path,'erp/contratos/CT99');
  assert.equal(t.saved[0].value.arquivoNome,'aluguel outubro.pdf');
  assert.equal(t.toasts[0][1],'success');
  assert.equal(JSON.parse(t.cache[0].value)[0].arquivoNome,'aluguel outubro.pdf');
});

test('ao falhar a escrita RTDB, não muda nome local e não mostra sucesso',async()=>{
  const t=setup({fail:true});
  assert.equal(await t.global.phase2ContractRename(0),false);
  assert.equal(t.contract.arquivoNome,'aluguel.pdf');
  assert.equal(t.saved.length,0);
  assert.equal(t.toasts[0][1],'error');
});

test('sem conexão não altera o contrato',async()=>{
  const t=setup({connected:false});
  assert.equal(await t.global.phase2ContractRename(0),false);
  assert.equal(t.contract.arquivoNome,'aluguel.pdf');
});

test('recusa troca de extensão ou nome contendo caminho',async()=>{
  const t=setup();
  t.global.prompt=()=> 'aluguel outubro.docx';
  assert.equal(await t.global.phase2ContractRename(0),false);
  t.global.prompt=()=> '../documento';
  assert.equal(await t.global.phase2ContractRename(0),false);
  assert.equal(t.saved.length,0);
});

test('baixar arquivo usa o nome salvo e mantém o arquivo original',async()=>{
  const t=setup();
  await t.global.phase2ContractRename(0);
  assert.equal(t.global.phase2ContractDownload(0),true);
  assert.equal(t.getDownload()?.name,'aluguel outubro.pdf');
});
