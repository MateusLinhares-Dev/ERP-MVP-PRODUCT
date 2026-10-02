import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
function allFiles(dir){
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...allFiles(p)); else out.push(p);
  }
  return out;
}

test('public bundle does not contain legacy Firebase secrets/passwords',()=>{
  const files=allFiles(path.join(root,'public'));
  const source=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
  assert.equal(/AIzaSy[A-Za-z0-9_-]{20,}/.test(source),false,'Firebase API key hardcoded in public source');
  assert.equal(/(?:senha|password)\s*:\s*['"][^'"]{4,}['"]/i.test(source),false,'plaintext password-like literal found in public source');
  assert.equal(/\.erp@manuelametais\.com/i.test(source),false,'legacy Firebase auth e-mail map found in public source');
});

test('HTML shell loads the secure bootstrap',()=>{
  const html=fs.readFileSync(path.join(root,'public/index.template.html'),'utf8');
  assert.match(html,/type="module" src="\/app\/bootstrap\.js"/);
  assert.equal(html.includes('firebase-app-compat.js'),false,'Firebase SDK should be loaded by runtime bootstrap');
});
