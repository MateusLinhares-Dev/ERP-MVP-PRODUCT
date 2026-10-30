import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const supplierCode = fs.readFileSync(new URL('../public/legacy/supplier-compat.js', import.meta.url), 'utf8');
const pagerCode = fs.readFileSync(new URL('../public/modules/phase1/list-pagination.js', import.meta.url), 'utf8');
const fiscalCode = fs.readFileSync(new URL('../public/modules/phase2/phase2-feedback.js', import.meta.url), 'utf8');

function setup() {
  const elements = new Map();
  class Element {
    constructor(tagName='div') {
      this.tagName = tagName;
      this.children = [];
      this.attributes = {};
      this.events = {};
      this.innerHTML = '';
      this.textContent = '';
      this.value = '';
      this.id = '';
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
    }
    closest(selector) { return selector==='table' && this.tagName==='tbody' ? table : null; }
    insertAdjacentElement(position, element) { if(element.id)elements.set(element.id,element); this[position] = element; }
    appendChild(el) { this.children.push(el); if(el.id) elements.set(el.id,el); return el; }
    append(...nodes) { nodes.forEach(node=>this.appendChild(node)); }
    replaceChildren(...nodes) { this.children=[]; this.append(...nodes); }
    setAttribute(k,v) { this.attributes[k]=v; }
    addEventListener(event,callback) { this.events[event]=callback; }
    fire(event) { this.events[event]?.(); }
    querySelectorAll() { return []; }
  }
  const table = new Element('table');
  const tbody = new Element('tbody');
  const fiscalList = new Element('div');
  const allCheck = new Element('input');
  const filter = { value: '' };
  elements.set('tb-fornecedores',tbody);
  elements.set('chk-all-forn',allCheck);
  elements.set('p2fis-list',fiscalList);
  elements.set('forn-busca-nome',filter);
  const document = {
    getElementById:id=>elements.get(id)||null,
    createElement:tag=>new Element(tag),
    addEventListener:()=>{},
  };
  const suppliers=Array.from({length:1000},(_,i)=>({cod:'F'+String(i+1).padStart(4,'0'),nome:i===999?'Fornecedor Encontrado':'Fornecedor '+String(i+1).padStart(4,'0'),cidade:'Joinville'}));
  let query='';
  const context = {
    document,
    window:{},
    navigator:{},
    setTimeout:()=>{},
    getFornAtivos:()=>suppliers,
    _getFornFiltrados:()=>suppliers.filter(f=>f.nome.toLowerCase().includes(query.toLowerCase())),
    atualizarBtnExcluir:()=>{},
    cu:{admin:true},
  };
  vm.createContext(context);
  vm.runInContext(pagerCode,context);
  context.window.ERPListPager = context.window.ERPListPager;
  vm.runInContext(supplierCode,context);
  return { context, elements, tbody, fiscalList, suppliers, setQuery:value=>{query=value;} };
}

test('Fornecedor de COMPRA usa paginação após supplier-compat substituir o renderizador legado',()=>{
  const {context,elements,tbody,setQuery} = setup();
  const render = context.window.renderTabelaFornecedores;
  render();
  assert.equal((tbody.innerHTML.match(/<tr /g)||[]).length,25);
  assert.match(tbody.innerHTML,/F0001/);
  assert.doesNotMatch(tbody.innerHTML,/F1000/);
  assert.ok(elements.has('erp-list-pager-fornecedores-compra'));
  const pager = elements.get('erp-list-pager-fornecedores-compra');
  assert.match(pager.children[0].textContent,/1–25 de 1000/);
  pager.children[1].children[3].fire('click');
  assert.equal((tbody.innerHTML.match(/<tr /g)||[]).length,25);
  assert.match(tbody.innerHTML,/F0026/);
  assert.doesNotMatch(tbody.innerHTML,/F0001/);
  setQuery('Encontrado');
  context.window.ERPListPager.reset('fornecedores-compra');
  render();
  assert.equal((tbody.innerHTML.match(/<tr /g)||[]).length,1);
  assert.match(tbody.innerHTML,/F1000/);
  assert.match(tbody.innerHTML,/fornAbrirPix|Ficha/);
});

test('Paginação também funciona para cards do cadastro fiscal, sem depender de uma tabela',()=>{
  const {context,elements,fiscalList} = setup();
  assert.match(fiscalCode, /ERPListPager\?\.slice\('fiscal-cadastros',arr,'p2fis-list',renderFiscalRegistry\)/);
  const list=Array.from({length:125},(_,i)=>({id:i+1}));
  let visible=[];
  const render=()=>{visible=context.window.ERPListPager.slice('fiscal-cadastros',list,'p2fis-list',render);};
  render();
  assert.equal(visible.length,25);
  assert.ok(elements.has('erp-list-pager-fiscal-cadastros'));
  const nav=elements.get('erp-list-pager-fiscal-cadastros').children[1];
  nav.children[3].fire('click');
  assert.equal(visible[0].id,26);
  assert.equal(fiscalList.afterend.id,'erp-list-pager-fiscal-cadastros');
});
