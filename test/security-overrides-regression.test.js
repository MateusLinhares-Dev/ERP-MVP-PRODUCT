import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../public/legacy/security-overrides.js',import.meta.url),'utf8');

function load(overrides={}){
  let html='';
  const grid={set innerHTML(value){html=value;},get innerHTML(){return html;},contains(){return true;}};
  const users={
    'test-user':{name:'<img src=x onerror=alert(1)>',role:'Pessoa & Equipe',descricao:'<script>alert("xss")</script>',tabs:['clientes','fiscal'],admin:false},
    'admin-user':{name:'Admin',role:'Financeiro',descricao:'',tabs:['usuarios'],admin:true}
  };
  const ctx={
    window:{},
    USERS:users,
    TABS_CFG:{clientes:{label:'Clientes'},fiscal:{label:'Fiscal'},usuarios:{label:'Usuários'}},
    _USERS_DEL:[],
    localStorage:{setItem(){}},
    document:{getElementById(id){return id==='users-grid'?grid:null;}},
    setTimeout(){},
    console:{warn(){}},
    ...overrides
  };
  ctx.window=ctx;
  runInNewContext(source,ctx, {timeout:3000});
  return {ctx,grid,html:()=>html};
}

test('security-overrides executa em strict sem ReferenceError togglePwd',()=>{
  const {ctx}=load();
  assert.equal(typeof ctx.togglePwd,'function');
  assert.equal(typeof ctx.populateUsers,'function');
  assert.equal(typeof ctx.salvarNovoUsuario,'function');
  assert.equal(typeof ctx.rodCancelarPesagem,'function');
});

test('cadastro não injeta texto de usuário ou handler arbitrário no HTML',()=>{
  const {ctx,html}=load();
  ctx.populateUsers();
  const value=html();
  assert.doesNotMatch(value,/<script|<img|\sonclick=/i);
  assert.match(value,/&lt;script&gt;/);
  assert.match(value,/Pessoa &amp; Equipe/);
  assert.match(value,/data-erp-user-action="edit"/);
  assert.match(value,/Permissões \(2\)/);
  assert.doesNotMatch(value,/value=".*password|input.*type="password"/i);
});

test('ações de usuário usam índice validado, não JavaScript interpolado',()=>{
  let edited='';let changed='';
  const {ctx,grid}=load();
  ctx.novoUsuario=()=>{};
  ctx.populateUsers();
  ctx.editUsuario=(key)=>{edited=key;};
  ctx.mudarSenha=(key)=>{changed=key;};
  function click(action,index){
    const card={dataset:{erpUserIndex:String(index)}};
    const button={dataset:{erpUserAction:action},closest(selector){return selector==='[data-erp-user-index]'?card:this;}};
    grid.onclick({target:{closest(){return button;}}});
  }
  click('edit',0);
  click('password',1);
  click('edit',999);
  assert.equal(edited,'test-user');
  assert.equal(changed,'admin-user');
});
