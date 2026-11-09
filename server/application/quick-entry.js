// Lançamento rápido (celular/voz): Compra e Venda com conferência obrigatória.
//
// - A COMPRA reutiliza createPurchaseOrder: mesmas travas, recibo idempotente,
//   conta a pagar CPPO_ e baixa de pesagem. Nenhuma regra financeira é duplicada.
// - A VENDA grava venda + conta a receber + registro do lançamento em UM commit.
// - Nada é salvo a partir da fala: o servidor só recebe os campos já conferidos
//   e confirmados pelo usuário na tela.
import {randomUUID} from 'node:crypto';
import {createPurchaseOrder} from './purchase-order-create.js';
import {supplierOptions,supplierTombstones} from './finance-advances.js';
import {acquireLease,releaseLease} from '../infrastructure/rtdb-transaction.js';
import {businessTodayISO} from '../domain/business-date.js';

export const QUICK_LIMITS=Object.freeze({items:30,attachments:8,attachmentBytes:3*1024*1024,text:2000});
const ATTACHMENT_TYPES={'image/jpeg':'jpg','image/png':'png','application/pdf':'pdf'};

function fail(status,code,message,extra){
  const error=new Error(message);
  error.status=status;error.code=code;
  if(extra)Object.assign(error,extra);
  throw error;
}
const clean=(value,max=200)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const cleanText=(value,max)=>String(value??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,' ').trim().slice(0,max);
export const normalizeName=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'')
  .toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]+/g,' ').trim();
const money=cents=>Math.round(cents)/100;

async function database(db){return db||(await import('../infrastructure/firebase-admin.js')).getFirebaseAdmin().db;}
async function storageBucket(bucket){
  if(bucket)return bucket;
  const {getFirebaseAdmin}=await import('../infrastructure/firebase-admin.js');
  return getFirebaseAdmin().storage.bucket();
}

