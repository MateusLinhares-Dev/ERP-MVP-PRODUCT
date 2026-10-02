import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSecurityClaims } from '../server/domain/access.js';
import { assertRuntimeSecurity, assertServiceAccountMatchesProject } from '../server/config/runtime-security.js';
import { assertJsonBody, assertSameOrigin } from '../server/http/http.js';

const read=(p)=>fs.readFileSync(p,'utf8');
const rules=JSON.parse(read('database.rules.json'));
const storage=read('storage.rules');
const vercel=JSON.parse(read('vercel.json'));
const auth=read('server/application/authenticate-user.js');
const core=read('public/legacy/app-core.js');
const pkg=JSON.parse(read('package.json'));

function withEnv(values,fn){
  const previous={};
  for(const [key,value] of Object.entries(values)){
    previous[key]=process.env[key];
    if(value===undefined) delete process.env[key]; else process.env[key]=String(value);
  }
  try{return fn();}finally{
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
}

test('v22 security claims follow explicit module tabs; admin alone does not bypass them',()=>{
  assert.deepEqual(buildSecurityClaims({tabs:['chat','clientes','funcionarios','caminhoes','senhas']},{admin:false}),{
    canChat:true,
    canEmployeeDocs:true,
    canBusinessDocs:true,
    canFleetDocs:true,
    canPasswords:false,
    canSupport:false,
  });
  assert.deepEqual(buildSecurityClaims({tabs:[]},{admin:true}),{
    canChat:false,
    canEmployeeDocs:false,
    canBusinessDocs:false,
    canFleetDocs:false,
    canPasswords:false,
    canSupport:false,
  });
  assert.equal(buildSecurityClaims({tabs:['senhas','suporte_tecnico']},{admin:true}).canPasswords,true);
  assert.equal(buildSecurityClaims({tabs:['senhas','suporte_tecnico']},{admin:true}).canSupport,true);
});

test('v22 login custom token carries compact security claims',()=>{
  assert.match(auth,/buildSecurityClaims/);
  assert.match(auth,/const claims = \{ erpAccess: true, erpUser: selected\.login, admin, \.\.\.securityClaims \}/);
});

test('v22 sensitive RTDB writes are deny-by-default or module-scoped',()=>{
  assert.equal(rules.rules['.read'],false);
  assert.equal(rules.rules['.write'],false);
  assert.equal(rules.rules.erpAuth['.read'],false);
  assert.equal(rules.rules.erpAuth['.write'],false);
  assert.equal(rules.rules.erp.users['.write'],false);
  assert.equal(rules.rules.erp.config['.write'],false);
  assert.match(rules.rules.erp.chat.$messageId['.write'],/canChat/);
  assert.match(rules.rules.erp.chat.$messageId['.write'],/autorLogin/);
  assert.match(rules.rules.erp.chatRead.$uid['.write'],/auth\.uid == \$uid/);
  assert.match(rules.rules.erp.alertState.$uid['.write'],/auth\.uid == \$uid/);
  assert.match(rules.rules.erp.funcDocs['.write'],/canEmployeeDocs/);
  assert.match(rules.rules.erp.empresaDocs['.write'],/canBusinessDocs/);
  assert.match(rules.rules.erp.frotaDocs['.write'],/canFleetDocs/);
  assert.match(rules.rules.erp.senhasCofre['.write'],/admin == true/);
  assert.match(rules.rules.erp.senhasCofre['.write'],/canPasswords/);
});

test('v22 chat writes bind the message to the authenticated ERP login',()=>{
  assert.match(core,/autorLogin:\s*\(typeof cuKey/);
  assert.match(rules.rules.erp.chat.$messageId['.validate'],/autorLogin/);
});

test('v22 Storage separates document namespaces by module claim and keeps 5 MB UI limit',()=>{
  assert.match(storage,/match \/erp-files\/funcDocs/);
  assert.match(storage,/canEmployeeDocs/);
  assert.match(storage,/match \/erp-files\/empresaDocs/);
  assert.match(storage,/canBusinessDocs/);
  assert.match(storage,/match \/erp-files\/frotaDocs/);
  assert.match(storage,/canFleetDocs/);
  assert.match(storage,/5 \* 1024 \* 1024/);
  assert.doesNotMatch(storage,/match \/erp-files\/\{allPaths=\*\*\}/);
});

test('v22 runtime safety rejects demo/emulator mix and wrong Vercel environment',()=>{
  const common={
    FIREBASE_PROJECT_ID:'manuela-hml',
    FIREBASE_DATABASE_URL:'https://manuela-hml-default-rtdb.firebaseio.com',
    FIREBASE_STORAGE_BUCKET:'manuela-hml.firebasestorage.app',
    LOGIN_RATE_LIMIT_SECRET:'12345678901234567890123456789012',
  };
  assert.throws(()=>withEnv({...common,APP_ENV:'homolog',USE_FIREBASE_EMULATORS:'true',VERCEL_ENV:'preview'},()=>assertRuntimeSecurity()),/proibido/);
  assert.throws(()=>withEnv({...common,APP_ENV:'production',USE_FIREBASE_EMULATORS:'false',VERCEL_ENV:'preview'},()=>assertRuntimeSecurity()),/Preview/);
  assert.throws(()=>withEnv({...common,APP_ENV:'homolog',USE_FIREBASE_EMULATORS:'false',FIREBASE_PROJECT_ID:'demo-manuela',VERCEL_ENV:'preview'},()=>assertRuntimeSecurity()),/demo/);
  assert.doesNotThrow(()=>withEnv({...common,APP_ENV:'homolog',USE_FIREBASE_EMULATORS:'false',VERCEL_ENV:'preview'},()=>assertRuntimeSecurity()));
});

test('v22 server refuses service account from another Firebase project',()=>{
  assert.equal(assertServiceAccountMatchesProject({project_id:'manuela-hml'},'manuela-hml'),true);
  assert.throws(()=>assertServiceAccountMatchesProject({project_id:'manuela-prod'},'manuela-hml'),/não pertence/);
});

test('v22 state-changing API helpers require same origin and JSON payload bounds',()=>{
  const req={headers:{origin:'https://erp-hml.example','x-forwarded-host':'erp-hml.example','content-type':'application/json','content-length':'25'},body:{x:1}};
  assert.doesNotThrow(()=>assertSameOrigin(req,{required:true}));
  assert.doesNotThrow(()=>assertJsonBody(req,{maxBytes:100}));
  assert.throws(()=>assertSameOrigin({...req,headers:{...req.headers,origin:'https://evil.example'}},{required:true}),/Origem/);
  assert.throws(()=>assertSameOrigin({...req,headers:{...req.headers,origin:undefined}},{required:true}),/Origem ausente/);
  assert.throws(()=>assertJsonBody({...req,headers:{...req.headers,'content-type':'text/plain'}},{maxBytes:100}),/Content-Type/);
  assert.throws(()=>assertJsonBody({...req,headers:{...req.headers,'content-length':'101'}},{maxBytes:100}),/excede/);
});

test('v22 Vercel response headers include transport, clickjacking, MIME and CSP protections',()=>{
  const headers=Object.fromEntries(vercel.headers[0].headers.map((h)=>[h.key,h.value]));
  assert.match(headers['Strict-Transport-Security'],/max-age=31536000/);
  assert.equal(headers['X-Frame-Options'],'DENY');
  assert.equal(headers['X-Content-Type-Options'],'nosniff');
  assert.equal(headers['Cross-Origin-Opener-Policy'],'same-origin');
  assert.match(headers['Content-Security-Policy'],/frame-ancestors 'none'/);
  assert.match(headers['Content-Security-Policy'],/media-src 'self' data: blob:/);
});

test('v22 release workflow has separate HML/PROD preflight and guarded Rules deployment',()=>{
  for(const file of ['.env.hml.example','.env.production.example','scripts/preflight-env.mjs','scripts/deploy-rules.mjs','scripts/release-security-check.mjs']) assert.equal(fs.existsSync(file),true,file);
  assert.equal(pkg.scripts['preflight:hml'],'node scripts/preflight-env.mjs hml .env.hml');
  assert.equal(pkg.scripts['preflight:prod'],'node scripts/preflight-env.mjs prod .env.production');
  assert.match(pkg.scripts['check:release'],/release-security-check/);
  assert.match(read('scripts/deploy-rules.mjs'),/CONFIRM_PRODUCTION_DEPLOY/);
});

test('v22 health endpoint does not disclose emulator or infrastructure details',()=>{
  const health=read('api/health.js');
  assert.doesNotMatch(health,/databaseUrl|storageBucket|serviceAccount|emulators\s*:/i);
  assert.match(health,/environment/);
});
