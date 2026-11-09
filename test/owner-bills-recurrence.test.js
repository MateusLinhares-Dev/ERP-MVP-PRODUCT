import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync(new URL('../public/modules/phase3/phase3-homologation.js',import.meta.url),'utf8');
const chunk=(src.includes('let ownerBills={};')?('let ownerBills={};'+src.split('let ownerBills={};')[1]).split("function supplierTicketOptions(fornCod,current=''){")[0]:undefined);
assert.ok(chunk);
function harness(data={}){
 const records=structuredClone(data),writes=[],notices=[];
 const display={dataset:{},innerHTML:''},modal={className:'',innerHTML:''},controls=new Map();
 let fail=false;
 const context={global:{},store:{load:async()=>structuredClone(records),save:async(...args)=>{if(fail)throw Error('permission_denied');writes.push(args);},id:()=> 'PESS-NEW'},
 $:s=>s==='#phase2-owner-bills'?display:s==='#modal-body'?modal:s==='#modal-ov'?{classList:{add(){}}}:controls.get(s)||null,
 $$:()=>[],today:()=> '2026-11-03',norm:s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase(),
 money:n=>Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),
 toBR:s=>String(s||'').split('-').reverse().join('/'),parseBR:s=>Number(String(s).replace(/\./g,'').replace(',','.')),
 esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 notify:(m,t)=>notices.push({m,t}),cm:()=>{},console:{error:()=>{}}};
 vm.createContext(context);vm.runInContext('/* Contas pessoais */'+chunk,context);
 const set=(name,value)=>controls.set('#p3ob-'+name,{value,disabled:false,textContent:''});
 const setForm=(mode='fixed',months=12,due='2026-11-04')=>{
  set('id','');set('property','casa-gloria');set('desc','FACULDADE');set('value','1300,00');
  set('due',due);set('cat','Educação');set('obs','12 parcelas');set('recurrence',mode);set('recurrence-months',String(months));set('save','');
 };
 return {context,display,modal,writes,notices,set,setForm,records:()=>vm.runInContext('ownerBills',context),fail:()=>fail=true};
}

test('12 parcelas mensais vão de novembro/2026 a outubro/2027 sem gerar 12 cadastros',async()=>{
 const h=harness();await h.context.loadOwnerBills();h.setForm();
 await h.context.global.phase3OwnerSave();
 assert.equal(h.writes.length,1);
 const record=h.writes[0][2];
 assert.equal(record.recurrenceMode,'fixed');assert.equal(record.recurrenceMonths,12);assert.equal(record.startMonth,'2026-11');
 assert.equal(h.context.ownerOccurs(record,'2026-10'),false);
 assert.equal(h.context.ownerOccurs(record,'2026-11'),true);
 assert.equal(h.context.ownerOccurs(record,'2027-10'),true);
 assert.equal(h.context.ownerOccurs(record,'2027-11'),false);
 h.context.global.phase3OwnerMonth('2027-10');assert.match(h.display.innerHTML,/Parcela 12\/12/);
 h.context.global.phase3OwnerMonth('2027-11');assert.doesNotMatch(h.display.innerHTML,/FACULDADE/);
});

test('pagamento de parcela não quita os demais meses, fevereiro usa último dia possível',async()=>{
 const h=harness();await h.context.loadOwnerBills();h.setForm('fixed',12,'2026-11-30');
 await h.context.global.phase3OwnerSave();
 h.context.global.phase3OwnerMonth('2027-02');
 assert.equal(h.context.ownerDueDate(h.records()['PESS-NEW'],'2027-02'),'2027-02-28');
 await h.context.global.phase3OwnerPay('PESS-NEW');
 assert.equal(h.records()['PESS-NEW'].payments['2027-02'].paid,true);
 assert.equal(h.records()['PESS-NEW'].payments['2027-03'],undefined);
});

test('contas anteriores sem recorrência mantêm os meses antigos, inclusive pagamentos',async()=>{
 const h=harness({old:{id:'old',propertyId:'sitio',desc:'Conta antiga',value:20,dueDay:10,payments:{'2026-10':{paid:true,value:20}}}});
 await h.context.loadOwnerBills();
 assert.equal(h.context.ownerOccurs(h.records().old,'2026-09'),true);
 assert.equal(h.context.ownerOccurs(h.records().old,'2026-12'),true);
 h.context.global.phase3OwnerMonth('2026-10');assert.match(h.display.innerHTML,/Conta antiga/);
 h.context.global.phase3OwnerOpen('old');assert.match(h.modal.innerHTML,/Mensal — sem prazo final/);
});

test('somente uma vez não reaparece em meses posteriores',async()=>{
 const h=harness();await h.context.loadOwnerBills();h.setForm('once',12);await h.context.global.phase3OwnerSave();
 const b=h.records()['PESS-NEW'];assert.equal(h.context.ownerOccurs(b,'2026-11'),true);assert.equal(h.context.ownerOccurs(b,'2026-12'),false);
});

test('limites de meses e falha Firebase não alteram o registro local',async()=>{
 const h=harness();await h.context.loadOwnerBills();h.setForm('fixed',121);await h.context.global.phase3OwnerSave();
 assert.equal(h.writes.length,0);assert.match(h.notices.at(-1).m,/1 a 120/);
 h.setForm('fixed',12);h.fail();await h.context.global.phase3OwnerSave();
 assert.equal(h.writes.length,0);assert.deepEqual(Object.keys(h.records()),[]);
});
