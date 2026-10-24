import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const target=String(process.argv[2]||'').toLowerCase();
const isProd=target==='prod'||target==='production';
const isHml=['hml','homolog','homologacao','staging'].includes(target);
if(!isProd&&!isHml){ console.error('Uso: npm run deploy:rules:hml | npm run deploy:rules:prod'); process.exit(2); }
const envKey=isProd?'FIREBASE_PROD_PROJECT_ID':'FIREBASE_HML_PROJECT_ID';
const project=String(process.env[envKey]||'').trim();
if(!project){ console.error(`[DEPLOY] Configure ${envKey} no terminal.`); process.exit(2); }
if(/^demo-/i.test(project)){ console.error('[DEPLOY] Projeto demo-* recusado.'); process.exit(2); }
if(isProd && process.env.CONFIRM_PRODUCTION_DEPLOY!=='MANUELA_PROD'){
  console.error('[DEPLOY] Produção bloqueada. Defina CONFIRM_PRODUCTION_DEPLOY=MANUELA_PROD conscientemente.');
  process.exit(2);
}
// Publicar regras genéricas mantém acesso transversal a dados do cliente.
// Nunca fazer deploy acidental de um wildcard sem revisão explícita.
const rules=JSON.parse(fs.readFileSync(path.join(process.cwd(),'database.rules.json'),'utf8'));
const generic=rules.rules?.erp?.$node;
if(generic && (String(generic['.read']||'').includes('erpAccess == true') || String(generic['.write']||'').includes('erpAccess == true'))){
  if(isProd || process.env.ALLOW_INSECURE_HML_RULES!=='1'){
    console.error('[DEPLOY] BLOQUEADO: erp/$node possui acesso genérico. Faça a migração granular e teste no Emulator.');
    if(isHml)console.error('[DEPLOY] Somente para inspeção controlada, defina ALLOW_INSECURE_HML_RULES=1. Não use em produção.');
    process.exit(2);
  }
  console.warn('[DEPLOY] ATENÇÃO: regras legadas genéricas permitidas explicitamente apenas em HML.');
}
const candidate=JSON.parse(fs.readFileSync(path.join(process.cwd(),'docs','database.rules.candidate.json'),'utf8'));
const policy=JSON.parse(fs.readFileSync(path.join(process.cwd(),'public','app','rtdb-collection-policy.json'),'utf8'));
if(JSON.stringify(rules)!==JSON.stringify(candidate)||policy.version!==1||Object.keys(policy.nodes||{}).length!==99){
  console.error('[DEPLOY] BLOQUEADO: regras ou catálogo divergentes. Execute npm run generate:rules:candidate.');
  process.exit(2);
}
if(isHml && process.env.CONFIRM_HML_FRONTEND_UPDATED!=='1'){
  console.error('[DEPLOY] BLOQUEADO: publique primeiro o frontend/API HML atualizado, faça novo login e defina CONFIRM_HML_FRONTEND_UPDATED=1.');
  process.exit(2);
}
const cli=path.join(process.cwd(),'node_modules','firebase-tools','lib','bin','firebase.js');
if(!fs.existsSync(cli)){ console.error('[DEPLOY] Execute npm install primeiro.'); process.exit(2); }
console.log(`[DEPLOY] Publicando SOMENTE Database/Storage Rules em ${target.toUpperCase()} -> ${project}`);
const child=spawn(process.execPath,[cli,'deploy','--only','database,storage','--project',project],{stdio:'inherit',shell:false,env:process.env});
child.on('exit',(code)=>process.exit(code??1));
child.on('error',(e)=>{console.error(e);process.exit(1);});
