import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const supplierSource = fs.readFileSync(new URL('../public/legacy/supplier-compat.js', import.meta.url), 'utf8');
const phase3Full = fs.readFileSync(new URL('../public/modules/phase3/phase3-homologation.js', import.meta.url), 'utf8');
const start = phase3Full.indexOf('let partyBanks={};');
const end = phase3Full.indexOf('function priceComboOptions(select,kind){', start);
assert.ok(start >= 0 && end > start, 'bloco real de contas bancárias localizado');
const bankSource = phase3Full.slice(start, end);

function bankHarness({saved, failSave = false} = {}) {
 const supplier = {
   cod: 'F008', nome: 'FORNECEDOR TESTE',
   banco: 'NUBANK', pix: 'PIX-ANTIGO',
   contas: [{ banco: 'NUBANK', pix: 'PIX-ANTIGO' }]
 };
 const errors=[], savedOps=[], notices=[];
 let renderCount = 0;
 const rows = [{inputs:[{dataset:{f:'bank'},value:'ITAU'}, {dataset:{f:'agency'},value:'8413'}, {dataset:{f:'account'},value:'23655'}, {dataset:{f:'pix'},value:'PIX-ATUAL'}, {dataset:{f:'holderName'},value:'NOME DO TITULAR'}, {dataset:{f:'holderDocument'},value:'12345678900'}]}];
 const saveButton = {disabled:false,isConnected:true};
 const overlay = {remove(){}};
 const context = {
   console:{warn(){},error(msg,e){errors.push([msg,String(e)]);}},
   setTimeout,
   FORNECEDORES:[supplier], CLIENTES:[],
   $: (sel)=>sel==='#phase3-bank-ov .p3-primary'?saveButton:sel==='#phase3-bank-ov'?overlay:null,
   $$: (sel,row)=>sel==='#phase3-bank-rows .phase3-bank-row'?rows:(sel==='input'||sel==='[data-f]')?row.inputs:[],
   esc:(v)=>String(v),
   notify:(msg,type)=>notices.push({msg,type}),
   saveFornecedores(){}, saveClientes(){}, fbSalvar(){},
   document:{createElement(){return {}},body:{appendChild(){}},dispatchEvent(){}},
   CustomEvent:class CustomEvent{constructor(type,init){this.type=type;this.detail=init?.detail;}},
   store:{
     async load(){return saved||{};},
     async save(collection,id,value){
       savedOps.push([collection,id,value]);
       if(failSave)throw new Error('permission_denied');
     }
   },
   window:{renderTabelaFornecedores(){renderCount++;}}
 };
 context.global=context.window;
 vm.createContext(context);
 vm.runInContext(bankSource + '\nglobal.__testLoadPartyBanks=loadPartyBanks;',context);
 return {context,supplier,rows,saveButton,notices,errors,savedOps,get renders(){return renderCount;}};
}

function supplierHarness(api){
 const supplier={cod:'F008',nome:'FORNECEDOR TESTE',banco:'NUBANK',pix:'PIX-ANTIGO',contas:[{banco:'NUBANK',pix:'PIX-ANTIGO'}]};
 const table={innerHTML:'',querySelectorAll(){return []}};
 const nodes=[];
 const context={
   console,FORNECEDORES:[supplier],getFornAtivos:()=>[supplier],
   cu:{admin:true},
   window:{ERPPartyBanks:api},
   document:{
     getElementById(id){return id==='tb-fornecedores'?table:id==='forn-pix-close'?{}:null},
     addEventListener(){},
     createElement(){const el={innerHTML:'',style:{},appendChild(child){this.child=child;},addEventListener(){}};nodes.push(el);return el;},
     body:{appendChild(){}}
   },
   atualizarBtnExcluir(){},
 };
 vm.createContext(context);
 vm.runInContext(supplierSource,context);
 return {table,context,nodes};
}

