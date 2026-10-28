import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const sync=fs.readFileSync(path.join(root,'public/legacy/firebase-sync.js'),'utf8');
const match=/const _ERP_NOS_SINCRONIZADOS\s*=\s*\[([\s\S]*?)\];/.exec(sync);
if(!match)throw new Error('Sincronizador sem lista explícita de nós');
const nodes=[...match[1].matchAll(/'([^']+)'/g)].map((item)=>item[1]);
const current=JSON.parse(fs.readFileSync(path.join(root,'docs/database.rules.baseline.json'),'utf8')); 

// Apenas permissões por domínio. Mapeie novos nós antes de gerar regras novas.
// Um módulo pode precisar de várias áreas de acesso para executar fluxos integrados.
const groups={
  canInventory:`metais estoque estoqueDeleted bags bagsMov bagsMovDeleted`,
  canPurchasing:`tickets ticketsDeleted adtPorFornDeleted chequesPorFornDeleted saldoDevedor saldoDevedorDeleted adtItensDeleted chequeItensDeleted historico historicoDeleted`,
  canSuppliers:`precosForn fornecedores fornecedoresDeleted fornDeleted fornVeiculos fornDespesa fornDespesaDeleted`,
  canCustomers:`precosCli clientes clientesDeleted`,
  canFinance:`custosCasa contasPagar contasPagarDeleted contasReceber contasReceberDeleted saldos adiantamentos cheques fcSaldoIni fcSaldoIniDeleted fcLanc adtCli chequesCli`,
  canSales:`vendas vendasDeleted`,
  canBanking:`bancos bancosDeleted lancBanco lancBancoDeleted`,
  canHR:`funcEdit funcEditDel ponto pontoDeleted pontoBatidas pontoBatidasDeleted vales valesDeleted advertencias advertenciasDeleted epi epiDeleted`,
  canPayroll:`folha`,
  canFleet:`veicPess manutPess tanque tanqueDeleted tanqueDeletedV2 viagemLimite viagem viagemDeleted combustivel combustivelDeleted frota frotaDeleted manutencao manutencaoDeleted`,
  canContracts:`contratos contratosDeleted`,
  canCoordination:`coordNotas coordNotasDeleted coordFuncObs almoxa almoxaDeleted almoxaMov almoxaMovDeleted reunioes reunioesDeleted afazeres afazeresDeleted agendaEntregas agendaEntregasDeleted`,
  canBusinessDocs:`docsEmpresas docsEmpresasDeleted`,
  canFiscalRead:`fiscal fiscalApur`,
  canFinanceExtra:`despGrupo despGrupoDeleted`,
  canTasks:`afazeres afazeresDeleted`,
  canDeliveryAgenda:`agendaEntregas agendaEntregasDeleted`
};
const auth='auth != null && auth.token.erpAccess == true';
const mapped=new Map();
for(const [claim,list] of Object.entries(groups)){
  for(const node of list.split(/\s+/).filter(Boolean)){
    if(!mapped.has(node))mapped.set(node,new Set());
    mapped.get(node).add(claim==='canFinanceExtra'?'canFinance':claim);
  }
}
const explicit=new Set(Object.keys(current.rules.erp).filter((key)=>!key.startsWith('$')));
const metadata=new Set(['_ts','_user','_untomb']);
// Acessos diretos do legado que não passam pelo sincronizador global.
const directNodes={
  listaCompras:{read:'canShoppingList',write:'canShoppingList'},
  chequesControle:{read:'canFinance',write:'canFinance'},
  chequesControle_del:{read:'canFinance',write:'canFinance'},
  ticketsDeletedV2:{read:'canPurchasing',write:'canPurchasing'},
  advanceBackups:{read:'admin',write:'admin'}
};
const uncovered=nodes.filter(node=>!explicit.has(node)&&!metadata.has(node)&&!mapped.has(node));
if(uncovered.length)throw new Error(`Nós sem classificação: ${uncovered.join(', ')}`);
for(const node of mapped.keys()){
  if(!nodes.includes(node))throw new Error(`Mapeamento obsoleto: ${node}`);
}
const candidate=structuredClone(current);
// Matrícula de cursos e documentos é gerenciada somente por API autenticada.
// O Firebase Admin SDK escreve em erpTraining; clientes não acessam os dados diretamente.
candidate.rules.erpTraining={'.read':false,'.write':false};
delete candidate.rules.erp.$node;
for(const node of nodes){
  if(explicit.has(node))continue;
  if(metadata.has(node)){
    candidate.rules.erp[node]={'.read':auth,'.write':node==='_untomb'?`${auth} && auth.token.admin == true`:auth};
    if(node==='_user')candidate.rules.erp[node]['.validate']="newData.isString() && newData.val() == auth.token.erpUser";
    if(node==='_ts')candidate.rules.erp[node]['.validate']="newData.isNumber() && newData.val() >= now - 600000 && newData.val() <= now + 600000";
    continue;
  }
  const claims=[...mapped.get(node)];
  const reading=claims.some(claim=>claim==='canFiscalRead')
    ? claims.map(claim=>claim==='canFiscalRead'?`auth.token.canFiscalRead == true`:`auth.token.${claim} == true`)
    : claims.map(claim=>`auth.token.${claim} == true`);
  const writing=claims.map(claim=>claim==='canFiscalRead'?`auth.token.canFiscalWrite == true`:`auth.token.${claim} == true`);
  candidate.rules.erp[node]={
    '.read':`${auth} && (${reading.join(' || ')})`,
    '.write':`${auth} && (${writing.join(' || ')})`
  };
}
for(const [node,access] of Object.entries(directNodes)){
  if(candidate.rules.erp[node])throw new Error(`Regra direta duplicada: ${node}`);
  const grant=(perm)=>perm==='admin'?`${auth} && auth.token.admin == true`:`${auth} && auth.token.${perm} == true`;
  candidate.rules.erp[node]={'.read':grant(access.read),'.write':grant(access.write)};
}
// Categorias de documentos são acessadas diretamente pelo Phase1Store.
// Restringir esta coleção ao domínio de documentos e validar cada cadastro;
// não habilitar o acesso genérico do nó pai.
candidate.rules.erp.documentCategories={
  '.read':`${auth} && auth.token.canBusinessDocs == true`,
  '$categoryId':{
    '.write':`${auth} && auth.token.canBusinessDocs == true`,
    '.validate':"newData.hasChildren(['id','name']) && newData.child('id').isString() && newData.child('id').val() == $categoryId && newData.child('name').isString() && newData.child('name').val().length > 0 && newData.child('name').val().length <= 120 && (!newData.child('createdAt').exists() || (newData.child('createdAt').isString() && newData.child('createdAt').val().length <= 60))"
  }
};
// Conciliação bancária: importações e eventos imutáveis e vinculados ao ator.
// Nenhuma permissão de escrita no nó pai: a criação só ocorre sob $entryId/$eventId.
const banking=`${auth} && auth.token.canBanking == true`;
const actor=`newData.child('uid').val() == auth.uid && newData.child('importedBy').val() == auth.token.erpUser`;
const eventActor=`newData.child('uid').val() == auth.uid && newData.child('actor').val() == auth.token.erpUser`;
const timeWindow=(field)=>`newData.child('${field}').isNumber() && newData.child('${field}').val() >= now - 600000 && newData.child('${field}').val() <= now + 600000`;
candidate.rules.erp.bankReconciliationImports={
  '.read':banking,
  '$bankCode':{
    '$entryId':{
      '.write':`${banking} && !data.exists() && newData.exists()`,
      '.validate':`newData.hasChildren(['id','bankCode','date','amountCents','description','fitid','importedBy','uid','importedAt']) && newData.child('id').val() == $entryId && newData.child('bankCode').val() == $bankCode && newData.child('date').isString() && newData.child('date').val().matches(/^\\d{4}-\\d{2}-\\d{2}$/) && newData.child('amountCents').isString() && newData.child('amountCents').val().matches(/^-?[0-9]{1,15}$/) && newData.child('description').isString() && newData.child('description').val().length > 0 && newData.child('description').val().length <= 240 && newData.child('fitid').isString() && newData.child('fitid').val().length <= 128 && newData.child('importedBy').isString() && newData.child('uid').isString() && ${actor} && ${timeWindow('importedAt')}`
    }
  }
};
candidate.rules.erp.bankReconciliationEvents={
  '.read':banking,
  '$bankCode':{
    '$eventId':{
      '.write':`${banking} && !data.exists() && newData.exists()`,
      '.validate':`newData.hasChildren(['id','importId','status','targetKind','targetId','label','category','costCenter','notes','actor','uid','createdAt']) && newData.child('id').val() == $eventId && root.child('erp/bankReconciliationImports/'+$bankCode+'/'+newData.child('importId').val()).exists() && (newData.child('status').val() == 'reconciled' || newData.child('status').val() == 'classified' || newData.child('status').val() == 'reversed') && (newData.child('targetKind').val() == 'bankEntry' || newData.child('targetKind').val() == 'payable' || newData.child('targetKind').val() == 'receivable' || newData.child('targetKind').val() == 'manual' || newData.child('targetKind').val() == 'none') && newData.child('targetId').isString() && newData.child('targetId').val().length <= 120 && newData.child('label').isString() && newData.child('label').val().length <= 240 && newData.child('category').isString() && newData.child('category').val().length <= 90 && newData.child('costCenter').isString() && newData.child('costCenter').val().length <= 90 && newData.child('notes').isString() && newData.child('notes').val().length <= 500 && newData.child('actor').isString() && newData.child('uid').isString() && ${eventActor} && ${timeWindow('createdAt')} && (newData.child('status').val() != 'classified' || newData.child('targetKind').val() != 'manual' || newData.child('category').val().length > 0)`
    }
  }
};

