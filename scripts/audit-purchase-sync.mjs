import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
const num=v=>Number.isFinite(Number(v))?Math.round(Number(v)*100)/100:0;
const items=t=>(Array.isArray(t.itens)?t.itens:[]).map(row=>[
  normalize(row.mat||row.matBase),num(row.pesoLiq??row.quantidade),num(row.preco)
]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const sourceKey=t=>Array.isArray(t._ticketsOrigemIds)?[...new Set(t._ticketsOrigemIds.map(String))].sort().join('|'):'';

export function auditPurchaseTickets(raw){
  const records=Object.entries(raw||{}).filter(([,ticket])=>ticket&&typeof ticket==='object'&&!Array.isArray(ticket));
  const byId=Object.fromEntries(records);
  const considered=records.filter(([,t])=>!t._balSessao&&!t._rodEntrada&&t.status!=='Aguard. Saída');
  const hiddenSources=considered.filter(([,t])=>t.status==='Consolidado'&&t._consolidadoEm&&byId[t._consolidadoEm]?._consolidado===true);
  const purchases=considered.filter(([id])=>!hiddenSources.some(([hid])=>hid===id));
  const index=new Map();
  const overlappingSources=[];
  const fingerprint=new Map();
  for(const [id,t] of records){
    const source=sourceKey(t);
    if(source&&t._consolidado){
      if(index.has(source))overlappingSources.push({tickets:[index.get(source),id],sourceTickets:source.split('|')});
      else index.set(source,id);
    }
    if(t._consolidado && !t._balSessao){
      const signature=JSON.stringify([normalize(t.fornecedorCod||t.fornecedor),
        normalize(t.dataCompra||t.data),num(t.totalGeral),items(t)]);
      if(!fingerprint.has(signature))fingerprint.set(signature,[]);
      fingerprint.get(signature).push(id);
    }
  }
  const missingSources=[];
  for(const [id,t] of records){
    if(t._consolidadoEm&&!byId[t._consolidadoEm])missingSources.push({source:id,missingPurchase:String(t._consolidadoEm)});
  }
  const brokenIds=records.filter(([id,t])=>String(t.ticket||'')!==id)
    .map(([key,t])=>({firebaseKey:key,ticketField:t.ticket||null}));
  return {
    summary:{recordsOnFirebase:records.length,financeRowsBefore:considered.length,
      financeRowsAfter: purchases.length,consolidatedSourceRowsHidden:hiddenSources.length},
    overlappingSources,possibleDuplicateContent:[...fingerprint.values()].filter(ids=>ids.length>1),
    missingSources,brokenIds,
    note:'Conteúdo idêntico não comprova duplicidade: compras legítimas podem ter os mesmos valores. Nunca exclua por esta auditoria.'
  };
}

async function main(){
  const input=process.argv.find(arg=>arg.startsWith('--snapshot='));
  const live=process.argv.includes('--live');
  if(Boolean(input)===live)throw new Error('Uso: node scripts/audit-purchase-sync.mjs --snapshot=/caminho/export.json OU --live (somente leitura).');
  let tickets;
  if(input){
    const json=JSON.parse(await fs.readFile(input.slice('--snapshot='.length),'utf8'));
    tickets=json.erp?.tickets||json.tickets||json;
  }else{
    const {getFirebaseAdmin}=await import('../server/shared/firebase/firebase-admin.js');
    const {db}=getFirebaseAdmin();
    tickets=(await db.ref('erp/tickets').get()).val()||{};
  }
  const report=auditPurchaseTickets(tickets);
  console.log(JSON.stringify(report,null,2));
  if(report.overlappingSources.length||report.possibleDuplicateContent.length||report.brokenIds.length)
    process.exitCode=3;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error('[AUDITORIA] Falha:',error.message);process.exitCode=1;});
}
