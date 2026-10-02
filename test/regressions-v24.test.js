import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');
const core=read('public/legacy/app-core.js');
const guard=read('public/legacy/module-access-guard.js');
const deps=read('public/legacy/access-dependencies.js');
const bootstrap=read('public/app/bootstrap.js');
const manage=read('server/application/manage-user.js');
const devUsers=JSON.parse(read('scripts/dev-users.json'));

const required={
  compra_sucata:['fornecedores'],
  vendas:['clientes'],
  contas_receber:['clientes'],
  fin_clientes:['clientes','adiantamentos','cheques'],
  fluxo_caixa:['contas_pagar','contas_receber','adiantamentos'],
  folha_pagamento:['funcionarios','vales'],
  combustivel_rudnick:['caminhoes'],
  viagem_motorista:['caminhoes','funcionarios'],
  coordenacao:['almoxarifado'],
  canhoto_compra:['compra_sucata','fornecedores'],
};

test('v24 restaurações destrutivas exigem Elaine autenticada',()=>{
  assert.match(core,/function _usuarioAtualEhElaine\(\)/);
  assert.match(core,/String\(cuKey\|\|''\).*==='elaine'/s);
  assert.match(core,/function restaurarHistorico\(histId\)\{\s*if\(!_usuarioAtualEhElaine\(\)\)/);
  assert.match(core,/async function restaurarSnapshot\(dataKey\)\{\s*if\(!_usuarioAtualEhElaine\(\)\)/);
  assert.match(core,/function restaurarFornecedores\(\)\{\s*if\(!_usuarioAtualEhElaine\(\)\)/);
  assert.match(core,/async function supImportarBackup\(event\)\{\s*if\(!_usuarioAtualEhElaine\(\)\)/);
  assert.match(core,/const podeRestaurar = _usuarioAtualEhElaine\(\)/);
});

test('v24 áreas administrativas sensíveis são exclusivas da Elaine',()=>{
  assert.match(guard,/OWNER_ONLY_TABS=new Set\(\['usuarios','suporte_tecnico','senhas'\]\)/);
  assert.match(guard,/OWNER_ONLY_TABS\.has\(tab\) && !isElaineOwner\(\)/);
  assert.match(deps,/ownerOnly:true/);
  assert.match(deps,/Apenas a Elaine pode criar usuários/);
  assert.match(deps,/Apenas a Elaine pode alterar acessos de usuários/);
  assert.match(deps,/Apenas a Elaine pode excluir usuários/);
  assert.match(deps,/Apenas a Elaine pode redefinir senhas de outros usuários/);
});

test('v24 novos usuários continuam não podendo virar admin',()=>{
  assert.match(manage,/admin:false/);
  assert.match(manage,/if\(current\.admin===true && newLogin!==login\)/);
});

test('v24 mapa cobre todos os 43 módulos cadastrados',()=>{
  const tabsBlock=core.match(/const TABS_CFG = \{([\s\S]*?)\n\};/)?.[1]||'';
  const tabs=[...tabsBlock.matchAll(/^\s*([a-zA-Z0-9_]+)\s*:/gm)].map(m=>m[1]);
  const mapBlock=deps.match(/var MAP=\{([\s\S]*?)\n  \};/)?.[1]||'';
  const keys=[...mapBlock.matchAll(/^\s*([a-zA-Z0-9_]+):\{/gm)].map(m=>m[1]);
  assert.equal(tabs.length,43);
  assert.deepEqual(new Set(keys),new Set(tabs));
});

test('v24 perfis padrão não violam dependências obrigatórias',()=>{
  for(const [login,profile] of Object.entries(devUsers)){
    const tabs=new Set(profile.tabs||[]);
    for(const [tab,needs] of Object.entries(required)){
      if(!tabs.has(tab)) continue;
      for(const need of needs){
        assert.ok(tabs.has(need),`${login}: ${tab} requer ${need}`);
      }
    }
  }
});

test('v24 interface de usuários explica, corrige e bloqueia dependências faltantes',()=>{
  assert.match(deps,/Dependências dos módulos/);
  assert.match(deps,/Adicionar necessárias/);
  assert.match(deps,/Faltam dependências obrigatórias/);
  assert.match(deps,/Relações recomendadas/);
  assert.match(deps,/validateSelection/);
  assert.match(deps,/originalSaveNew/);
  assert.match(deps,/originalSaveEdit/);
});

test('v24 relações de dados não ampliam permissões automaticamente',()=>{
  assert.match(deps,/related:\['fornecedores','clientes','balanceiro','estoque','agenda_entregas'\]/);
  assert.match(deps,/Recomendada = compartilha dados, mas não amplia acesso automaticamente/);
});

test('v24 carregamento do de-para ocorre depois dos overrides seguros',()=>{
  const secure=bootstrap.indexOf("/legacy/security-overrides.js");
  const dep=bootstrap.indexOf("/legacy/access-dependencies.js");
  assert.ok(secure>=0 && dep>secure);
});