// Ledger de decisões avançadas. Apenas a API com credencial de serviço pode escrever.
// Frontend possui leitura específica à área bancária, não escrita.
candidate.rules.erp.bankReconciliationState={
  '.read':banking,
  '.write':false
};

// Coleções de tombstones V2 são lidas pela função legada de sincronização.
// A escrita V2 fica reservada ao administrador, exceto ticketsDeletedV2.
const legacyCore=fs.readFileSync(path.join(root,'public/legacy/app-core.js'),'utf8');
const legacyNames=[...new Set([...legacyCore.matchAll(/_criarSincroniaPorChave\(\s*['"]([^'"]+)/g)].map(m=>m[1]))];
for(const name of legacyNames){
  const reference=name==='alxNotas'?'coordNotas':name;
  const sourceRule=candidate.rules.erp[reference];
  if(!sourceRule)throw new Error(`Sincronizador legado sem domínio: ${name}`);
  for(const suffix of ['Deleted','DeletedV2']){
    const key=name+suffix;
    if(candidate.rules.erp[key])continue;
    candidate.rules.erp[key]={
      '.read':sourceRule['.read'],
      '.write':`${auth} && auth.token.admin == true`
    };
  }
  if(!candidate.rules.erp[name]){
    candidate.rules.erp[name]={'.read':sourceRule['.read'],'.write':sourceRule['.write']};
  }
}
// Protege também o marcador de versão usado pelo frontend, não coberto pelo array.
candidate.rules.erp._appBuild={'.read':auth,'.write':`${auth} && auth.token.admin == true`};
const out=path.join(root,'database.rules.json');
fs.writeFileSync(out,JSON.stringify(candidate,null,2)+'\n');
fs.writeFileSync(path.join(root,'docs','database.rules.candidate.json'),JSON.stringify(candidate,null,2)+'\n');
// A mesma fonte define os acessos do sincronizador e as rules implantáveis.
const policy={version:1,nodes:{}};
const special=(value)=>value===false?{mode:'none',claims:[]}:
  value===undefined?{mode:'none',claims:[]}:
  String(value).includes('auth.token.admin == true')?{mode:'admin',claims:[]}:
  [...String(value).matchAll(/auth\.token\.(can[A-Za-z]+)\s*==\s*true/g)].map(match=>match[1]);
for(const node of nodes){
  const rule=candidate.rules.erp[node]||{};
  const get=(side)=>{
    const v=special(rule[side]);
    if(Array.isArray(v))return {mode:'claims',claims:v};
    if(v.mode==='none')return v;
    if(v.mode==='admin')return v;
    return {mode:'erp',claims:[]};
  };
  policy.nodes[node]={read:get('.read'),write:get('.write')};
  for(const side of ['read','write']){
    const value=rule['.'+side];
    if(typeof value==='string' && !String(value).includes('admin == true') && !String(value).includes('can') && value.includes('erpAccess == true'))
      policy.nodes[node][side]={mode:'erp',claims:[]};
  }
}
fs.writeFileSync(path.join(root,'public/app/rtdb-collection-policy.json'),JSON.stringify(policy,null,2)+'\n');
console.log(`Regras ativas e política de sincronização geradas: ${nodes.length} nós, sem wildcard.`);
