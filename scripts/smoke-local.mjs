const base=process.env.APP_BASE_URL||'http://127.0.0.1:3000';
const login=process.env.SMOKE_LOGIN||'elaine';
const passwordBase=String(process.env.LOCAL_DEV_PASSWORD_BASE||'').trim();
if(!passwordBase) throw new Error('LOCAL_DEV_PASSWORD_BASE não configurado. Rode com node --env-file=.env.erp.local.');
async function expectJson(path,options){
  const r=await fetch(base+path,options); let body={}; try{body=await r.json();}catch(_){}
  if(!r.ok) throw new Error(`${path} -> ${r.status}: ${body.message||JSON.stringify(body)}`);
  return body;
}
const health=await expectJson('/api/health');
if(!health.ok) throw new Error('health inválido');
const config=await expectJson('/api/config');
if(!config.emulators?.enabled) throw new Error('O smoke local exige USE_FIREBASE_EMULATORS=true.');
const auth=await expectJson('/api/auth/login',{
  method:'POST',headers:{'content-type':'application/json','origin':base},
  body:JSON.stringify({password:`${passwordBase}:${login}`}),
});
if(auth.username!==login || !auth.customToken) throw new Error('Login local não retornou usuário/token esperados.');
console.log('Smoke local OK:',{health:health.ok,projectId:config.firebase.projectId,login:auth.username});
