import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

const BASE='https://api.pluggy.ai';
const deny=(message,status=400)=>Object.assign(new Error(message),{status,code:status===403?'FORBIDDEN':'BANK_INTEGRATION_ERROR'});
const validBank=code=>/^[A-Za-z0-9_-]{1,40}$/.test(String(code||''));
const validId=id=>/^[A-Za-z0-9_-]{3,100}$/.test(String(id||''));
const clean=(text,max=120)=>String(text||'').trim().slice(0,max);
export function bankIntegrationKey(raw=process.env.BANK_INTEGRATION_ENCRYPTION_KEY){
  if(!raw)throw deny('Configure BANK_INTEGRATION_ENCRYPTION_KEY no servidor antes de salvar credenciais.',503);
  const value=/^[a-f\d]{64}$/i.test(raw)?Buffer.from(raw,'hex'):Buffer.from(raw,'base64');
  if(value.length!==32)throw deny('BANK_INTEGRATION_ENCRYPTION_KEY deve conter 32 bytes em Base64 ou 64 caracteres hexadecimais.',503);
  return value;
}
export function encryptCredentials(data,key=bankIntegrationKey()){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
  return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')};
}
export function decryptCredentials(record,key=bankIntegrationKey()){
  if(!record||record.v!==1)throw deny('Credenciais não configuradas.',409);
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(record.iv,'base64'));
  decipher.setAuthTag(Buffer.from(record.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ciphertext,'base64')),decipher.final()]).toString('utf8'));
}
export function centsFromProvider(amount){
  // Valores de uma API externa podem chegar como Number; representamos centavos
  // via string decimal antes de persistir, evitando aritmética de ponto flutuante.
  const s=String(amount);
  if(!/^-?\d{1,13}(?:\.\d{1,4})?$/.test(s))throw deny('Valor bancário externo inválido.',422);
  const negative=s.startsWith('-'),[units,fraction='']=s.replace('-','').split('.');
  const padded=fraction.padEnd(4,'0');
  let total=BigInt(units)*100n+BigInt(padded.slice(0,2));
  if(Number(padded[2])>=5)total+=1n;
  return (negative?-total:total).toString();
}
export function normalizeProviderTransaction(row,bankCode,identity,accountId){
  if(!validId(row.id))throw deny('Transação bancária sem identificador válido.',422);
  const date=String(row.date||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw deny('Transação bancária sem data válida.',422);
  const amountCents=centsFromProvider(row.amount);
  const id='P'+createHash('sha256').update('pluggy|'+bankCode+'|'+accountId+'|'+row.id).digest('hex');
  return {id,fitid:clean(row.id,100),description:clean(row.description||row.descriptionRaw||'Movimentação bancária',240),
    date,amountCents,bankCode,source:'pluggy',providerAccountId:accountId,importedBy:identity.erpUser,uid:identity.uid,importedAt:Date.now()};
}
const safeStatus=config=>({provider:'pluggy',connected:!!config?.itemId,configured:!!config?.secret,
  itemId:config?.itemId||'',accountId:config?.accountId||'',lastSyncAt:config?.lastSyncAt||null,
  lastSyncCount:config?.lastSyncCount||0,hasMore:!!config?.syncCursor,updatedAt:config?.updatedAt||null});
async function pluggy(path,{apiKey,method='GET',body,fetcher=globalThis.fetch}={}){
  const url=new URL(path,BASE);
  if(url.origin!==BASE)throw deny('Endereço de integração inválido');
  let response;
  try{response=await fetcher(url.toString(),{method,signal:AbortSignal.timeout(12000),headers:{...(apiKey?{'X-API-KEY':apiKey}:{}),Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch{throw deny('Banco/Open Finance indisponível no momento.',502);}
  let parsed={};try{parsed=await response.json();}catch{}
  if(!response.ok)throw deny(response.status===401?'Credenciais Pluggy inválidas.':'Falha na comunicação com o provedor bancário ('+response.status+').',response.status===401?401:502);
  return parsed;
}
const keyCache=new Map();
async function providerKey(bankCode,secret,fetcher){
  // Cache por processo: segredo nunca sai para navegador, nem grava a API Key no banco.
  const fingerprint=createHash('sha256').update(secret.clientId+'|'+secret.clientSecret).digest('hex');
  const entry=keyCache.get(bankCode);
  if(entry?.fingerprint===fingerprint&&entry.expire>Date.now())return entry.apiKey;
  const auth=await pluggy('/auth',{method:'POST',body:secret,fetcher});
  if(!auth.apiKey)throw deny('Provedor não retornou uma chave válida.',502);
  keyCache.set(bankCode,{apiKey:auth.apiKey,fingerprint,expire:Date.now()+100*60*1000});
  return auth.apiKey;
}
const rows=value=>Object.values(value||{}).filter(x=>x&&typeof x==='object');
async function accountExists(db,code){const snap=await db.ref('erp/bancos').get();return rows(snap.val()).some(b=>String(b.cod)===code);}
async function readPrivate(db,code){return (await db.ref('erpBankIntegrationPrivate/'+code).get()).val()||{};}
async function verifyAccount(apiKey,itemId,accountId,fetcher){
  const list=await pluggy('/accounts?itemId='+encodeURIComponent(itemId),{apiKey,fetcher});
  const accounts=Array.isArray(list.results)?list.results:[];
  if(accountId&&!accounts.some(a=>String(a.id)===accountId))throw deny('Conta externa não pertence à conexão bancária informada.',422);
  return accounts.map(a=>({id:String(a.id),name:clean(a.name||a.number||'Conta'),type:clean(a.type,32),numberEnd:String(a.number||'').slice(-4)}));
}
export async function handleBankIntegration(identity,input,{db,fetcher=globalThis.fetch}={}){
  if(!identity?.erpAccess||identity.canBanking!==true)throw deny('Acesso bancário não autorizado.',403);
  const code=String(input.bankCode||'');if(!validBank(code))throw deny('Conta do ERP inválida.');
  const database=db||(await import('../infrastructure/firebase-admin.js')).getFirebaseAdmin().db;
  if(!await accountExists(database,code))throw deny('Conta do ERP não encontrada.',404);
  const action=String(input.action||'status');
  const admin=identity.admin===true;
  const ref=database.ref('erpBankIntegrationPrivate/'+code);
  const config=await readPrivate(database,code);
  if(action==='status')return {config:safeStatus(config),canConfigure:admin};
  if(!admin)throw deny('Apenas a administradora pode configurar ou sincronizar uma integração bancária.',403);
  if(action==='save'){
    const clientId=clean(input.clientId,200),clientSecret=clean(input.clientSecret,300);
    if(!clientId||!clientSecret)throw deny('Informe Client ID e Client Secret do provedor.');
    const encrypted=encryptCredentials({clientId,clientSecret});
    await ref.update({provider:'pluggy',secret:encrypted,itemId:null,accountId:null,syncCursor:null,updatedAt:Date.now(),updatedBy:identity.erpUser});
    keyCache.delete(code);
    return {config:safeStatus({...config,secret:encrypted,itemId:null,accountId:null}),message:'Credenciais protegidas e salvas.'};
  }
  if(action==='disconnect'){
    await ref.update({itemId:null,accountId:null,syncCursor:null,updatedAt:Date.now(),updatedBy:identity.erpUser});
    return {config:safeStatus({...config,itemId:null,accountId:null}),message:'Vínculo com banco desconectado. Histórico existente foi preservado.'};
  }
  if(!config.secret)throw deny('Configure as credenciais antes de conectar.',409);
  const secret=decryptCredentials(config.secret),apiKey=await providerKey(code,secret,fetcher);
  if(action==='test')return {success:true,message:'Credenciais autenticadas no Pluggy.'};
  if(action==='connect-token'){
    const payload=await pluggy('/connect_token',{apiKey,method:'POST',fetcher,body:{options:{clientUserId:identity.uid,avoidDuplicates:true}}});
    if(!payload.accessToken)throw deny('Token de conexão indisponível.',502);
    return {accessToken:payload.accessToken};
  }
  if(action==='link'){
    const itemId=clean(input.itemId,100);if(!validId(itemId))throw deny('Conexão bancária inválida.');
    const accounts=await verifyAccount(apiKey,itemId,'',fetcher);
    if(!accounts.length)throw deny('Nenhuma conta disponível nessa conexão.',422);
    await ref.update({itemId,accountId:null,syncCursor:null,updatedAt:Date.now(),updatedBy:identity.erpUser});
    return {accounts,config:safeStatus({...config,itemId,accountId:null})};
  }
  if(action==='accounts'){
    if(!validId(config.itemId))throw deny('Conecte um banco primeiro.',409);
    return {accounts:await verifyAccount(apiKey,config.itemId,'',fetcher),config:safeStatus(config)};
  }
  if(action==='select-account'){
    const accountId=clean(input.accountId,100);
    if(!validId(config.itemId)||!validId(accountId))throw deny('Selecione uma conta bancária válida.');
    await verifyAccount(apiKey,config.itemId,accountId,fetcher);
    await ref.update({accountId,syncCursor:null,updatedAt:Date.now(),updatedBy:identity.erpUser});
    return {config:safeStatus({...config,accountId}),message:'Conta vinculada ao cadastro bancário.'};
  }
  if(action==='sync'){
    if(!validId(config.itemId)||!validId(config.accountId))throw deny('Conecte uma conta antes de sincronizar.',409);
    await verifyAccount(apiKey,config.itemId,config.accountId,fetcher);
    // Leitura e importação sem alterar lancBanco ou baixar títulos financeiros.
    let cursor=String(config.syncCursor||''),created=0,duplicates=0,processed=0;
    for(let page=0;page<3;page++){
      const q=new URLSearchParams({accountId:config.accountId});
      if(cursor)q.set('after',cursor);
      const data=await pluggy('/v2/transactions?'+q.toString(),{apiKey,fetcher});
      const transactions=Array.isArray(data.results)?data.results:[];
      if(transactions.length>500)throw deny('Resposta bancária acima do limite esperado.',502);
      for(let i=0;i<transactions.length;i+=10){
        const batch=transactions.slice(i,i+10).filter(row=>row.status!=='PENDING');
        const records=batch.map(row=>normalizeProviderTransaction(row,code,identity,config.accountId));
        const changes=await Promise.all(records.map(record=>database.ref('erp/bankReconciliationImports/'+code+'/'+record.id)
          .transaction(previous=>previous===null?record:undefined,undefined,false)));
        created+=changes.filter(result=>result.committed).length;
        duplicates+=changes.filter(result=>!result.committed).length;
        processed+=changes.length;
      }
      if(!data.next){cursor='';await ref.update({syncCursor:null});break;}
      const next=new URL(data.next,BASE+'/v2/transactions');
      if(next.pathname!=='/v2/transactions')throw deny('Paginação externa inválida.',502);
      const nextCursor=next.searchParams.get('after');
      if(!nextCursor||nextCursor===cursor)throw deny('Cursor de paginação inválido.',502);
      cursor=nextCursor;
      // Avança o cursor somente após persistir integralmente a página.
      // Em caso de falha, reexecutar é seguro, pois a gravação é idempotente.
      await ref.update({syncCursor:cursor});
    }
    await ref.update({lastSyncAt:Date.now(),lastSyncCount:created,updatedAt:Date.now(),updatedBy:identity.erpUser});
    await database.ref('erpBankIntegrationAudit/'+code).push({action:'sync',created,duplicates,processed,actor:identity.erpUser,uid:identity.uid,at:Date.now()});
    return {created,duplicates,processed,hasMore:!!cursor,message:`${created} movimentação(ões) nova(s) importada(s). ${duplicates} duplicada(s) ignorada(s).`+(cursor?' Há mais páginas; clique em Buscar movimentações novamente.':'')};
  }
  throw deny('Operação de integração não suportada.');
}
