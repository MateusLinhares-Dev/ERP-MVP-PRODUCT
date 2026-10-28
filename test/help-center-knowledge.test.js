import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync(new URL('../public/modules/help-center/help-center.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/modules/help-center/help-center.css',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../public/app/bootstrap.js',import.meta.url),'utf8');
const integration=fs.readFileSync(new URL('../public/modules/final-ops/final-ops.js',import.meta.url),'utf8');
const sandbox={window:{}};
vm.runInNewContext(src,sandbox,{filename:'help-center.js'});
const help=sandbox.window.ERPHelpCenter;

test('central de ajuda tem conteúdo próprio em oito categorias sem duplicar identificadores',()=>{
 assert.equal(help.categories.length,8);
 assert.ok(help.articles.length>=38);
 assert.equal(new Set(help.articles.map(a=>a.id)).size,help.articles.length);
 for(const article of help.articles){
   assert.ok(article.steps.length>=3,article.id);
   assert.ok(help.categories.some(c=>c.id===article.cat),article.id);
   assert.ok(article.title.length>15,article.id);
 }
});
test('busca ignora acentos, entende erros e prioriza títulos',()=>{
 assert.equal(help.search('certificado')[0].id,'certificado');
 assert.ok(help.search('importar zip').some(a=>a.id==='xml-zip'));
 assert.ok(help.search('permissão negada').some(a=>a.id==='permissao-negada'));
 assert.ok(help.search('balanca').some(a=>a.id==='balanca'));
 assert.equal(help.search('xxxxxxxx-nao-existe').length,0);
});
test('busca permite filtragem por categoria sem mostrar outra área',()=>{
 const found=help.search('','fiscal');
 assert.ok(found.length>4);
 assert.ok(found.every(a=>a.cat==='fiscal'));
});
test('conteúdo alerta sobre duplicidade, origem e autorização',()=>{
 const articles=help.articles;
 for(const id of ['certificado','contrato-erro','xml-zip','permissao-negada']){
   const a=articles.find(x=>x.id===id);
   assert.ok(a?.warning,id);
 }
 assert.match(articles.find(a=>a.id==='xml-zip').steps.join(' '),/Importar XML/);
 assert.match(articles.find(a=>a.id==='contrato-criar').steps.join(' '),/Contas a Pagar/);
});
test('bootstrap carrega central antes do módulo final e integra sem alterar as regras de acesso',()=>{
 assert.ok(bootstrap.indexOf('/modules/help-center/help-center.js')<bootstrap.indexOf('/modules/final-ops/final-ops.js'));
 assert.match(bootstrap,/help-center\/help-center\.css/);
 assert.match(integration,/global\.ERPHelpCenter\?\.render/);
 assert.match(src,/global\.erpCanAccessTab\?\.\(nav\) === true/);
 assert.doesNotMatch(src,/(database\(\)|firebase\.database\(|\.ref\(['"]erp\/|fetch\()/);
 assert.match(css,/#tab-help_center/);
});
