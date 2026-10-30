import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('public/modules/help-center/help-center.js');
const sandbox={window:{}};
vm.runInNewContext(source,sandbox);
const help=sandbox.window.ERPHelpCenter;
test('Central inicia sem conteúdo demonstrativo e tem oito categorias reais',()=>{
 assert.equal(help.categories.length,8);
 assert.equal(help.articles().length,0);
 assert.equal(help.search('certificado').length,0);
});
test('central carrega artigos pela API autenticada e renderiza texto com escaping',()=>{
 assert.match(source,/\/api\/help\/articles/);
 assert.match(source,/getIdToken\(\)/);
 assert.match(source,/a\.status==='published'/);
 assert.match(source,/&lt;/);
 assert.doesNotMatch(source,/\.innerHTML\s*=\s*a\.summary/);
});
test('fluxo de documentos da ajuda não injeta conteúdo automático',()=>{
 assert.match(read('api/help/articles.js'),/requireIdentity/);
 assert.match(read('api/help/articles.js'),/engineer:true/);
 assert.match(read('server/domain/help-article.js'),/REVISION_CONFLICT/);
 assert.match(read('database.rules.json'),/"erpHelp"/);
});
test('bootstrap mantém integração antiga e carrega portal de engenharia depois da ajuda',()=>{
 const bootstrap=read('public/app/bootstrap.js');
 assert.ok(bootstrap.indexOf('help-center.js')<bootstrap.indexOf('final-ops.js'));
 assert.ok(bootstrap.indexOf('final-ops.js')<bootstrap.indexOf('engineering.js'));
 assert.match(read('public/modules/final-ops/final-ops.js'),/ERPHelpCenter\?\.render/);
});
