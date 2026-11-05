(function(global){
'use strict';
const cache=new Map();
let cacheUser=null;
const restricted={documentCategories:['canBusinessDocs'],partyBanks:['canPartyBanks'],fiscalLinks:['canReceivables','canFiscalRead'],ownerBills:['admin','canOwnerBills']};
function repo(){return global.__businessRepository||null;}
async function canLoad(collection){
  const current=global.firebase?.auth?.()?.currentUser||null;
  const uid=current?.uid||null;
  if(uid!==cacheUser){cache.clear();cacheUser=uid;}
  if(!Object.prototype.hasOwnProperty.call(restricted,collection))return true;
  if(!current)return false;
  const claims=(await current.getIdTokenResult()).claims||{};
  if(claims.erpAccess!==true)return false;
  const required=restricted[collection];
  return collection==='ownerBills'?required.every(key=>claims[key]===true):required.some(key=>claims[key]===true);
}
async function load(collection,fallback){
  if(!await canLoad(collection))return fallback===undefined?{}:fallback;
  if(cache.has(collection))return cache.get(collection);
  let value=fallback===undefined?{}:fallback;
  try{
    const r=repo();
    if(r){const cloud=await r.read(collection);if(cloud!=null)value=cloud;}
  }catch(error){
    if(Object.prototype.hasOwnProperty.call(restricted,collection))throw error;
    console.warn('[phase1-store] load',collection,error);
  }
  cache.set(collection,value);
  return value;
}
async function save(collection,id,value){
  if(!id)throw new Error('ID obrigatório.');
  const r=repo();
  if(!r)throw new Error('Repositório Firebase indisponível.');
  await r.upsert(collection,id,value);
  try{if(typeof global.erpAudit==='function')global.erpAudit('upsert','phase1',{entityType:collection,entityId:id,scope:collection});}catch(error){}
  const current=cache.get(collection)||{};
  current[id]=value;cache.set(collection,current);
  return value;
}
async function remove(collection,id){
  const r=repo();if(!r)return;
  await r.remove(collection,id);
  try{if(typeof global.erpAudit==='function')global.erpAudit('delete','phase1',{entityType:collection,entityId:id,scope:collection});}catch(error){}
  const current=cache.get(collection)||{};delete current[id];cache.set(collection,current);
}
function list(value){return Array.isArray(value)?value:Object.values(value||{});}
function id(prefix){return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;}
global.Phase1Store=Object.freeze({load,save,remove,list,id});
})(window);