test('lista multibanco canônica tem prioridade sobre Nubank antigo e evita PIX (2)',async()=>{
 const {context}=bankHarness({saved:{'fornecedor-F008':[{bank:'ITAU',agency:'8413',account:'23655',pix:'PIX-ATUAL'}]}});
 await context.window.__testLoadPartyBanks();
 assert.equal(context.window.ERPPartyBanks.hasCanonical('fornecedor','F008'),true);
 const rendered=supplierHarness(context.window.ERPPartyBanks);
 rendered.context.window.renderTabelaFornecedores();
 assert.match(rendered.table.innerHTML,/PIX/);
 assert.doesNotMatch(rendered.table.innerHTML,/PIX \(2\)/);
 rendered.context.window.fornAbrirPix('F008');
 const html=rendered.nodes.find(node=>node.innerHTML.includes('Contas / PIX'))?.innerHTML||'';
 assert.match(html,/1 conta\(s\) cadastrada\(s\)/);
 assert.match(html,/ITAU/);
 assert.doesNotMatch(html,/NUBANK/);
});

test('sem registro canônico mantém a compatibilidade das contas legadas',async()=>{
 const {context}=bankHarness({saved:{}});
 await context.window.__testLoadPartyBanks();
 assert.equal(context.window.ERPPartyBanks.hasCanonical('fornecedor','F008'),false);
 const rendered=supplierHarness(context.window.ERPPartyBanks);
 rendered.context.window.renderTabelaFornecedores();
 assert.match(rendered.table.innerHTML,/PIX/);
});

test('lista canônica vazia não ressuscita conta principal legada',async()=>{
 const {context}=bankHarness({saved:{'fornecedor-F008':[]}});
 await context.window.__testLoadPartyBanks();
 assert.equal(context.window.ERPPartyBanks.hasCanonical('fornecedor','F008'),true);
 assert.equal(context.window.ERPPartyBanks.list('fornecedor','F008').length,0);
 const rendered=supplierHarness(context.window.ERPPartyBanks);
 rendered.context.window.renderTabelaFornecedores();
 assert.doesNotMatch(rendered.table.innerHTML,/>💳 PIX/);
});

test('salvar nova conta confirma antes de atualizar estado e contador',async()=>{
 const h=bankHarness({saved:{'fornecedor-F008':[{bank:'NUBANK',pix:'PIX-ANTIGO'}]}});
 await h.context.window.__testLoadPartyBanks();
 await h.context.window.phase3BankSave('fornecedor','F008');
 assert.equal(h.savedOps.length,1);
 assert.equal(h.savedOps[0][1],'fornecedor-F008');
 assert.equal(h.context.window.ERPPartyBanks.list('fornecedor','F008')[0].bank,'ITAU');
 assert.equal(h.supplier.banco,'ITAU');
 assert.equal(h.renders,1);
 assert.equal(h.notices.at(-1).type,'success');
});

test('erro Firebase mantém contas antigas e não informa sucesso',async()=>{
 const h=bankHarness({saved:{'fornecedor-F008':[{bank:'NUBANK',pix:'PIX-ANTIGO'}]},failSave:true});
 await h.context.window.__testLoadPartyBanks();
 await h.context.window.phase3BankSave('fornecedor','F008');
 assert.equal(h.context.window.ERPPartyBanks.list('fornecedor','F008')[0].bank,'NUBANK');
 assert.equal(h.supplier.banco,'NUBANK');
 assert.equal(h.renders,0);
 assert.equal(h.notices.at(-1).type,'error');
 assert.equal(h.saveButton.disabled,false);
});

test('PIX deduplica contas equivalentes e usa o titular de cada conta no WhatsApp',()=>{
 const api={hasCanonical(){return true;},list(){return [
  {bank:'BRASIL',agency:'4221-8',account:'24754-5',pix:'47 9 9904 6075',holderName:'FILHO DO FORNECEDOR',holderDocument:'12345678901',country:'BR'},
  {bank:'BRASIL',agency:'4221-8',account:'24754-5',pix:'47999046075',holderName:'FILHO DO FORNECEDOR',holderDocument:'12345678901',country:'BR'}
 ];}};
 const h=supplierHarness(api);
 h.context.window.fornAbrirPix('F008');
 const html=h.nodes.find(node=>node.innerHTML.includes('Contas / PIX'))?.innerHTML||'';
 assert.match(html,/1 conta\(s\) cadastrada\(s\)/);
 assert.match(html,/FILHO DO FORNECEDOR/);
 let outgoing='';h.context.window.open=url=>{outgoing=url;};
 h.context.window.fornPixWhatsapp('F008',0);
 const decoded=decodeURIComponent(outgoing);
 assert.match(decoded,/Titular da conta: FILHO DO FORNECEDOR/);
 assert.match(decoded,/CPF\/CNPJ do titular: 12345678901/);
 assert.match(decoded,/Banco: BRASIL/);
});
