/* Inventário estático de chaves do sincronizador e pontos cegos das Rules. */
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const sync=fs.readFileSync(path.join(root,'public/legacy/firebase-sync.js'),'utf8');
const rules=JSON.parse(fs.readFileSync(path.join(root,'database.rules.json'),'utf8'));
const match=/const _ERP_NOS_SINCRONIZADOS\s*=\s*\[([\s\S]*?)\];/.exec(sync);
if(!match)throw new Error('Lista de sincronização RTDB não encontrada.');
const names=Array.from(match[1].matchAll(/'([^']+)'/g),m=>m[1]);
const specific=new Set(Object.keys(rules.rules.erp).filter(key=>!key.startsWith('$')));
const wildcard=rules.rules.erp.$node;
const authorized=names.filter(node=>specific.has(node));
const overbroad=names.filter(node=>!specific.has(node));
const content=[
'# Inventário automático de segurança — Realtime Database',
'',`Gerado: ${new Date().toISOString().slice(0,10)}. Inspeção estática, não substitui testes no Emulator.`,
'',`- Coleções sincronizadas: **${names.length}**`,`- Nós com regra explícita: **${authorized.length}**`,`- Nós ainda abrangidos pelo wildcard ou sem regra explícita: **${overbroad.length}**`,
'', '## Nós com regra explícita',...authorized.map(key=>'- `erp/'+key+'`'),
'', '## Nós que exigem autorização por módulo',...overbroad.map(key=>'- `erp/'+key+'`'),
'', '## Observações',
'- Regras filhas não podem reduzir uma permissão concedida por uma regra pai.',
'- O sincronizador `firebase-sync.js` consulta os nós independentemente da aba autorizada; alterar as rules isoladamente pode interromper o carregamento e o salvamento.',
'- A próxima migração de segurança deve separar leitura/gravação por domínio e testar com usuários restritos antes de ativar rules granulares.',
'- Conferir também gravações feitas fora do sincronizador, inclusive API serverless e Storage.',
''];
const target=path.join(root,'docs','inventario-acesso-rtdb.md');
fs.writeFileSync(target,content.join('\n'));
console.log(`Inventário gravado em docs/inventario-acesso-rtdb.md (${names.length} nós, ${overbroad.length} sem regra explícita).`);
