import fs from 'node:fs';
import path from 'node:path';

const errors=[];
function read(p){ return fs.readFileSync(path.resolve(p),'utf8'); }
const db=JSON.parse(read('database.rules.json'));
const storage=read('storage.rules');
const vercel=JSON.parse(read('vercel.json'));
const auth=read('server/application/authenticate-user.js');
const core=read('public/legacy/app-core.js');

if(db.rules?.['.read']!==false || db.rules?.['.write']!==false) errors.push('RTDB root precisa continuar deny-by-default');
if(db.rules?.erpAuth?.['.read']!==false || db.rules?.erpAuth?.['.write']!==false) errors.push('erpAuth precisa ser server-only');
if(!String(db.rules?.erp?.chat?.['$messageId']?.['.write']||'').includes('canChat')) errors.push('chat write sem claim canChat');
if(!String(db.rules?.erp?.chatRead?.['$uid']?.['.write']||'').includes('auth.uid == $uid')) errors.push('chatRead não está isolado por UID');
if(!String(db.rules?.erp?.alertState?.['$uid']?.['.write']||'').includes('auth.uid == $uid')) errors.push('alertState não está isolado por UID');
if(!String(db.rules?.erpAudit?.['.read']||'').includes('admin == true')) errors.push('erpAudit precisa ser leitura restrita a admin');
if(!String(db.rules?.erpAudit?.['$eventId']?.['.write']||'').includes('!data.exists()')) errors.push('erpAudit precisa ser append-only');
if(!String(db.rules?.erpAudit?.['$eventId']?.['.write']||'').includes('auth.uid')) errors.push('erpAudit precisa vincular ator ao Firebase UID');
for(const claim of ['canEmployeeDocs','canBusinessDocs','canFleetDocs']) if(!storage.includes(claim)) errors.push(`Storage sem ${claim}`);
if(!storage.includes('5 * 1024 * 1024')) errors.push('Storage sem limite de 5 MB');
if(!auth.includes('buildSecurityClaims')) errors.push('Custom Token sem claims de módulos sensíveis');
if(!core.includes('autorLogin:')) errors.push('Chat não vincula autorLogin à identidade autenticada');
const headerText=JSON.stringify(vercel.headers||[]);
for(const header of ['Strict-Transport-Security','X-Frame-Options','Cross-Origin-Opener-Policy','X-DNS-Prefetch-Control']) if(!headerText.includes(header)) errors.push(`Header ${header} ausente`);
if(!headerText.includes("form-action 'self'")) errors.push('CSP sem form-action self');
if(!headerText.includes('no-referrer')) errors.push('Referrer-Policy precisa ser no-referrer');

if(errors.length){ console.error('[RELEASE SECURITY] REPROVADO'); errors.forEach(e=>console.error(' - '+e)); process.exit(1); }
console.log('[RELEASE SECURITY] OK — regras/claims/headers essenciais presentes.');
