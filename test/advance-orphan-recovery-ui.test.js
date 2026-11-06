import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const code=readFileSync(new URL('../public/modules/finance/advance-actions.js',import.meta.url),'utf8');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.events={};this.value='';this.checked=false;this.disabled=false;this.textContent='';this.parentElement=null;this.isConnected=true;}
  appendChild(el){el.parentElement=this;this.children.push(el);return el;}
  addEventListener(name,cb){this.events[name]=cb;}
  async trigger(name){return this.events[name]?.();}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(e=>e!==this);this.isConnected=false;}
  setAttribute(name,value){this[name]=value;}
  focus(){}
}
const findAll=(node,tag)=>[...(node.tag===tag?[node]:[]),...node.children.flatMap(child=>findAll(child,tag))];
const advance={cod:'ADT_124',valor:124,status:'Pendente',movBancoId:'LB_MISSING'};
function setup({claims={canAdvances:true,canBanking:true},previewOverrides={},lostResponse=false}={}){
  const calls=[],messages=[],db={F1:[structuredClone(advance)]};
  const document={body:new Element('body'),createElement(tag){return new Element(tag);}};
  const ctx={document,ADT_POR_FORN:db,FORNECEDORES:[{cod:'F1',nome:'Teste'}],console,
    showToast:(m)=>messages.push(m),
    firebase:{auth:()=>({currentUser:{getIdToken:async()=> 'token',getIdTokenResult:async()=>({claims})}})},
    crypto:{randomUUID:()=> 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'},
    localStorage:{setItem(){}},renderAdiantamentos(){},
    fetch:async(url,{body})=>{
      const payload=JSON.parse(body);calls.push(payload);
      if(payload.action==='preview')return {ok:true,json:async()=>({eligible:true,signature:'x'.repeat(64),amount:124,
        bankName:'acred gratus',date:'05/11/2026',supplierName:'Teste',canRecordTransfer:true,...previewOverrides})};
      if(lostResponse&&calls.filter(x=>x.action!=='preview').length===1)throw Error('A resposta HTTP se perdeu após o servidor receber a operação');
      if(payload.action==='record-bank-transfer')return {ok:true,json:async()=>({confirmed:true,action:'restore-missing-bank-movement'})};
      return {ok:true,json:async()=>({confirmed:true,removedCode:'ADT_124',entries:[]})};
    }
  };
  ctx.window=ctx;
  runInNewContext(code,ctx);
  async function open(){
    const pending=ctx.ERPAdvanceActions.reviewOrphanAdvance('F1','ADT_124');
    await new Promise(resolve=>setImmediate(resolve));
    return {pending,select:findAll(document.body,'select')[0],buttons:findAll(document.body,'button'),
      inputs:findAll(document.body,'input'),note:findAll(document.body,'textarea')[0]};
  }
  return {ctx,calls,messages,open};
}

test('a tela orienta consultar extrato externo e oferece as três decisões de negócio',async()=>{
  const app=setup();const form=await app.open();
  const text=JSON.stringify(findAll(app.ctx.document.body,'p').map(el=>el.textContent));
  assert.match(text,/extrato real/);
  assert.deepEqual(form.select.children.map(x=>x.value),['','no-transfer','paid','uncertain']);
  assert.equal(app.calls.length,1);
  await form.buttons[0].trigger('click');
  assert.equal(await form.pending,false);
  assert.equal(app.calls.length,1);
});

test('sem conferência externa e justificativa não envia cancelamento',async()=>{
  const app=setup();const f=await app.open();
  f.select.value='no-transfer';await f.select.trigger('change');
  assert.equal(f.buttons[1].disabled,true);
  f.inputs[1].checked=true;await f.inputs[1].trigger('change');
  assert.equal(f.buttons[1].disabled,true);
  f.note.value='Conferi o extrato da conta bancária e não ocorreu saída de dinheiro.';await f.note.trigger('input');
  assert.equal(f.buttons[1].disabled,false);
  await f.buttons[1].trigger('click');
  assert.equal(await f.pending,true);
  assert.deepEqual(app.calls.map(x=>x.action),['preview','confirm']);
  assert.equal(app.ctx.ADT_POR_FORN.F1.length,0);
});

test('pagamento confirmado no banco reconstitui vínculo sem cancelar adiantamento',async()=>{
  const app=setup();const f=await app.open();
  f.select.value='paid';await f.select.trigger('change');
  f.inputs[0].value='PIX-TESTE-EXTRATO-AB123';await f.inputs[0].trigger('input');
  f.inputs[1].checked=true;await f.inputs[1].trigger('change');
  f.note.value='Conferi valor, favorecido, data e conta no extrato real do banco.';await f.note.trigger('input');
  assert.equal(f.buttons[1].disabled,false);
  await f.buttons[1].trigger('click');
  assert.equal(await f.pending,true);
  assert.equal(app.calls[1].action,'record-bank-transfer');
  assert.equal(app.calls[1].confirmedRealTransfer,true);
  assert.equal(app.ctx.ADT_POR_FORN.F1.length,1);
});

test('se a conta não puder ser conciliada automaticamente a opção de registrar fica bloqueada',async()=>{
  const app=setup({previewOverrides:{canRecordTransfer:false}});const f=await app.open();
  f.select.value='paid';await f.select.trigger('change');
  assert.equal(f.buttons[1].disabled,true);
  await f.buttons[0].trigger('click');await f.pending;
  assert.equal(app.calls.length,1);
});

test('a pessoa sem as duas permissões financeiras não executa reconciliação',async()=>{
  const app=setup({claims:{canAdvances:true,canBanking:false}});
  await assert.rejects(app.ctx.ERPAdvanceActions.reviewOrphanAdvance('F1','ADT_124'),/Financeiro e Bancos/);
  assert.equal(app.calls.length,0);
});

test('resposta perdida reaproveita o mesmo UUID em vez de emitir segunda transferência',async()=>{
  const app=setup({lostResponse:true});const f=await app.open();
  f.select.value='paid';await f.select.trigger('change');
  f.inputs[0].value='PIX-EXTRATO-REAL-123';await f.inputs[0].trigger('input');
  f.inputs[1].checked=true;await f.inputs[1].trigger('change');
  f.note.value='Extrato real conferido, valor, data e beneficiário correspondem.';await f.note.trigger('input');
  await f.buttons[1].trigger('click');
  assert.equal(f.buttons[1].textContent,'Verificar novamente');
  assert.equal(f.select.disabled,true);
  await f.buttons[1].trigger('click');
  assert.equal(await f.pending,true);
  assert.equal(app.calls[1].operationId,app.calls[2].operationId);
  assert.deepEqual(app.calls.slice(1).map(x=>x.action),['record-bank-transfer','record-bank-transfer']);
});
