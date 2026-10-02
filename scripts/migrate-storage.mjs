import { getFirebaseAdmin } from '../server/infrastructure/firebase-admin.js';
const {db,storage}=getFirebaseAdmin(); const bucket=storage.bucket();
const roots=['erp/funcDocs','erp/empresaDocs','erp/frotaDocs'];
function joinChunks(v){if(!v||typeof v!=='object'||!v._partes)return v;let s='';for(let i=0;i<Number(v._partes);i++)s+=v['p'+i]||'';return s;}
function decode(dataUrl){const m=/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/s.exec(dataUrl||'');if(!m)return null;return{contentType:m[1]||'application/octet-stream',buffer:Buffer.from(m[2],'base64')};}
async function walk(path){const snap=await db.ref(path).get();const val=snap.val();if(!val)return;async function visit(obj,p){if(!obj)return;if(obj.__storageV===1)return;const joined=joinChunks(obj);if(typeof joined==='string'&&joined.startsWith('data:')){const decoded=decode(joined);if(!decoded)return;const sp='erp-files/'+p.split('/').slice(1).map(encodeURIComponent).join('/');await bucket.file(sp).save(decoded.buffer,{contentType:decoded.contentType,metadata:{cacheControl:'private,max-age=3600'}});await db.ref(p).set({__storageV:1,path:sp,contentType:decoded.contentType,size:decoded.buffer.length,updatedAt:Date.now()});console.log('migrado',p);return;}if(typeof obj==='object'){for(const[k,v]of Object.entries(obj))await visit(v,p+'/'+k);}}
await visit(val,path);}
for(const root of roots)await walk(root); console.log('Migração de arquivos concluída.');
