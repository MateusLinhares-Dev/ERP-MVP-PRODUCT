import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/legacy/styles.css',import.meta.url),'utf8');
const start=core.indexOf('function showToast(');
const end=core.indexOf('\n}\n',start);
assert.ok(start>=0&&end>start,'função showToast não localizada');
const source=core.slice(start,end+3);

function simulate(tipo){
  let toast=null;
  const createElement=()=>({children:[],className:'',classList:{add(){},remove(){}},appendChild(child){this.children.push(child);},remove(){}});
  const document={createElement,getElementById:()=>toast,body:{appendChild(el){toast=el;}}};
  const context={document,requestAnimationFrame:fn=>fn(),setTimeout:()=>0};
  runInNewContext(source+`\nshowToast('Teste',${JSON.stringify(tipo)},7000);`,context);
  assert.equal(toast.children.length,1);
  return toast.children[0].className;
}

test('aviso financeiro warning possui a classe warn, com fundo opaco definido no CSS',()=>{
  assert.equal(simulate('warning'),'toast-msg warn');
  assert.match(css,/\.toast-msg\.warn\s*\{\s*background:/);
});
test('showToast mantém as cores de erro, informação e sucesso e admite tipos desconhecidos',()=>{
  for(const kind of ['warn','error','info','success'])assert.equal(simulate(kind),`toast-msg ${kind}`);
  assert.equal(simulate('tipo-novo'),'toast-msg info');
});
