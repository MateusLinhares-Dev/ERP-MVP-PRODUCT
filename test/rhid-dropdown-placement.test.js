import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/modules/phase1/rhid-preview.css',import.meta.url),'utf8');
test('RH iD reposiciona dropdown para cima se faltar espaço e mantém navegação fixa',()=>{
 assert.match(source,/freeDown<270&&freeUp>freeDown/);
 assert.match(source,/list\.dataset\.direction=opensUp\?'up':'down'/);
 assert.match(source,/list\.style\.position='fixed'/);
 assert.match(source,/const items=document\.createElement\('div'\)/);
 assert.match(source,/list\.appendChild\(footer\)/);
 assert.match(css,/\.rhid-picker-items\{[^}]*overflow-y:auto/);
 assert.match(css,/\.rhid-picker-footer\{[^}]*position:sticky;bottom:0/);
 assert.match(source,/document\.addEventListener\?\.\('scroll',_rhidReposicionarBuscas,true\)/);
});