export function requireQuickEntry(identity){
  if(identity?.erpAccess!==true||(identity.canQuickEntry!==true&&identity.admin!==true))
    fail(403,'QUICK_ENTRY_FORBIDDEN','Seu usuário não tem acesso ao Lançamento rápido. Peça para liberar em Usuários e entre novamente.');
}
function ownerKey(identity){
  const key=String(identity.erpUser||identity.uid||'').replace(/[^\w-]/g,'_').slice(0,80);
  if(!key)fail(403,'QUICK_ENTRY_FORBIDDEN','Sessão sem usuário identificado.');
  return key;
}
function operationIdOf(input){
  const id=clean(input?.operationId,40);
  if(!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id))fail(422,'INVALID_OPERATION','Identificador da operação inválido. Recarregue a página.');
  return id;
}
// Mesma chave do recibo de compra (purchase-order-create): permite retomar a
// operação certa quando a resposta se perde no meio do caminho.
function entryKey(identity,operationId){
  const actor=String(identity.uid||identity.erpUser||'operador').replace(/[^\w-]/g,'_');
  if(!/^[\w-]{1,80}$/.test(actor))fail(403,'QUICK_ENTRY_FORBIDDEN','Sessão sem usuário identificado.');
  return actor+'_'+operationId;
}
function isoDate(value,fallback,label){
  const text=clean(value,10)||fallback;
  const parsed=new Date(text+'T12:00:00.000Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==text)
    fail(422,'INVALID_DATE',label+' inválida.');
  return text;
}
const brDate=iso=>iso.split('-').reverse().join('/');

function records(raw){
  return Object.entries(raw&&typeof raw==='object'?raw:{}).filter(([,row])=>row&&typeof row==='object'&&!Array.isArray(row));
}

async function loadCatalog(db){
  const paths=['erp/fornecedores','erp/fornDeleted','erp/fornDeletedV2','erp/fornecedoresDeleted','erp/fornecedoresDeletedV2',
    'erp/clientes','erp/clientesDeleted','erp/metais'];
  const snaps=await Promise.all(paths.map(path=>db.ref(path).get()));
  const value=index=>snaps[index].val();
  const deletedCodes=new Set([...supplierTombstones(value(1)),...supplierTombstones(value(2))]);
  const deletedIds=new Set([...supplierTombstones(value(3)),...supplierTombstones(value(4))]);
  const suppliers=supplierOptions(value(0),deletedCodes,deletedIds);
  const deletedCustomers=supplierTombstones(value(6));
  const byName=new Map();
  for(const [key,row] of records(value(5))){
    const nome=clean(row.nome,240);
    const id=clean(row.id||key,120);
    if(!nome||row.ativo===false||row.excluido===true||deletedCustomers.has(id)||deletedCustomers.has(key)||deletedCustomers.has(clean(row.cod)))continue;
    const normalized=normalizeName(nome);
    if(!byName.has(normalized))byName.set(normalized,{cod:clean(row.cod,60),nome});
  }
  const customers=[...byName.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR',{sensitivity:'base'}));
  const rawMaterials=value(7);
  const list=Array.isArray(rawMaterials)?rawMaterials:Object.values(rawMaterials&&typeof rawMaterials==='object'?rawMaterials:{});
  const seen=new Map();
  for(const item of list){
    const name=clean(typeof item==='string'?item:item?.nome||item?.mat,120);
    if(name&&!seen.has(normalizeName(name)))seen.set(normalizeName(name),name);
  }
  const materials=[...seen.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  return {suppliers,customers,materials};
}

function priceTable(raw){
  const table={};
  for(const [owner,prices] of records(raw)){
    const row={};
    for(const [material,price] of Object.entries(prices)){
      if(material.startsWith('_'))continue;
      const n=Number(price);
      if(Number.isFinite(n)&&n>0)row[material]=Math.round(n*10000)/10000;
    }
    if(Object.keys(row).length)table[owner]=row;
  }
  return table;
}

export async function quickEntryOptions(identity,{db,now=()=>Date.now(),env=process.env}={}){
  requireQuickEntry(identity);
  db=await database(db);
  const [catalog,supplierPrices,customerPrices]=await Promise.all([
    loadCatalog(db),
    db.ref('erp/precosForn').get().then(s=>priceTable(s.val())),
    db.ref('erp/precosCli').get().then(s=>priceTable(s.val()))
  ]);
  return {...catalog,supplierPrices,customerPrices,today:businessTodayISO(now()),
    user:{login:clean(identity.erpUser,80),admin:identity.admin===true},
    aiEnabled:Boolean(String(env.ANTHROPIC_API_KEY||'').trim()),
    limits:QUICK_LIMITS};
}

function parseItems(raw,materials){
  if(!Array.isArray(raw)||!raw.length)fail(422,'ITEMS_REQUIRED','Informe pelo menos um material.');
  if(raw.length>QUICK_LIMITS.items)fail(422,'TOO_MANY_ITEMS','Máximo de '+QUICK_LIMITS.items+' materiais por lançamento.');
  const known=new Map(materials.map(name=>[normalizeName(name),name]));
  return raw.map((row,index)=>{
    const line=index+1;
    if(!row||typeof row!=='object'||Array.isArray(row))fail(422,'INVALID_ITEM','Material da linha '+line+' inválido.');
    const material=known.get(normalizeName(row.material));
    if(!material)fail(422,'UNKNOWN_MATERIAL','Material da linha '+line+' não está cadastrado no ERP: '+clean(row.material,60)+'.');
    const kg=Number(row.quantidadeKg),price=Number(row.precoKg);
    if(!Number.isFinite(kg)||kg<=0||kg>10000000)fail(422,'INVALID_QUANTITY','Informe o peso (kg) da linha '+line+'.');
    if(!Number.isFinite(price)||price<=0||price>1000000)fail(422,'INVALID_PRICE','Informe o preço por kg da linha '+line+'.');
    const quantity=Math.round(kg*1000)/1000,unitPrice=Math.round(price*10000)/10000;
    const totalCents=Math.round(quantity*unitPrice*100);
    if(totalCents<=0)fail(422,'INVALID_TOTAL','O valor da linha '+line+' ficou zerado.');
    return {material,quantity,unitPrice,totalCents};
  });
}

async function reserveAttachments(db,identity,raw){
  if(raw==null)return [];
  if(!Array.isArray(raw)||raw.length>QUICK_LIMITS.attachments)fail(422,'TOO_MANY_ATTACHMENTS','Máximo de '+QUICK_LIMITS.attachments+' anexos por lançamento.');
  const owner=ownerKey(identity);
  const ids=[...new Set(raw.map(id=>clean(id,60)))];
  const rows=await Promise.all(ids.map(async id=>{
    if(!/^[\w-]{1,60}$/.test(id))fail(422,'INVALID_ATTACHMENT','Anexo inválido.');
    const record=(await db.ref('erp/quickUploads/'+owner+'/'+id).get()).val();
    if(!record)fail(409,'ATTACHMENT_NOT_FOUND','Um dos anexos não foi encontrado. Envie o arquivo novamente.');
    return record;
  }));
  return rows.map(row=>({id:clean(row.id,60),nome:clean(row.nome,120),tipo:clean(row.tipo,40),tamanho:Number(row.tamanho)||0,dono:owner}));
}

async function withEntryLock(db,key,now,uuid,work){
  const ref=db.ref('erpQuickLocks/'+key),owner=uuid();
  if(!await acquireLease(ref,owner,{now,ttlMs:90000,meta:{kind:'quick-entry'}}))
    fail(409,'QUICK_ENTRY_IN_PROGRESS','Este lançamento já está sendo gravado. Aguarde alguns segundos e confira em "Meus lançamentos".',{retryAfterSeconds:5});
  try{return await work();}
  finally{await releaseLease(ref,owner,{label:'quick.entry.lock.release'});}
}

// Chaves de erp/tickets sem baixar os pedidos (que podem conter fotos da balança).
async function defaultListKeys(db,path){
  const app=db.app;
  const emulator=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  try{
    const base=new URL(String(app?.options?.databaseURL||''));
    let url,headers={};
    if(emulator){
      const ns=base.searchParams.get('ns')||base.hostname.split('.')[0];
      url='http://'+emulator+'/'+path+'.json?shallow=true&ns='+encodeURIComponent(ns);
      headers.Authorization='Bearer owner';
    }else{
      const token=await app.options.credential.getAccessToken();
      url=base.origin+'/'+path+'.json?shallow=true';
      headers.Authorization='Bearer '+token.access_token;
    }
    const response=await fetch(url,{headers});
    if(!response.ok)throw new Error('HTTP '+response.status);
    return Object.keys((await response.json())||{});
  }catch(error){
    console.warn('quick.entry.shallow_keys_fallback',{path,reason:String(error?.message||error)});
    return Object.keys((await db.ref(path).get()).val()||{});
  }
}

export async function nextTicketNumber(db,{listKeys=defaultListKeys}={}){
  const [ticketKeys,deletedV2,legacyDeleted]=await Promise.all([
    listKeys(db,'erp/tickets'),
    db.ref('erp/ticketsDeletedV2').get().then(s=>Object.keys(s.val()||{})),
    db.ref('erp/ticketsDeleted').get().then(s=>{const v=s.val();return Array.isArray(v)?v.map(String):Object.values(v||{}).map(String);})
  ]);
  let max=0;
  for(const key of [...ticketKeys,...deletedV2,...legacyDeleted]){
    const match=/^T(\d{1,9})$/i.exec(String(key).trim());
    if(match)max=Math.max(max,Number(match[1]));
  }
  return 'T'+String(max+1).padStart(3,'0');
}
const bumpTicket=ticket=>'T'+String(Number(ticket.slice(1))+1).padStart(3,'0');

function purchaseTicket({ticketNo,supplier,lines,date,due,notes,operationId,identity,attachments}){
  const productCents=lines.reduce((sum,line)=>sum+line.totalCents,0);
  const itens=lines.map(line=>({mat:line.material,matBase:line.material,ident:'',descricaoDetalhada:'',descricao:'',obs:'',
    unidade:'kg',quantidade:line.quantity,pesoBruto:line.quantity,pesoLiq:line.quantity,preco:line.unitPrice,
    subtotal:money(line.totalCents),total:money(line.totalCents)}));
  const total=money(productCents);
  const ticket={ticket:ticketNo,numeroPedido:ticketNo,data:date,dataCompra:date,vencimentoSaldo:due,
    fornecedor:supplier.nome,fornecedorNome:supplier.nome,fornecedorCod:supplier.cod,itens,
    totalKg:Math.round(lines.reduce((sum,line)=>sum+line.quantity,0)*1000)/1000,
    totalProdutos:total,totalGeral:total,descontoCompra:0,freteCompra:0,acrescimo:0,acrescimos:[],
    adiantamento:0,saldoPagar:total,status:'Pendente',ordemCompra:'',observacoesPedido:notes,
    _balFinalizado:false,_consolidado:true,_purchaseOperationId:operationId,
    pedidoCompra:{versao:1,numero:ticketNo,ordemCompra:'',dataCompra:date,vencimentoSaldo:due,observacoes:notes,
      desconto:0,frete:0,totalProdutos:total,totalPedido:total},
    origemLancamento:'celular',lancadoPor:clean(identity.erpUser,80)};
  if(attachments.length)ticket.anexosCelular=attachments;
  return ticket;
}

function entrySummary(lines){
  return lines.map(line=>({material:line.material,quantidadeKg:line.quantity,precoKg:line.unitPrice,total:money(line.totalCents)}));
}

export async function createQuickPurchase(identity,input,{db,now=()=>Date.now(),uuid=randomUUID,create=createPurchaseOrder,listKeys}={}){
  requireQuickEntry(identity);
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_INPUT','Dados inválidos.');
  const operationId=operationIdOf(input);
  db=await database(db);
  const key=entryKey(identity,operationId);
  const entryRef=db.ref('erp/quickEntries/'+key);
  const existing=(await entryRef.get()).val();
  if(existing){
    if(existing.tipo!=='compra')fail(409,'OPERATION_REUSED','Esta operação já foi usada em outro lançamento.');
    return {entry:existing,alreadyCommitted:true};
  }
  const today=businessTodayISO(now());
  const date=isoDate(input.data,today,'Data da compra');
  const due=isoDate(input.vencimento,date,'Data de vencimento');
  if(due<date)fail(422,'INVALID_DUE_DATE','O vencimento não pode ser antes da data da compra.');
  const notes=cleanText(input.observacao,1000);
  const spoken=cleanText(input.textoFalado,QUICK_LIMITS.text);
  const catalog=await loadCatalog(db);
  const supplierCode=clean(input.fornecedorCod,80);
  const supplier=catalog.suppliers.find(row=>row.cod===supplierCode);
  if(!supplier)fail(422,'SUPPLIER_NOT_FOUND','Escolha um fornecedor da lista.');
  const lines=parseItems(input.itens,catalog.materials);
  const attachments=await reserveAttachments(db,identity,input.anexos);
  return withEntryLock(db,key,now,uuid,async()=>{
    const again=(await entryRef.get()).val();
    if(again)return {entry:again,alreadyCommitted:true};
    // Se o pedido já foi criado por esta operação (resposta perdida), reaproveita o número.
    const receipt=(await db.ref('erp/purchaseCreateOperations/'+key).get()).val();
    let ticketNo=String(receipt?.ticket?.ticket||'')||await nextTicketNumber(db,{listKeys});
    const purchaseIdentity={...identity,canPurchasing:true};
    let result=null;
    for(let attempt=0;attempt<8&&!result;attempt++){
      const ticket=purchaseTicket({ticketNo,supplier,lines,date,due,notes,operationId,identity,attachments});
      try{
        result=await create(purchaseIdentity,{ticketNo,fornecedorCod:supplier.cod,operationId,ticket,
          advanceCodes:[],chequeIds:[],sourceTicketKeys:[]},{db,now,uuid});
      }catch(error){
        if(error?.code==='TICKET_EXISTS'&&!receipt){ticketNo=bumpTicket(ticketNo);continue;}
        throw error;
      }
    }
    if(!result)fail(409,'TICKET_NUMBER_UNAVAILABLE','Não foi possível reservar um número de compra. Tente novamente.');
    const saved=result.ticket||{};
    const entry={id:key,tipo:'compra',referencia:String(saved.ticket||ticketNo),parte:supplier.nome,parteCod:supplier.cod,
      total:Number(saved.totalGeral)||money(lines.reduce((sum,line)=>sum+line.totalCents,0)),itens:entrySummary(lines),
      data:date,vencimento:due,observacao:notes,textoFalado:spoken,anexos:attachments,
      contaPagar:result.payable?.id||'',criadoEm:now(),criadoPor:clean(identity.erpUser,80)};
    const updates={['erp/quickEntries/'+key]:entry};
    for(const file of attachments)updates['erp/quickUploads/'+file.dono+'/'+file.id+'/lancamento']=key;
    await db.ref().update(updates);
    return {entry,alreadyCommitted:Boolean(result.alreadyCommitted)};
  });
}

export async function createQuickSale(identity,input,{db,now=()=>Date.now(),uuid=randomUUID}={}){
  requireQuickEntry(identity);
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_INPUT','Dados inválidos.');
  const operationId=operationIdOf(input);
  db=await database(db);
  const key=entryKey(identity,operationId);
  const entryRef=db.ref('erp/quickEntries/'+key);
  const existing=(await entryRef.get()).val();
  if(existing){
    if(existing.tipo!=='venda')fail(409,'OPERATION_REUSED','Esta operação já foi usada em outro lançamento.');
    return {entry:existing,alreadyCommitted:true};
  }
  const today=businessTodayISO(now());
  const date=isoDate(input.data,today,'Data da venda');
  const due=isoDate(input.vencimento,date,'Data de vencimento');
  if(due<date)fail(422,'INVALID_DUE_DATE','O vencimento não pode ser antes da data da venda.');
  const notes=cleanText(input.observacao,1000);
  const invoice=clean(input.nf,40);
  const spoken=cleanText(input.textoFalado,QUICK_LIMITS.text);
  const catalog=await loadCatalog(db);
  const customer=catalog.customers.find(row=>normalizeName(row.nome)===normalizeName(input.cliente));
  if(!customer)fail(422,'CUSTOMER_NOT_FOUND','Escolha um cliente da lista. Cliente novo precisa ser cadastrado no ERP.');
  const lines=parseItems(input.itens,catalog.materials);
  const attachments=await reserveAttachments(db,identity,input.anexos);
  return withEntryLock(db,key,now,uuid,async()=>{
    const again=(await entryRef.get()).val();
    if(again)return {entry:again,alreadyCommitted:true};
    const at=now();
    const suffix=uuid().replace(/-/g,'').slice(0,6).toUpperCase();
    const saleId='VD-'+at+'-'+suffix;
    const receivableId='CR'+at.toString(36)+suffix.toLowerCase();
    const totalCents=lines.reduce((sum,line)=>sum+line.totalCents,0);
    const total=money(totalCents);
    const dateBR=brDate(date),dueBR=brDate(due);
    const sale={id:saleId,nf:invoice,data:dateBR,cliente:customer.nome,
      itens:lines.map(line=>({mat:line.material,matBase:line.material,ident:'',qt:line.quantity,pr:line.unitPrice,total:money(line.totalCents)})),
      subtotal:total,desconto:0,descontoTipo:'R$',descontoInput:0,acrescimo:0,total,venc:dueBR,status:'Pendente',obs:notes,
      origemLancamento:'celular',lancadoPor:clean(identity.erpUser,80)};
    if(attachments.length)sale.anexosCelular=attachments;
    const receivable={id:receivableId,data:dateBR,cli:customer.nome,nf:invoice,valor:total,forma:'—',banco:'—',
      venc:dueBR,status:'Pendente',dataReceb:'',obs:'Venda lançada pelo celular'+(invoice?' – NF '+invoice:''),vendaId:saleId};
    const entry={id:key,tipo:'venda',referencia:saleId,parte:customer.nome,parteCod:customer.cod,total,itens:entrySummary(lines),
      data:date,vencimento:due,nf:invoice,observacao:notes,textoFalado:spoken,anexos:attachments,contaReceber:receivableId,
      criadoEm:at,criadoPor:clean(identity.erpUser,80)};
    const updates={
      ['erp/vendas/'+saleId]:sale,
      ['erp/contasReceber/'+receivableId]:receivable,
      ['erp/quickEntries/'+key]:entry,
      'erp/_ts':at
    };
    for(const file of attachments)updates['erp/quickUploads/'+file.dono+'/'+file.id+'/lancamento']=key;
    await db.ref().update(updates);
    return {entry,alreadyCommitted:false};
  });
}

function situation(entry,record){
  if(!record)return 'Excluído no ERP';
  if(entry.tipo==='compra'){
    if(record.status==='Pago')return 'Pago';
    if(record.status==='Parcial')return 'Pago em parte';
    return 'A pagar';
  }
  if(record.status==='Pago')return 'Recebido';
  if(record.status==='Permuta')return 'Permuta';
  return 'A receber';
}

export async function listQuickEntries(identity,{db,limit=60}={}){
  requireQuickEntry(identity);
  db=await database(db);
  const all=(await db.ref('erp/quickEntries').get()).val()||{};
  const viewAll=identity.admin===true;
  const login=clean(identity.erpUser,80);
  const rows=Object.values(all).filter(row=>row&&typeof row==='object'&&(viewAll||row.criadoPor===login))
    .sort((a,b)=>Number(b.criadoEm||0)-Number(a.criadoEm||0)).slice(0,limit);
  await Promise.all(rows.map(async row=>{
    const ref=String(row.referencia||'');
    if(!/^[\w-]{1,80}$/.test(ref)){row.situacao='—';return;}
    const record=(await db.ref((row.tipo==='compra'?'erp/tickets/':'erp/vendas/')+ref).get()).val();
    row.situacao=situation(row,record);
  }));
  return {entries:rows,viewAll};
}

function detectType(buffer){
  if(buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return 'image/jpeg';
  if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return 'image/png';
  if(buffer.length>=5&&buffer.subarray(0,5).toString('latin1')==='%PDF-')return 'application/pdf';
  return '';
}

export async function uploadQuickAttachment(identity,input,{db,bucket,now=()=>Date.now(),uuid=randomUUID}={}){
  requireQuickEntry(identity);
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_INPUT','Arquivo inválido.');
  const declared=clean(input.tipo,40);
  if(!ATTACHMENT_TYPES[declared])fail(415,'UNSUPPORTED_FILE','Envie foto (JPG/PNG) ou PDF.');
  const content=String(input.conteudo||'');
  if(!content||content.length>Math.ceil(QUICK_LIMITS.attachmentBytes*4/3)+8||!/^[A-Za-z0-9+/]+={0,2}$/.test(content))
    fail(413,'FILE_TOO_LARGE','Arquivo inválido ou maior que 3 MB.');
  const buffer=Buffer.from(content,'base64');
  if(!buffer.length||buffer.length>QUICK_LIMITS.attachmentBytes)fail(413,'FILE_TOO_LARGE','O arquivo precisa ter até 3 MB.');
  const type=detectType(buffer);
  if(type!==declared)fail(415,'UNSUPPORTED_FILE','O conteúdo do arquivo não corresponde a uma foto JPG/PNG ou PDF.');
  db=await database(db);
  bucket=await storageBucket(bucket);
  const owner=ownerKey(identity);
  const id='AX'+now().toString(36)+uuid().replace(/-/g,'').slice(0,10);
  const path='lancamento-rapido/'+owner+'/'+id+'.'+ATTACHMENT_TYPES[type];
  const name=clean(input.nome,120).replace(/[\\/]/g,'_')||('anexo.'+ATTACHMENT_TYPES[type]);
  await bucket.file(path).save(buffer,{resumable:false,contentType:type,metadata:{cacheControl:'private, max-age=0'}});
  const record={id,nome:name,tipo:type,tamanho:buffer.length,caminho:path,dono:owner,criadoEm:now()};
  await db.ref('erp/quickUploads/'+owner+'/'+id).set(record);
  return {anexo:{id,nome:name,tipo:type,tamanho:buffer.length,dono:owner}};
}

export async function readQuickAttachment(identity,input,{db,bucket}={}){
  requireQuickEntry(identity);
  const owner=clean(input?.dono,80),id=clean(input?.id,60);
  if(!/^[\w-]{1,80}$/.test(owner)||!/^[\w-]{1,60}$/.test(id))fail(422,'INVALID_ATTACHMENT','Anexo inválido.');
  if(identity.admin!==true&&owner!==ownerKey(identity))fail(403,'ATTACHMENT_FORBIDDEN','Este anexo pertence a outro usuário.');
  db=await database(db);
  const record=(await db.ref('erp/quickUploads/'+owner+'/'+id).get()).val();
  if(!record?.caminho)fail(404,'ATTACHMENT_NOT_FOUND','Anexo não encontrado.');
  // Defesa extra: só entrega arquivos da pasta do próprio lançamento rápido.
  if(record.caminho!=='lancamento-rapido/'+owner+'/'+id+'.'+ATTACHMENT_TYPES[record.tipo])
    fail(404,'ATTACHMENT_NOT_FOUND','Anexo não encontrado.');
  bucket=await storageBucket(bucket);
  const [buffer]=await bucket.file(record.caminho).download();
  return {buffer,tipo:ATTACHMENT_TYPES[record.tipo]?record.tipo:'application/octet-stream',nome:clean(record.nome,120)||id};
}
