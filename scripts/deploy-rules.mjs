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
const cli=path.join(process.cwd(),'node_modules','firebase-tools','lib','bin','firebase.js');
if(!fs.existsSync(cli)){ console.error('[DEPLOY] Execute npm install primeiro.'); process.exit(2); }
console.log(`[DEPLOY] Publicando SOMENTE Database/Storage Rules em ${target.toUpperCase()} -> ${project}`);
const child=spawn(process.execPath,[cli,'deploy','--only','database,storage','--project',project],{stdio:'inherit',shell:false,env:process.env});
child.on('exit',(code)=>process.exit(code??1));
child.on('error',(e)=>{console.error(e);process.exit(1);});
