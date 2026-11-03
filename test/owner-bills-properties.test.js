import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'..');
const src=fs.readFileSync(path.join(root,'public/modules/phase3/phase3-homologation.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/modules/phase3/phase3-homologation.css'),'utf8');
const chunk=src.split('/* Contas pessoais da Dona — separadas por imóvel, sem alterar pagamentos anteriores */')[1]?.split('/* Adiantamentos: ticket selecionável')[0];

function harness(records){
  assert.ok(chunk,'Seção Contas da Dona deve existir');
  const display={dataset:{},innerHTML:''};
  const modal={className:'',innerHTML:''};
  const overlay={classList:{add(){}}};
  const controls=new Map();
  const notices=[];const writes=[];
  let failure=false;
  const context={
    global:{},
    store:{load:async()=>structuredClone(records),save:async(...args)=>{if(failure)throw Error('permission_denied');writes.push(args);},id:()=> 'PESS-NOVO'},
    $:s=>s==='#phase2-owner-bills'?display:s==='#modal-body'?modal:s==='#modal-ov'?overlay:controls.get(s)||null,
    $$:()=>[],
    today:()=> '2026-11-03',
    norm:s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(),
    money:n=>Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),
    toBR:s=>String(s||'').split('-').reverse().join('/'),
    parseBR:s=>Number(String(s).replace(/\./g,'').replace(',','.')),
    esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    notify:(m,t)=>notices.push({m,t}),
    cm:()=>{},
    console:{error:()=>{}}
  };
  vm.createContext(context);
  vm.runInContext('/* Contas pessoais */'+chunk,context);
  const select=(id,val)=>controls.set('#'+id,{value:val,disabled:false,textContent:''});
  return {context,display,modal,controls,notices,writes,select,setFail:v=>failure=v,records:()=>vm.runInContext('ownerBills',context)};
}
const records={
  sitio:{id:'sitio',propertyId:'sitio',desc:'Luz Sítio',value:100,dueDay:10,payments:{'2026-11':{paid:true,value:100}}},
  casa:{id:'casa',propertyId:'casa-gloria',desc:'Taxa de Lixo Glória',value:58.28,dueDay:14,payments:{}},
  antiga:{id:'antiga',desc:'Conta sem classificação',value:20,dueDay:15,payments:{'2026-10':{paid:true,value:20}}}
};

test('contas mensais ficam agrupadas em Sítio, Casa Glória e sem imóvel, preservando pagamentos anteriores',async()=>{
  const h=harness(records);
  await h.context.loadOwnerBills();
  assert.match(h.display.innerHTML,/data-property="sitio"/);
  assert.match(h.display.innerHTML,/data-property="casa-gloria"/);
  assert.match(h.display.innerHTML,/data-property="sem-imovel"/);
  assert.match(h.display.innerHTML,/R\$ 178,28/);
  assert.match(h.display.innerHTML,/Conta sem classificação/);
  assert.equal(h.records().antiga.payments['2026-10'].paid,true);
  const first=h.display.innerHTML.indexOf('data-property="sitio"');
  const second=h.display.innerHTML.indexOf('data-property="casa-gloria"');
  assert.ok(first<second,'grupos aparecem um abaixo do outro na ordem Sítio → Casa Glória');
});

test('totais por imóvel são independentes do filtro de situação',async()=>{
  const h=harness(records);await h.context.loadOwnerBills();
  h.context.global.phase3OwnerFilter('pago');
  assert.match(h.display.innerHTML,/R\$ 178,28/);
  assert.match(h.display.innerHTML,/Luz Sítio/);
  assert.doesNotMatch(h.display.innerHTML,/<b>Taxa de Lixo Glória<\/b>/);
  assert.match(h.display.innerHTML,/Nenhuma conta neste filtro/);
});

test('edição requer imóvel e mantém id e pagamentos antigos sem duplicar cadastro',async()=>{
  const h=harness(records);await h.context.loadOwnerBills();
  h.context.global.phase3OwnerOpen('antiga');
  assert.match(h.modal.innerHTML,/id="p3ob-property"/);
  assert.match(h.modal.innerHTML,/Imóvel \*/);
  h.select('p3ob-id','antiga');h.select('p3ob-property','casa-gloria');
  h.select('p3ob-desc','Conta sem classificação');h.select('p3ob-value','20,00');
  h.select('p3ob-due','2026-11-15');h.select('p3ob-cat','');h.select('p3ob-obs','Editado');
  h.select('p3ob-save','');
  await h.context.global.phase3OwnerSave();
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0][0],'ownerBills');
  assert.equal(h.writes[0][1],'antiga');
  assert.equal(h.writes[0][2].propertyId,'casa-gloria');
  assert.equal(h.writes[0][2].payments['2026-10'].paid,true);
  assert.equal(h.records().antiga.obs,'Editado');
  assert.match(h.display.innerHTML,/Conta sem classificação/);
  assert.doesNotMatch(h.display.innerHTML,/data-property="sem-imovel"/);
});

test('falha do Firebase não modifica o cadastro local nem fecha o editor',async()=>{
  const h=harness(records);await h.context.loadOwnerBills();
  h.select('p3ob-id','antiga');h.select('p3ob-property','sitio');
  h.select('p3ob-desc','Conta sem classificação');h.select('p3ob-value','20,00');
  h.select('p3ob-due','2026-11-15');h.select('p3ob-cat','');h.select('p3ob-obs','');
  h.select('p3ob-save','');h.setFail(true);
  await h.context.global.phase3OwnerSave();
  assert.equal(h.records().antiga.propertyId,undefined);
  assert.equal(h.writes.length,0);
  assert.equal(h.controls.get('#p3ob-save').disabled,false);
  assert.equal(h.notices.at(-1).t,'error');
});

test('novo cadastro deve ter imóvel definido e classe CSS responsiva',async()=>{
  const h=harness({});await h.context.loadOwnerBills();
  h.context.global.phase3OwnerOpen('','sitio');
  assert.match(h.modal.innerHTML,/option value="sitio" selected/);
  assert.match(h.modal.innerHTML,/option value="casa-gloria"/);
  h.select('p3ob-id','');h.select('p3ob-property','');h.select('p3ob-desc','Luz');
  h.select('p3ob-value','100,00');h.select('p3ob-due','2026-11-10');h.select('p3ob-save','');
  await h.context.global.phase3OwnerSave();
  assert.equal(h.writes.length,0);
  assert.match(h.notices.at(-1).m,/Selecione Sítio ou Casa Glória/);
  assert.match(css,/\.p3-owner-property-totals/);
  assert.match(css,/@media\(max-width:900px\)/);
});

test('pagamento continua associado à competência correta e atualiza o subtotal da Casa Glória',async()=>{
  const h=harness(records);await h.context.loadOwnerBills();
  await h.context.global.phase3OwnerPay('casa');
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0][1],'casa');
  assert.equal(h.writes[0][2].payments['2026-11'].paid,true);
  assert.match(h.display.innerHTML,/Pago: R\$ 58,28/);
  assert.equal(h.records().casa.propertyId,'casa-gloria');
});
