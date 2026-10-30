import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const phase2 = fs.readFileSync('public/modules/phase2/phase2-feedback.js','utf8');
const phase3 = fs.readFileSync('public/modules/phase3/phase3-homologation.js','utf8');
const css2 = fs.readFileSync('public/modules/phase2/phase2-feedback.css','utf8');
const css3 = fs.readFileSync('public/modules/phase3/phase3-homologation.css','utf8');

function phase2Sequence(data){
  const start = phase2.indexOf('function chequeData()');
  const end = phase2.indexOf('function cleanChequeControl(){',start);
  assert.ok(start>=0 && end>start);
  const sandbox = {CHQ_CTRL:data};
  return vm.runInNewContext(
    `(function(){${phase2.slice(start,end)}return {groups:chequeSequenceByBank(),format:chequeGapSummary};})()`,
    sandbox,{timeout:1000}
  );
}
function phase3Sequence(data){
  const start = phase3.indexOf('function chequeSequence(){');
  const end = phase3.indexOf('function decorateCheque(){',start);
  assert.ok(start>=0 && end>start);
  return vm.runInNewContext(
    `(function(){${phase3.slice(start,end)}return chequeSequence();})()`,
    {CHQ_CTRL:data,global:{_chqDel:{}}},{timeout:1000}
  );
}

test('salto de 1 para 1000000 nao cria 999998 itens em nenhuma das duas telas',()=>{
  const data={a:{b:'Teste',n:1},b:{b:'Teste',n:1000000}};
  const {groups,format}=phase2Sequence(data);
  assert.equal(groups.length,1);
  assert.equal(groups[0].ranges.length,1);
  assert.equal(groups[0].missingCount,999998);
  assert.equal(groups[0].missing.length,0);
  assert.equal(groups[0].largeJumps,1);
  assert.match(format(groups[0]),/salto.*numeração/i);
  assert.ok(format(groups[0]).length<220);
  const p3=phase3Sequence(data);
  assert.equal(p3[0].ranges.length,1);
  assert.equal(p3[0].ranges[0].count,999998);
  assert.ok(p3[0].missing.length<5);
});

test('lacunas curtas e duplicados por banco sao reportados sem misturar contas',()=>{
  const data={a:{b:'Banco A',n:445},b:{b:'Banco A',n:450},c:{b:'Banco A',n:450},d:{b:'Banco B',n:1},e:{b:'Banco B',n:2}};
  const {groups,format}=phase2Sequence(data);
  assert.equal(groups.length,2);
  const a=groups.find(x=>x.bank==='Banco A'),b=groups.find(x=>x.bank==='Banco B');
  assert.equal(a.missingCount,4);
  assert.equal(a.ranges[0].start,446);
  assert.equal(a.ranges[0].end,449);
  assert.match(format(a),/446.*449/);
  assert.equal(b.ranges.length,0);
  assert.match(format(b),/sem lacunas/i);
});

test('muitos saltos exibem resumo limitado e nunca numeros individuais ilimitados',()=>{
  const data={};for(let i=0;i<1000;i++)data[`c${i}`]={b:'Teste',n:i*1000+1};
  const {groups,format}=phase2Sequence(data);
  assert.equal(groups[0].ranges.length,999);
  assert.ok(groups[0].missing.length<=12);
  assert.ok(format(groups[0]).length<220);
  assert.ok(phase3Sequence(data)[0].missing.length<=3);
});

test('confirmacao de salvamento e aviso de digitação nao percorrem intervalo numerico',()=>{
  const area=phase2.slice(phase2.indexOf('function enhanceChequeModal(){'),phase2.indexOf('/* ---------- Contas a pagar',phase2.indexOf('function enhanceChequeModal(){')));
  assert.ok(!area.includes('for(let x=max+1;x<n;x++)'));
  assert.match(area,/gap=n-max-1/);
  assert.match(area,/Números faltantes/);
  assert.match(area,/Esse número de cheque já existe neste banco/);
  assert.match(css2,/max-height:190px/);
  assert.match(css3,/max-height:108px/);
});
