import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const code=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
const start=code.indexOf('global.phase4PurchaseRecalc=function(){');
const end=code.indexOf('global.phase4PurchaseSupplierChanged=function()',start);
assert.ok(start>0&&end>start);

function calculate({editing,price}){
  const state={
    items:[{mat:'ANTIMONIO',quantidade:3,preco:price}],
    editKey:editing?'T275':'',originalBalance:0,originalTotal:330,appliedAdvance:100,
    discount:0,freight:0,legacyExtra:0,adts:[],cheques:[],supplierName:'TESTE'
  };
  const el=new Map();
  for(const id of ['phase4-po-item-count','phase4-po-qty-total','phase4-po-products-total','phase4-po-grand-total','phase4-po-advance-total','phase4-po-balance']){
    el.set(id,{textContent:'',title:'',classList:{values:new Set(),toggle(key,on){if(on)this.values.add(key);else this.values.delete(key);}}});
  }
  const ctx={global:{},getState:()=>[{},state],storeState(){},selectedSupplierName:()=>state.supplierName,
    document:{getElementById:id=>el.get(id)||null},parseBR:Number,today:()=> '2026-11-05',
    qty:n=>String(n),money:n=>Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})};
  runInNewContext(code.slice(start,end),ctx);
  const result=ctx.global.phase4PurchaseRecalc();
  return {result,label:el.get('phase4-po-balance').textContent,cls:el.get('phase4-po-balance').classList.values};
}

test('T275: reduzir total quitado de R$ 330 para R$ 300 indica conciliação, não crédito disponível',()=>{
  const result=calculate({editing:true,price:100});
  assert.equal(result.result.balance,-30);
  assert.match(result.label,/Requer conciliação: R\$ 30,00/);
  assert.equal(result.cls.has('credit'),false);
});

test('compra nova com adiantamento superior pode manter o crédito legítimo',()=>{
  const result=calculate({editing:false,price:100});
  assert.match(result.label,/R\$ 300,00/);
  assert.equal(result.cls.has('credit'),false);
});
