import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const vercel = JSON.parse(fs.readFileSync('vercel.json','utf8'));
const hml = fs.readFileSync('.env.hml.example','utf8');
const prod = fs.readFileSync('.env.production.example','utf8');
const ignore = fs.readFileSync('.vercelignore','utf8');
const configApi = fs.readFileSync('api/config.js','utf8');
const runtime = fs.readFileSync('server/config/runtime-security.js','utf8');
const guide = fs.readFileSync('docs/DEPLOY_LOCAL_HML_PROD_V30.md','utf8');
const verifier = fs.readFileSync('scripts/verify-deployment-artifacts.mjs','utf8');

test('v30 fixes Node 24 and Vercel build uses dist',()=>{
  assert.equal(pkg.engines.node,'24.x');
  assert.equal(vercel.buildCommand,'npm run build');
  assert.equal(vercel.outputDirectory,'dist');
  assert.equal(vercel.framework,null);
});

test('v30 keeps Preview/HML and Production isolated',()=>{
  assert.match(hml,/APP_ENV=homolog/);
  assert.match(prod,/APP_ENV=production/);
  assert.match(hml,/USE_FIREBASE_EMULATORS=false/);
  assert.match(prod,/USE_FIREBASE_EMULATORS=false/);
  assert.match(runtime,/Vercel Production deve usar APP_ENV=production/);
  assert.match(runtime,/Vercel Preview não pode apontar para APP_ENV=production/);
});

test('v30 server secrets are not part of browser config response',()=>{
  assert.match(configApi,/apiKey:/);
  assert.doesNotMatch(configApi,/serviceAccount:\s*process\.env/);
  assert.doesNotMatch(configApi,/LOGIN_RATE_LIMIT_SECRET/);
});

test('v30 excludes envs, service accounts and emulator fixtures from Vercel upload',()=>{
  for(const item of ['.env*','service-account*.json','scripts/dev-users.json','scripts/dev-materials.json','scripts/dev-business-data.json']) {
    assert.ok(ignore.includes(item), item);
  }
});

test('v30 release verifier scans dist for private keys and server secrets',()=>{
  assert.match(verifier,/PRIVATE KEY/);
  assert.match(verifier,/FIREBASE_SERVICE_ACCOUNT_B64/);
  assert.match(verifier,/LOGIN_RATE_LIMIT_SECRET/);
  assert.match(verifier,/outputDirectory/);
});

test('v30 deployment guide documents local HML prod and Vercel Functions split',()=>{
  assert.match(guide,/LOCAL/);
  assert.match(guide,/HML/);
  assert.match(guide,/PROD/);
  assert.match(guide,/Vercel Preview/);
  assert.match(guide,/Vercel Production/);
  assert.match(guide,/Vercel Functions/);
  assert.match(guide,/dist\//);
});

const appCoreV30 = fs.readFileSync('public/legacy/app-core.js','utf8');
const emulatorLauncherV30 = fs.readFileSync('scripts/emulators.mjs','utf8');
const vercelLauncherV30 = fs.readFileSync('scripts/vercel-dev.mjs','utf8');

test('v30 Balanceiro uses the canonical active supplier view and does not accept generic overwrite',()=>{
  const renderStart=appCoreV30.indexOf('function renderBalanceiro()');
  const renderEnd=appCoreV30.indexOf('function balFiltrar', renderStart);
  const renderBlock=appCoreV30.slice(renderStart,renderEnd>renderStart?renderEnd:renderStart+6000);
  assert.match(renderBlock,/getFornAtivos\(\)/);
  assert.doesNotMatch(renderBlock,/FORNECEDORES\.slice\(\)/);
  const popStart=appCoreV30.indexOf('function populateFornSelects()');
  const popEnd=appCoreV30.indexOf('function _fornBuscaResolverCod',popStart);
  const popBlock=appCoreV30.slice(popStart,popEnd);
  assert.doesNotMatch(popBlock,/['\"]bal-novo-forn['\"]/);
});

test('v30 Compra Sucata never treats missing financial totals as paid/NaN',()=>{
  const start=appCoreV30.indexOf('function renderTickets()');
  const end=appCoreV30.indexOf('// ── Save adiantamento',start);
  const block=appCoreV30.slice(start,end);
  assert.match(block,/Number\.isFinite/);
  assert.match(block,/Aguard\. Preço/);
  assert.match(block,/const totalCell=.*'—'/);
  assert.match(block,/const adtCell=.*'—'/);
  assert.match(block,/statusEspecial/);
});

test('v30 contains reproducible Docker local environment without changing cloud architecture',()=>{
  for(const file of ['Dockerfile','compose.yaml','firebase.docker.json','.dockerignore','docs/DOCKER_LOCAL_V30.md']){
    assert.equal(fs.existsSync(file),true,file);
  }
  const dockerfile=fs.readFileSync('Dockerfile','utf8');
  const compose=fs.readFileSync('compose.yaml','utf8');
  const firebaseDocker=fs.readFileSync('firebase.docker.json','utf8');
  assert.match(dockerfile,/node:24-/);
  assert.match(dockerfile,/openjdk-17-jre-headless/);
  assert.match(compose,/127\.0\.0\.1:3000:3000/);
  assert.match(compose,/erp_emulator_data/);
  assert.match(firebaseDocker,/"host": "0\.0\.0\.0"/);
  assert.match(emulatorLauncherV30,/DOCKER_DEV/);
  assert.match(vercelLauncherV30,/0\.0\.0\.0:3000/);
});
