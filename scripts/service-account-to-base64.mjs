import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Uso: npm run encode:service-account -- caminho/da-service-account.json');
  process.exit(2);
}
const file = path.resolve(process.cwd(), input);
if (!fs.existsSync(file)) {
  console.error(`Arquivo não encontrado: ${file}`);
  process.exit(2);
}
let account;
try { account = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch {
  console.error('O arquivo informado não é um JSON válido.');
  process.exit(2);
}
for (const key of ['type','project_id','private_key','client_email']) {
  if (!account[key]) {
    console.error(`Service account inválida: campo ${key} ausente.`);
    process.exit(2);
  }
}
if (account.type !== 'service_account') {
  console.error('O JSON não é uma service account do Google/Firebase.');
  process.exit(2);
}
const encoded = Buffer.from(JSON.stringify(account), 'utf8').toString('base64');
console.log(`\nProjeto detectado: ${account.project_id}`);
console.log('Cole SOMENTE o valor abaixo em FIREBASE_SERVICE_ACCOUNT_B64 na Vercel.');
console.log('Depois apague o JSON do computador quando ele não for mais necessário e nunca faça commit dele.\n');
console.log(encoded);
