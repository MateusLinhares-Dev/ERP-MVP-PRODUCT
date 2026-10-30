import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('public/modules/phase2/phase2-feedback.js','utf8');
const css=fs.readFileSync('public/modules/phase2/phase2-feedback.css','utf8');
const phase3=fs.readFileSync('public/modules/phase3/phase3-homologation.js','utf8');
const start=source.indexOf('function chequeData(){');
const end=source.indexOf('function cleanChequeControl(){',start);
function logic(data){
 const ctx={CHQ_CTRL:data,global:{}};
 const result=vm.runInNewContext(`(function(){${source.slice(start,end)}return {groups:chequeSequenceByBank(),review:chequeReviewRows(chequeSequenceByBank())};})()`,ctx,{timeout:1500});
 return result;
}
test('lacuna pequena lista numeros especificos e nao mistura bancos',()=>{
 const {review}=logic({a:{b:'Banco A',n:445},b:{b:'Banco A',n:450},c:{b:'Banco B',n:450},d:{b:'Banco B',n:451}});
 assert.equal(review.total,1);
 assert.deepEqual(Array.from(review.rows,x=>x.number),[446,447,448,449]);
 assert.ok(review.rows.every(x=>x.bank==='Banco A'&&x.type==='missing'));
});
test('salto ate um milhao nao sugere criar cheques de outro talao',()=>{
 const {review}=logic({a:{b:'A',n:1},b:{b:'A',n:1000000}});
 assert.equal(review.rows.length,1);assert.equal(review.rows[0].type,'jump');
 assert.equal(review.rows[0].number,null);assert.equal(review.jumps,1);
});
test('limita a renderizacao mesmo com multiplos intervalos',()=>{
 const input={};for(let i=0;i<1000;i++)input[i]={b:'A',n:i*12+1};
 const {review}=logic(input);
 assert.equal(review.total,999);assert.ok(review.rows.length<=48);
});
test('criacao sugerida preenche somente banco e numero e nao salva automaticamente',()=>{
 const snippet=source.slice(source.indexOf('global.phase2ChequeCreateMissing=function('),source.indexOf('function phase2FilterChequeRows(',source.indexOf('global.phase2ChequeCreateMissing=function(')));
 const bank={options:[{value:'A'},{value:'B'}],value:'B',dispatchEvent(){}};
 const num={value:'',dispatchEvent(){}};
 const other={value:''};
 const controls={'#chqm-b':bank,'#chqm-n':num,'#chqm-c':other};
 let opens=0,notifications=0;
 const ctx={global:{chqNovo(){opens++}},chequeSequenceByBank:()=>[{bank:'A',nums:[1,4],ranges:[{start:2,end:3,large:false}]}],$:(s)=>controls[s],notify:()=>notifications++,Event:class{}};
 vm.runInNewContext(snippet,ctx);
 ctx.global.phase2ChequeCreateMissing('A',2);
 assert.equal(opens,1);assert.equal(bank.value,'A');assert.equal(num.value,'2');assert.equal(other.value,'');
 ctx.global.phase2ChequeCreateMissing('A',1);
 assert.equal(opens,1);assert.equal(notifications,1);
});
test('resumo antigo nao aparece e painel usa altura limitada com botao no topo',()=>{
 assert.match(css,/#phase2-cheque-review\{/);
 assert.match(css,/max-height:350px/);
 assert.match(css,/#phase3-cheque-gaps\{display:none!important/);
 assert.match(source,/id='phase2-cheque-attention'/);
 assert.doesNotMatch(phase3,/const gapHtml=gaps.length/);
});
