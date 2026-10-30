import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appCore = fs.readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../public/modules/phase1/list-pagination.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../public/app/bootstrap.js', import.meta.url), 'utf8');
const usability = fs.readFileSync(new URL('../public/modules/phase1/phase1-usability.js', import.meta.url), 'utf8');

function makeDom() {
  const ids = new Map();
  class Element {
    constructor(tag='div') {
      this.tagName = tag; this.children=[]; this.events={}; this.attributes={}; this.value=''; this.disabled=false;
      this.textContent=''; this.id=''; this.hidden=false;
    }
    appendChild(el) { this.children.push(el); if(el.id) ids.set(el.id, el); return el; }
    append(...children) { children.forEach(x=>this.appendChild(x)); }
    replaceChildren(...children) {this.children=[];this.append(...children);}
    setAttribute(name, value) {this.attributes[name]=value;}
    addEventListener(name, cb) {this.events[name]=cb;}
    fire(name) {this.events[name]?.();}
    insertAdjacentElement(pos, el) { if(el.id) ids.set(el.id,el); this[pos]=el; }
    closest(selector) { return selector === 'table' ? table : null; }
  }
  const table=new Element('table');
  const tbody=new Element('tbody');
  ids.set('tb-test',tbody);
  const document={getElementById:id=>ids.get(id)||null,createElement:tag=>new Element(tag)};
  return {document,ids,table};
}

function setup() {
  const {document,ids} = makeDom();
  const win={};
  vm.runInNewContext(source,{window:win,document});
  return {pager:win.ERPListPager,ids};
}

test('Paginador limita o DOM a 25 de 1.000 registros e mantém navegação, limites e busca',()=>{
  const {pager,ids}=setup();
  const data=Array.from({length:1000},(_,i)=>({id:i+1,nome:i===999?'Fornecedor exclusivo':'Fornecedor '+(i+1)}));
  let onPage=[];
  const render=()=>{onPage=pager.slice('test',data,'tb-test',render,{searchable:true,text:r=>r.nome});};
  render();
  assert.equal(onPage.length,25);
  assert.equal(onPage[0].id,1);
  assert.match(ids.get('erp-list-pager-test').children[0].textContent,/1–25 de 1000/);
  const nav=ids.get('erp-list-pager-test').children[1];
  nav.children[3].fire('click');
  assert.equal(onPage[0].id,26);
  assert.equal(pager.snapshot('test').page,2);
  const search=ids.get('erp-list-pager-test-search');
  search.value='exclusivo';search.fire('input');
  assert.equal(pager.snapshot('test').page,1);
  assert.deepEqual(onPage.map(x=>x.id),[1000]);
  search.value='';search.fire('input');
  const size=ids.get('erp-list-pager-test').children[1].children[0].children[0];
  size.value='50';size.fire('change');
  assert.equal(onPage.length,50);
  assert.equal(pager.snapshot('test').size,50);
});

test('Múltiplas tabelas mantêm paginação independente e preservam identidade',()=>{
  const {pager,ids}=setup();
  ids.set('tb-supplier',{closest:()=>({insertAdjacentElement:(_,el)=>{if(el.id)ids.set(el.id,el);}})});
  const suppliers=Array.from({length:53},(_,i)=>({id:'F'+String(i+1),nome:'Fornecedor '+i}));
  const accounts=Array.from({length:45},(_,i)=>({id:'C'+String(i+1),nome:'Cliente '+i}));
  const pageF=()=>pager.slice('supplier',suppliers,'tb-supplier',pageF);
  pageF();
  const pageC=()=>pager.slice('client',accounts,'missing',pageC);
  pageC();
  ids.get('erp-list-pager-supplier').children[1].children[3].fire('click');
  assert.equal(pager.snapshot('supplier').page,2);
  assert.equal(pager.snapshot('client').page,1);
  assert.equal(pageF()[0],suppliers[25]);
  assert.equal(pageC()[0],accounts[0]);
  suppliers.length=2;
  assert.equal(pageF().length,2);
  assert.equal(pager.snapshot('supplier').page,1);
});

test('Listas do ERP paginam na origem e não escondem 1.000 linhas de DOM',()=>{
  const functions=['renderTabelaFornecedores','renderClientes','renderFornDespesa','renderTbFuncionarios','renderVales','renderVendas','renderContasReceber','renderContasPagar'];
  for(const fun of functions){
    const start=appCore.indexOf('function '+fun+'(');
    assert.ok(start>0, `${fun} não encontrado`);
    const end=appCore.indexOf('\nfunction ',start+10);
    const part=appCore.slice(start,end>start?end:start+10000);
    assert.match(part,/_erpPaginarDados\(/, `${fun} deve paginar antes de montar as linhas`);
  }
  assert.match(bootstrap,/loadClassic\('\/modules\/phase1\/list-pagination\.js'\).*loadClassic\('\/legacy\/app-core\.js'\)/s);
  assert.doesNotMatch(usability,/tableSearch\('tab-fornecedores'/);
  assert.match(appCore,/const idx=VENDAS_DB\.indexOf\(v\)/);
  assert.match(appCore,/const realIdx=CLIENTES\.indexOf\(c\)/);
  assert.match(appCore,/FORNECEDORES_DESPESA\.indexOf\(f\)/);
  assert.match(appCore,/const idx=CONTAS_RECEBER\.indexOf\(c\)/);
});
