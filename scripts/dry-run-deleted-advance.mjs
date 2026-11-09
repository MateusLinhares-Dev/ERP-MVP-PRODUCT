#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {changeAdvance} from '../server/modules/advances/application/advances.js';

const opts=Object.fromEntries(process.argv.slice(2).filter(a=>a.startsWith('--')&&a.includes('='))
  .map(a=>{const i=a.indexOf('=');return [a.slice(2,i),a.slice(i+1)];}));
if(!opts.snapshot||!opts.advance){
  console.error('Uso: node scripts/dry-run-deleted-advance.mjs --snapshot=./export.json --advance=ADT...');
  process.exit(2);
}
const snapshot=JSON.parse(readFileSync(resolve(opts.snapshot),'utf8'));
const state=snapshot?.erp?structuredClone(snapshot):{erp:structuredClone(snapshot)};
const segments=path=>String(path).split('/').filter(Boolean);
const lookup=path=>segments(path).reduce((item,key)=>item?.[key],state);
const set=(path,value)=>{
  const parts=segments(path),leaf=parts.pop();let parent=state;
  for(const part of parts)parent=parent[part]??={};
  if(value===null)delete parent[leaf];
  else parent[leaf]=structuredClone(value);
};
const db={ref(path=''){return {
  async get(){return {val:()=>structuredClone(lookup(path)??null)};},
  async transaction(callback){
    const next=callback(structuredClone(lookup(path)??null));
    if(next===undefined)return {committed:false};
    set(path,next);return {committed:true};
  },
  async update(changes){for(const [suffix,value] of Object.entries(changes))
    set([path,suffix].filter(Boolean).join('/'),value);}
};}};
const matches=[];
for(const [supplier,entries] of Object.entries(state.erp?.adiantamentos||{}))
  for(const record of Object.values(entries||{}))
    if(record?.cod===opts.advance)matches.push({supplier,record});
if(matches.length!==1){
  console.log(JSON.stringify({status:'NOT_UNIQUE',count:matches.length,advanceCode:opts.advance},null,2));
  process.exitCode=2;
}else{
  const {supplier,record}=matches[0];
  const previousLedger=JSON.stringify(state.erp?.lancBanco??null);
  try{
    const result=await changeAdvance({erpAccess:true,canAdvances:true,uid:'simulacao_local',erpUser:'simulacao_local'},
      {action:'delete',fornCod:supplier,adtCod:opts.advance,expected:record,operationId:randomUUID()},
      {db,uuid:randomUUID});
    const remaining=Object.values(state.erp?.adiantamentos?.[supplier]||{}).filter(x=>x?.cod===opts.advance);
    const unchangedLedger=JSON.stringify(state.erp?.lancBanco??null)===previousLedger;
    console.log(JSON.stringify({status:result.restoredDeletion?'RESTAURACAO_CORRIGIDA':'EXCLUSAO_NORMAL_SIMULADA',
      advanceCode:opts.advance,removedInMemory:remaining.length===0,bankLedgerUnchanged:unchangedLedger,
      liveFirebaseChanged:false,sourceFileChanged:false},null,2));
    if(remaining.length||result.restoredDeletion&&!unchangedLedger)process.exitCode=1;
  }catch(error){
    console.log(JSON.stringify({status:'BLOCKED',code:error?.code||'UNKNOWN',
      message:error?.message||'Falha na simulação',liveFirebaseChanged:false,sourceFileChanged:false},null,2));
    process.exitCode=1;
  }
}
