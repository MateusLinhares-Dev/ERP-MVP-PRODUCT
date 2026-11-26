import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const purchase=readFileSync(new URL('../public/modules/purchase-order/purchase-order.js',import.meta.url),'utf8');
function extract(start,end){
  const first=purchase.indexOf(start),last=purchase.indexOf(end,first);
  assert.ok(first>=0&&last>first,`trecho ausente: ${start}`);
  return purchase.slice(first,last);
}

test('fechamento: cada adiantamento marcado mostra quanto entra, de cima para baixo, como o servidor aplica (sobra antiga primeiro quando está antes na lista)',()=>{
  const code=extract('function showAdvanceUse(state,total,credit){','async function compensatePurchaseFromAdvance(');
  const boxes={'csadt-0':{checked:true,value:'46130.98'},'csadt-1':{checked:true,value:'4010'},'csadt-2':{checked:true,value:'8645.15'},'csadt-3':{checked:false,value:'100'}};
  const notes={};for(let i=0;i<4;i++)notes['csadt-use-'+i]={textContent:'x',className:''};
  const ctx={document:{getElementById:id=>boxes[id]||notes[id]||null},cents:v=>Math.round(Number(v||0)*100),
    money:v=>Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})};
  runInNewContext(code+'\nthis.showAdvanceUse=showAdvanceUse;',ctx);
  const state={adts:[{},{},{},{}]};
  ctx.showAdvanceUse(state,32040.20,0);
  assert.deepEqual(Object.values(notes).map(n=>n.textContent),['Usa R$ 32.040,20 e sobram R$ 14.090,78.','Não entra: o pedido já fica pago com os de cima.','Não entra: o pedido já fica pago com os de cima.',''],'caso T1421: a sobra paga tudo e os PIX de 25/11 ficam livres');
  assert.match(notes['csadt-use-1'].className,/unused/);
  ctx.showAdvanceUse(state,50000,0);
  assert.deepEqual(Object.values(notes).map(n=>n.textContent),['Usa o valor todo.','Usa R$ 3.869,02 e sobram R$ 140,98.','Não entra: o pedido já fica pago com os de cima.','']);
  ctx.showAdvanceUse(state,10000,9000);
  assert.equal(notes['csadt-use-0'].textContent,'Usa R$ 1.000,00 e sobram R$ 45.130,98.','crédito antigo do fornecedor entra antes, como no servidor');
});

test('compra lançada ou editada pela tela nova volta ao cadastro o material excluído que ela usa (caso CHAPA DURA da T781)',()=>{
  const code=extract('function registerPurchaseMaterials(ticket){','function afterConfirmedPurchaseEdit(ticket,state,totals){');
  const registrados=[];let salvou=0;
  const ctx={METAIS:['FERRO','GRANA GROSSA'],_estoqueMaterialExcluido:n=>['CHAPA DURA','MEDALHA'].includes(n),
    _nomeAtualDoMaterial:n=>n==='MEDALHA'?'GRANA GROSSA':'',_garantirMetalCadastrado:n=>registrados.push(n),saveEstoque:()=>{salvou++;}};
  runInNewContext(code+'\nthis.registerPurchaseMaterials=registerPurchaseMaterials;',ctx);
  ctx.registerPurchaseMaterials({itens:[{mat:'FERRO'},{mat:'CHAPA DURA'},{mat:'MEDALHA'},{mat:'COBRE NOVO'},{mat:''}]});
  assert.deepEqual(registrados,['CHAPA DURA','COBRE NOVO'],'nome renomeado continua no nome novo; material do cadastro não é regravado');
  assert.equal(salvou,1);
  ctx.registerPurchaseMaterials({itens:[{mat:'FERRO'}]});
  assert.equal(salvou,1,'nada a cadastrar não grava');
  assert.match(purchase,/function finishPurchaseSave\(body,key,ticket,totals\)\{\n  manualMode=false;\n  resetOrderState\(body\);\n  try\{registerPurchaseMaterials\(ticket\);\}catch\(e\)\{\}/);
  assert.match(purchase,/function afterConfirmedPurchaseEdit\(ticket,state,totals\)\{\n  try\{registerPurchaseMaterials\(ticket\);\}catch\(e\)\{\}/);
});

test('a ordem de uso dos adiantamentos continua a da lista: nada reordena o fechamento nem a compensação depois do fechamento',()=>{
  assert.doesNotMatch(purchase,/advancesThisLoadFirst|loadFirstAdvances|purchaseAdvanceOrder|advanceOrder/);
  assert.match(purchase,/const outcome=await global\.erpPayablesCompensateAdvance\(cp\.id,portion\);/);
  assert.match(purchase,/Os marcados são usados de cima para baixo, até pagar o pedido\./);
});
