import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {buildSecurityClaims} from '../server/domain/access.js';

test('claims por área distinguem RH, financeiro, comercial e compras',()=>{
  const finance=buildSecurityClaims({tabs:['contas_pagar']});
  assert.equal(finance.canFinance,true);
  assert.equal(finance.canPayroll,false);
  assert.equal(finance.canSales,false);
  const human=buildSecurityClaims({tabs:['ponto']});
  assert.equal(human.canHR,true);
  assert.equal(human.canPayroll,false);
  assert.equal(human.canFinance,false);
  const sales=buildSecurityClaims({tabs:['vendas']});
  assert.equal(sales.canSales,true);
  assert.equal(sales.canInventory,true);
  assert.equal(sales.canPayroll,false);
});

test('administrador inclui permissões por domínio',()=>{
  const admin=buildSecurityClaims({tabs:[]},{admin:true});
  for(const name of ['canPurchasing','canSales','canInventory','canCustomers','canSuppliers','canFinance','canBanking','canPayroll','canHR','canFleet','canContracts','canCoordination']) {
    assert.equal(admin[name],true,name);
  }
});

test('security release não mascara wildcard RTDB e pode bloquear no modo estrito',()=>{
  const code=readFileSync(new URL('../scripts/release-security-check.mjs',import.meta.url),'utf8');
  assert.match(code,/ERP_SECURITY_STRICT/);
  assert.match(code,/RTDB: acesso genérico/);
});
