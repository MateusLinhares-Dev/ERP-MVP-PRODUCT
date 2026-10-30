(function(global){
'use strict';

const legacy={
  openModal:global.om,
  editSupplier:global.editFornecedor,
  editClient:global.editCliente,
  editEmployee:global.editFuncionario,
  saveNewSupplier:global.salvarNovoFornecedor,
  saveSupplier:global.salvarEditFornecedor,
  saveNewClient:global.salvarNovoCliente,
  saveClient:global.salvarEditCliente,
  saveNewEmployee:global.salvarNovoFuncionario,
  saveEmployee:global.salvarEditFuncionario
};

function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function val(id){return String(document.getElementById(id)?.value||'').trim();}
function parseMoney(value){
  let raw=String(value||'').trim().replace(/R\$/gi,'').replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if(!raw)return 0;
  if(raw.includes(','))raw=raw.replace(/\./g,'').replace(',','.');
  const n=Number(raw);return Number.isFinite(n)?n:0;
}
function today(){return new Date().toISOString().slice(0,10);}
function modal(){
  document.getElementById('modal-ov')?.remove();
  const ov=document.createElement('div');ov.className='modal-ov open';ov.id='modal-ov';
  const body=document.createElement('div');body.id='modal-body';body.className='modal wide phase4-master-modal';
  ov.appendChild(body);document.body.appendChild(ov);return body;
}
function field(label,input,cls=''){return '<label class="phase4-master-field '+cls+'"><span>'+label+'</span>'+input+'</label>';}
function input(id,value='',attrs=''){return '<input id="'+id+'" value="'+esc(value)+'" '+attrs+'>';}
function select(id,options,value='',attrs=''){return '<select id="'+id+'" '+attrs+'>'+options.map(o=>{const v=typeof o==='string'?o:o.value,l=typeof o==='string'?o:o.label;return '<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(l)+'</option>';}).join('')+'</select>';}
function section(title,subtitle,content){return '<section class="phase4-master-section"><header><div><h4>'+title+'</h4>'+(subtitle?'<p>'+subtitle+'</p>':'')+'</div></header><div class="phase4-master-grid">'+content+'</div></section>';}
function top(title,subtitle,saveCall,extra=''){
  return '<div class="phase4-master-head"><div><h2>'+title+'</h2><p>'+subtitle+'</p></div><div class="phase4-master-actions">'+extra+'<button type="button" class="phase4-master-outline" onclick="cm()">Cancelar</button><button type="button" class="phase4-master-save" onclick="'+saveCall+'">Salvar</button></div></div>';
}
function personOptions(value){return select('unused-person',[{value:'PJ',label:'Pessoa Jurídica'},{value:'PF',label:'Pessoa Física'}],value);}
function supplierByCode(code){try{return (FORNECEDORES||[]).find(f=>String(f.cod||'')===String(code||''))||null;}catch(e){return null;}}
function clientByIndex(index){try{return CLIENTES?.[Number(index)]||null;}catch(e){return null;}}
function employeeByMat(mat){try{return (FUNCIONARIOS||[]).find(f=>String(f.mat||'')===String(mat||''))||null;}catch(e){return null;}}
function employeeOptions(current){
  try{return _cfgEmployeeCompanyOptionsHtml(current||'');}catch(e){return '<option value="">— Selecione —</option>'+(current?'<option selected>'+esc(current)+'</option>':'');}
}
function normalizeCityUf(entity){
  const combined=String(entity?.cidade||'');
  const parts=combined.split('/');
  return {city:String(entity?.cidadeNome||parts[0]||''),uf:String(entity?.uf||parts[1]||'')};
}
function bankButton(kind,key,name){
  if(!key)return '<span class="phase4-master-bank-hint">Salve o cadastro para liberar múltiplas contas bancárias.</span>';
  // Parâmetros em JSON escapado: nomes com apóstrofos não quebram handlers JS.
  const jsArg=value=>esc(JSON.stringify(String(value||'')));
  return '<button type="button" class="phase4-master-secondary" onclick="phase3OpenPartyBanks('+jsArg(kind)+','+jsArg(key)+','+jsArg(name)+')">🏦 Gerenciar contas bancárias</button>';
}

function supplierForm(entity){
  const f=entity||{};const editing=!!entity;const p=f.personType||((f.cnpj||'')?'PJ':'PF');const loc=normalizeCityUf(f);const prefix=editing?'ef':'nf';
  const save=editing?'salvarEditFornecedor()':'salvarNovoFornecedor()';
  const extra='';
  const identification=
    (editing?'<input type="hidden" id="ef-cod" value="'+esc(f.cod)+'">':'')+
    field('Nome / Razão Social *',input(prefix+'-nome',f.nome||'','class="mask-upper" autocomplete="organization"'),'span-2')+
    field('Nome fantasia',input(prefix+'-fantasia',f.fantasia||f.nomeFantasia||''))+
    field('Código',input('phase4-master-code',editing?f.cod:'Automático','readonly'))+
    field('Tipo de pessoa',select(prefix+'-pessoa',[{value:'PJ',label:'Pessoa Jurídica'},{value:'PF',label:'Pessoa Física'}],p,'onchange="phase4MasterTogglePerson(\''+prefix+'\')"'))+
    field('Fornecedor desde',input(prefix+'-desde',f.desde||f.dataCadastro||today(),'type="date"'))+
    field('CPF',input(prefix+'-cpf',f.cpf||'','class="mask-cpf" placeholder="000.000.000-00"'))+
    field('CNPJ',input(prefix+'-cnpj',f.cnpj||'','class="phase4-master-alnum-cnpj" placeholder="00.000.000/0001-00" inputmode="text" autocomplete="off" oninput="phase4MasterFormatCnpj(this)"'))+
    field('Inscrição Estadual',input(prefix+'-ie',f.ie||''))+
    field('RG',input(prefix+'-rg',f.rg||''))+
    field('Órgão emissor',input(prefix+'-orgao',f.orgaoEmissor||''))+
    field('Contribuinte',select(prefix+'-contribuinte',['Não informado','Contribuinte ICMS','Isento','Não contribuinte'],f.contribuinte||'Não informado'));
  const contact=field('Telefone',input(prefix+'-tel',f.tel||'','class="mask-tel"'))+field('WhatsApp',input(prefix+'-wpp',f.wpp||'','class="mask-tel"'))+field('E-mail',input(prefix+'-email',f.email||'','type="email"'),'span-2');
  const address=field('CEP',input(prefix+'-cep',f.cep||''))+field('UF',input(prefix+'-uf',loc.uf,'maxlength="2" class="mask-upper"'))+field('Cidade',input(prefix+'-cidade-nome',loc.city),'span-2')+field('Rua / Logradouro',input(prefix+'-rua',f.rua||''),'span-2')+field('Número',input(prefix+'-num',f.num||''))+field('Complemento',input(prefix+'-compl',f.compl||''))+field('Bairro',input(prefix+'-bairro',f.bairro||''),'span-2')+'<input type="hidden" id="'+prefix+'-cidade" value="'+esc(f.cidade||'')+'">';
  const bank=field('Chave PIX',input(prefix+'-pix',f.pix||''),'span-2')+field('Banco principal',input(prefix+'-banco',f.banco||''),'span-2')+field('Agência',input(prefix+'-agencia',f.agencia||''))+field('Conta',input(prefix+'-conta',f.conta||''))+'<div class="phase4-master-bank-action span-2">'+bankButton('fornecedor',editing?f.cod:'',f.nome||'Fornecedor')+'</div>';
  const obs=(editing?(f.obs?field('Dados bancários antigos','<textarea id="ef-obs" rows="2">'+esc(f.obs||'')+'</textarea>','span-2'):'<input type="hidden" id="ef-obs" value="'+esc(f.obs||'')+'">'):'<input type="hidden" id="nf-obs" value="">')+field('Observações','<textarea id="'+prefix+'-nota" rows="3" placeholder="Informações adicionais...">'+esc(f.nota||'')+'</textarea>','span-2');
  return top(editing?'Editar fornecedor':'Novo fornecedor','Cadastro comercial usado em compras, preços, financeiro e documentos.',save,extra)+section('Dados cadastrais','Identificação principal do fornecedor.',identification)+section('Contato','Canais usados pela operação e pelo financeiro.',contact)+section('Endereço','Endereço principal do fornecedor.',address)+section('Dados bancários / PIX','A conta principal continua compatível com módulos antigos; contas adicionais ficam no cadastro multibanco.',bank)+section('Observações','Informações complementares que não alteram regras financeiras.',obs)+'<div class="phase4-master-bottom"><button type="button" class="phase4-master-outline" onclick="cm()">Cancelar</button><button type="button" class="phase4-master-save" onclick="'+save+'">Salvar</button></div>';
}

function clientForm(entity,index){
  const c=entity||{};const editing=!!entity;const prefix=editing?'ec':'nc';const p=c.personType||((c.cnpj||'')?'PJ':'PF');const loc=normalizeCityUf(c);const save=editing?'salvarEditCliente()':'salvarNovoCliente()';
  const extra='';
  const identification=(editing?'<input type="hidden" id="ec-idx" value="'+Number(index)+'">':'')+
    field('Nome / Razão Social *',input(prefix+'-nome',c.nome||'','class="mask-upper"'),'span-2')+
    field('Nome fantasia',input(prefix+'-fantasia',c.fantasia||c.nomeFantasia||''))+
    field('Código',input('phase4-master-code',editing?(c.cod||''):'Automático','readonly'))+
    field('Tipo de pessoa',select(prefix+'-pessoa',[{value:'PJ',label:'Pessoa Jurídica'},{value:'PF',label:'Pessoa Física'}],p,'onchange="phase4MasterTogglePerson(\''+prefix+'\')"'))+
    field('Cliente desde',input(prefix+'-desde',c.desde||c.dataCadastro||today(),'type="date"'))+
    field('CPF',input(prefix+'-cpf',c.cpf||'','class="mask-cpf" placeholder="000.000.000-00"'))+
    field('CNPJ',input(prefix+'-cnpj',c.cnpj||'','class="phase4-master-alnum-cnpj" placeholder="00.000.000/0001-00" inputmode="text" autocomplete="off" oninput="phase4MasterFormatCnpj(this)"'))+
    field('Inscrição Estadual',input(prefix+'-ie',c.ie||''))+field('RG',input(prefix+'-rg',c.rg||''))+field('Órgão emissor',input(prefix+'-orgao',c.orgaoEmissor||''))+field('Contribuinte',select(prefix+'-contribuinte',['Não informado','Contribuinte ICMS','Isento','Não contribuinte'],c.contribuinte||'Não informado'));
  const contact=field('Telefone',input(prefix+'-tel',c.tel||'','class="mask-tel"'))+field('WhatsApp',input(prefix+'-wpp',c.wpp||'','class="mask-tel"'))+field('E-mail',input(prefix+'-email',c.email||'','type="email"'),'span-2');
  const address=field('CEP',input(prefix+'-cep',c.cep||''))+field('UF',input(prefix+'-uf',loc.uf,'maxlength="2" class="mask-upper"'))+field('Cidade',input(prefix+'-cidade-nome',loc.city),'span-2')+field('Rua / Logradouro',input(prefix+'-rua',c.rua||''),'span-2')+field('Número',input(prefix+'-num',c.num||''))+field('Complemento',input(prefix+'-compl',c.compl||''))+field('Bairro',input(prefix+'-bairro',c.bairro||''),'span-2')+'<input type="hidden" id="'+prefix+'-cidade" value="'+esc(c.cidade||'')+'">';
  const finance=field('Limite de crédito R$',input(prefix+'-limite',c.limite?Number(c.limite).toLocaleString('pt-BR',{minimumFractionDigits:2}):'','inputmode="decimal" placeholder="0,00"'))+field('Chave PIX',input(prefix+'-pix',c.pix||''))+field('Banco principal',input(prefix+'-banco',c.banco||''))+field('Agência',input(prefix+'-agencia',c.agencia||''))+field('Conta',input(prefix+'-conta',c.conta||''))+'<div class="phase4-master-bank-action">'+bankButton('cliente',editing?(c.cod||('C'+String(Number(index)+1).padStart(3,'0'))):'',c.nome||'Cliente')+'</div>'+(editing?'<input type="hidden" id="ec-obs" value="'+esc(c.obs||'')+'">':'<input type="hidden" id="nc-obs" value="">')+field('Observações','<textarea id="'+prefix+'-nota" rows="3">'+esc(c.nota||'')+'</textarea>','span-2');
  return top(editing?'Editar cliente':'Novo cliente','Cadastro comercial usado em vendas, preços, contas a receber e documentos.',save,extra)+section('Dados cadastrais','Identificação principal do cliente.',identification)+section('Contato','Canais comerciais e financeiros.',contact)+section('Endereço','Endereço principal do cliente.',address)+section('Financeiro','Crédito e contas bancárias do cliente.',finance)+'<div class="phase4-master-bottom"><button type="button" class="phase4-master-outline" onclick="cm()">Cancelar</button><button type="button" class="phase4-master-save" onclick="'+save+'">Salvar</button></div>';
}

function employeeForm(entity,index){
  const f=entity||{};const editing=!!entity;const prefix=editing?'efn':'nfu';const save=editing?'salvarEditFuncionario()':'salvarNovoFuncionario()';
  const statuses=['Ativo','Inativo','Férias','Afastado'];
  const identification=(editing?'<input type="hidden" id="efn-idx" value="'+Number(index)+'">':'')+
    field('Nome completo *',input(prefix+'-nome',f.nome||'','class="mask-upper"'),'span-2')+
    field('Matrícula',input('phase4-master-employee-code',editing?f.mat:'Automática','readonly'))+
    field('Status',select(prefix+'-status',statuses,f.status||'Ativo'))+
    field('CPF',input(prefix+'-cpf',f.cpf||'','class="mask-cpf"'))+
    field('RG',input(prefix+'-rg',f.rg||''))+
    field('PIS/PASEP',input(prefix+'-pis',f.pis||''))+field('CTPS',input(prefix+'-ctps',f.ctps||''))+
    field('Data de nascimento',input(prefix+'-nasc',f.nascimento||'','type="date"'))+
    field('Data de admissão',input(prefix+'-adm',f.admissao||'','type="date"'))+
    (editing?field('Data de rescisão',input('efn-resc',f.dataRescisao||'','type="date"')):'')+
    field('Empresa','<select id="'+prefix+'-emp">'+employeeOptions(f.empresa||'')+'</select>')+
    field('Cargo',input(prefix+'-cargo',f.cargo||'','list="phase4-master-cargos"'))+'<datalist id="phase4-master-cargos"><option>Gerente Geral</option><option>Supervisor</option><option>Operador de Prensa</option><option>Separador de Materiais</option><option>Motorista</option><option>Auxiliar Geral</option><option>Balanceiro</option><option>Administrativo</option><option>Auxiliar Operacional</option><option>Serviços Gerais</option><option>Auxiliar de Produção</option></datalist>';
  const contact=field('Telefone / celular',input(prefix+'-tel',f.tel||'','class="mask-tel"'))+field('E-mail',input(prefix+'-email',f.email||'','type="email"'))+field('Telefone emergencial',input(prefix+'-emergencia',f.telefoneEmergencial||'','class="mask-tel"'),'span-2');
  const address=field('CEP',input(prefix+'-cep',f.cep||''))+field('UF',input(prefix+'-uf',f.uf||'','maxlength="2" class="mask-upper"'))+field('Cidade',input(prefix+'-cidade',f.cidade||''),'span-2')+field('Endereço',input(prefix+'-rua',f.rua||''),'span-2')+field('Número',input(prefix+'-num',f.num||''))+field('Complemento',input(prefix+'-compl',f.compl||''))+field('Bairro',input(prefix+'-bairro',f.bairro||''),'span-2');
  const payroll=field('Salário base R$',input(prefix+'-sal',f.sal?Number(f.sal).toLocaleString('pt-BR',{minimumFractionDigits:2}):'','class="mask-money" inputmode="decimal"'))+field('Vale transporte R$',input(prefix+'-vt',f.valeTransporte||0,'inputmode="decimal"'))+field('Adicional fixo R$',input(prefix+'-adicional',f.adicional||0,'inputmode="decimal"'))+field('Abono assiduidade R$',input(prefix+'-abono',f.abono||0,'inputmode="decimal"'))+field('Dados bancários / PIX','<textarea id="'+prefix+'-banco" rows="3" placeholder="Banco, agência, conta, PIX...">'+esc(f.banco||'')+'</textarea>','span-2');
  let alerts=field('Fim do 1º período de experiência (45 dias)',input(prefix+'-fimexp1',f.fimExperiencia1||'','type="date"'))+field('Fim da experiência (90 dias)',input(prefix+'-fimexp',f.fimExperiencia||'','type="date"'))+field('Avisar dias antes',input(prefix+'-expdias',f.expAvisarDias!=null?f.expAvisarDias:7,'inputmode="numeric"'))+'<div class="phase4-master-alert-action"><button type="button" class="phase4-master-secondary" onclick="'+(editing?'_efnCalcExp()':'_nfuCalcExp()')+'">📅 Calcular 45 + 45 dias</button></div>';
  if(editing){alerts+='<div class="phase4-master-alert-summary span-2" id="efn-alertas-resumo">'+(typeof _efnResumoAlertas==='function'?_efnResumoAlertas(f):'')+'</div><div class="span-2"><div class="phase4-master-subtitle">Outros lembretes</div><div id="efn-lemb-list"></div><button type="button" class="phase4-master-secondary" onclick="_efnAddLembrete()">＋ Adicionar lembrete</button></div>';}
  return top(editing?'Editar funcionário':'Novo funcionário','Cadastro de RH utilizado em folha, ponto, EPI, viagens e coordenação.',save)+section('Dados cadastrais','Identificação e vínculo do funcionário.',identification)+section('Contato','Canais de contato do colaborador.',contact)+section('Endereço','Dados opcionais para cadastro completo.',address)+section('Remuneração e pagamento','Valores usados pelos módulos financeiros de RH.',payroll)+section('Contrato e alertas','Datas de experiência e lembretes.',alerts)+'<div class="phase4-master-bottom"><button type="button" class="phase4-master-outline" onclick="cm()">Cancelar</button><button type="button" class="phase4-master-save" onclick="'+save+'">Salvar</button></div>';
}

// Clientes e fornecedores compartilham a navegação visual. Os módulos/coleções e
// respectivos controles de acesso permanecem separados para não afetar integrações.
const PARTY_TABS={cliente:'clientes',fornecedor:'fornecedores'};
let editingParty='';
function partyAccess(kind){
  const tab=PARTY_TABS[kind];
  return typeof global.erpCanAccessTab!=='function'||global.erpCanAccessTab(tab);
}
function ensurePartyShell(kind){
  const id=PARTY_TABS[kind];
  const panel=document.getElementById('tab-'+id);
  if(!panel)return null;
  let shell=document.getElementById('phase4-party-'+id);
  if(shell)return shell;
  // Move only DOM nodes; no table is recreated or detached from its legacy handlers.
  const listing=document.createElement('div');
  listing.className='phase4-master-listing';
  while(panel.firstChild)listing.appendChild(panel.firstChild);
  shell=document.createElement('div');
  shell.className='phase4-master-workspace';
  shell.id='phase4-party-'+id;
  shell.dataset.mode='list';
  shell.innerHTML='<div class="phase4-master-workspace-title"><div><h2>Clientes e fornecedores</h2><p>Consulte o histórico e gerencie cadastros sem sair do módulo.</p></div></div>'+
    '<div class="phase4-master-workspace-tabs" role="navigation" aria-label="Cadastros de clientes e fornecedores">'+
      '<button type="button" data-party-target="clientes" onclick="phase4MasterGo(\'clientes\')">👥 Clientes</button>'+
      '<button type="button" data-party-target="fornecedores" onclick="phase4MasterGo(\'fornecedores\')">🤝 Fornecedores</button></div>'+
    '<div class="phase4-master-workspace-views" role="tablist" aria-label="Histórico e cadastro">'+
      '<button type="button" role="tab" data-party-view="list" onclick="phase4MasterShowList(\''+kind+'\')">📋 Histórico / Cadastros</button>'+
      '<button type="button" role="tab" data-party-view="form" onclick="phase4MasterCreate(\''+kind+'\')">＋ Novo cadastro</button></div>';
  shell.appendChild(listing);
  const editor=document.createElement('div');
  editor.id='phase4-master-editor-'+id;
  editor.className='phase4-master-inline-editor phase4-master-modal';
  editor.hidden=true;
  shell.appendChild(editor);
  panel.appendChild(shell);
  updatePartyShell(kind,'list');
  return shell;
}
function updatePartyShell(kind,mode){
  const shell=document.getElementById('phase4-party-'+PARTY_TABS[kind]);
  if(!shell)return;
  shell.dataset.mode=mode;
  shell.querySelectorAll('[data-party-target]').forEach(function(button){
    const target=button.dataset.partyTarget;
    button.classList.toggle('active',target===PARTY_TABS[kind]);
    button.setAttribute('aria-current',target===PARTY_TABS[kind]?'page':'false');
    // A permissão é validada no clique pelo switchTab protegido,
    // não congelada no bootstrap antes de a sessão ser carregada.
  });
  shell.querySelectorAll('[data-party-view]').forEach(function(button){
    const isActive=button.dataset.partyView===mode;
    button.classList.toggle('active',isActive);
    button.setAttribute('aria-selected',String(isActive));
  });
  shell.querySelector('.phase4-master-listing').hidden=mode!=='list';
  shell.querySelector('.phase4-master-inline-editor').hidden=mode!=='form';
}
function navigateToParty(kind){
  if(!partyAccess(kind)){
    try{showToast('Você não tem acesso a este cadastro.','error');}catch(e){}
    return false;
  }
  const tab=PARTY_TABS[kind];
  if(!tab)return false;
  if(!document.getElementById('tab-'+tab)?.classList.contains('active')){
    if(typeof global.switchTab!=='function'||global.switchTab(tab)===false)return false;
  }
  ensurePartyShell(kind);
  return true;
}
function inlinePartyForm(kind,entity,index){
  if(!navigateToParty(kind))return;
  const shell=ensurePartyShell(kind);
  const body=shell?.querySelector('.phase4-master-inline-editor');
  if(!body)return;
  editingParty=kind;
  const markup=kind==='fornecedor'?supplierForm(entity):clientForm(entity,index);
  // Só os formulários de clientes/fornecedores usam navegação inline.
  // O modal de funcionários e de documentos mantém o comportamento original.
  body.innerHTML=markup.replaceAll('onclick="cm()"','onclick="phase4MasterCancel()"');
  updatePartyShell(kind,'form');
  global.phase4MasterTogglePerson(kind==='fornecedor'?(entity?'ef':'nf'):(entity?'ec':'nc'));
  body.querySelector('input:not([type=hidden])')?.focus({preventScroll:true});
  shell.scrollIntoView({block:'start',behavior:'auto'});
}
function openSupplier(entity){inlinePartyForm('fornecedor',entity);}
function openClient(entity,index){inlinePartyForm('cliente',entity,index);}
function openEmployee(entity,index){const body=modal();body.innerHTML=employeeForm(entity,index);if(entity){try{_efnLembretes=Array.isArray(entity.lembretes)?entity.lembretes.map(l=>({t:l.t||'',d:l.d||'',a:l.a!=null?l.a:5})):[];_efnRenderLembretes();}catch(e){}}}

global.phase4MasterGo=function(tab){
  const kind=tab==='clientes'?'cliente':tab==='fornecedores'?'fornecedor':null;
  if(!kind)return;
  if(navigateToParty(kind))global.phase4MasterShowList(kind);
};
global.phase4MasterShowList=function(kind){
  if(!PARTY_TABS[kind])return;
  editingParty='';
  updatePartyShell(kind,'list');
  // Atualização apenas da listagem existente; persistência continua nos repositórios legados.
  try{if(kind==='cliente'&&typeof renderClientes==='function')renderClientes();
    if(kind==='fornecedor'&&typeof renderTabelaFornecedores==='function')renderTabelaFornecedores();}catch(e){console.warn('[master-data] lista',e);}
};
global.phase4MasterCreate=function(kind){
  if(kind==='cliente')openClient(null,null);
  else if(kind==='fornecedor')openSupplier(null);
};
global.phase4MasterCancel=function(){
  if(editingParty)global.phase4MasterShowList(editingParty);
};
function initPartyShells(){
  ensurePartyShell('cliente');
  ensurePartyShell('fornecedor');
}
document.addEventListener('erp:ready',initPartyShells);

// Campo visualmente apagado não impede edição nem o salvamento legado: é necessário disabled.
// O valor é mantido durante a alternância; uma remoção só ocorre após confirmação no Salvar.
global.phase4MasterTogglePerson=function(prefix){
  const type=val(prefix+'-pessoa');
  const cpfInput=document.getElementById(prefix+'-cpf');
  const cnpjInput=document.getElementById(prefix+'-cnpj');
  if(type!=='PF'&&type!=='PJ')return;
  for(const [element,inactive] of [[cpfInput,type==='PJ'],[cnpjInput,type==='PF']]){
    if(!element)continue;
    element.disabled=inactive;
    element.setAttribute('aria-disabled',String(inactive));
    element.closest('.phase4-master-field')?.classList.toggle('phase4-master-muted',inactive);
  }
};

// A Receita Federal passou a emitir também CNPJs alfanuméricos em julho de 2026.
// A máscara deste formulário aceita letras nas primeiras 12 posições e dois DVs numéricos.
global.phase4MasterFormatCnpj=function(element){
  if(!element)return;
  const raw=String(element.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,14);
  const root=raw.slice(0,12),dv=raw.slice(12).replace(/\D/g,'').slice(0,2);
  let formatted=root.slice(0,2);
  if(root.length>2)formatted+='.'+root.slice(2,5);
  if(root.length>5)formatted+='.'+root.slice(5,8);
  if(root.length>8)formatted+='/'+root.slice(8,12);
  if(dv)formatted+='-'+dv;
  element.value=formatted;
};
function validCpf(value){
  const digits=String(value||'').replace(/\D/g,'');
  if(digits.length!==11||/^(\d)\1{10}$/.test(digits))return false;
  for(let size=9;size<=10;size++){
    let sum=0;
    for(let i=0;i<size;i++)sum+=Number(digits[i])*(size+1-i);
    const check=(sum*10)%11;
    if((check===10?0:check)!==Number(digits[size]))return false;
  }
  return true;
}
function validCnpj(value){
  const raw=String(value||'').toUpperCase().replace(/[.\/\-\s]/g,'');
  if(!/^[0-9A-Z]{12}\d{2}$/.test(raw)||/^(.)\1{13}$/.test(raw))return false;
  const checksum=(part,weights)=>{
    const sum=weights.reduce((acc,weight,index)=>acc+(part.charCodeAt(index)-48)*weight,0);
    const rem=sum%11;
    return rem<2?0:11-rem;
  };
  const root=raw.slice(0,12);
  const first=checksum(root,[5,4,3,2,9,8,7,6,5,4,3,2]);
  const second=checksum(root+first,[6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return raw.slice(12)===String(first)+String(second);
}
function preparePersonDocument(prefix){
  const person=document.getElementById(prefix+'-pessoa');
  if(!person)return true; // Outras telas legadas não usam o seletor novo.
  const type=person.value;
  if(type!=='PF'&&type!=='PJ')return false;
  const active=document.getElementById(prefix+(type==='PF'?'-cpf':'-cnpj'));
  const inactive=document.getElementById(prefix+(type==='PF'?'-cnpj':'-cpf'));
  const docType=type==='PF'?'CPF':'CNPJ';
  if(!active||!inactive)return false;
  const data=String(active.value||'').trim();
  // Documentos não eram obrigatórios no legado: só validamos quando informados.
  if(data&&!(type==='PF'?validCpf(data):validCnpj(data))){
    alert(docType+' inválido. Confira os dígitos antes de salvar.');
    active.focus();
    return false;
  }
  if(String(inactive.value||'').trim()){
    const outdated=type==='PF'?'CNPJ':'CPF';
    if(!confirm('Este cadastro contém '+outdated+' preenchido, mas está marcado como '+(type==='PF'?'Pessoa Física':'Pessoa Jurídica')+'. Ao salvar, o '+outdated+' será removido. Deseja continuar?'))return false;
    inactive.value='';
  }
  return true;
}

function supplierExtras(prefix){
  const city=val(prefix+'-cidade-nome'),uf=val(prefix+'-uf').toUpperCase();
  const combined=[city,uf].filter(Boolean).join('/');const hidden=document.getElementById(prefix+'-cidade');if(hidden)hidden.value=combined;
  return {fantasia:val(prefix+'-fantasia'),nomeFantasia:val(prefix+'-fantasia'),personType:val(prefix+'-pessoa'),desde:val(prefix+'-desde'),dataCadastro:val(prefix+'-desde'),orgaoEmissor:val(prefix+'-orgao'),contribuinte:val(prefix+'-contribuinte'),uf,cidadeNome:city,cidade:combined};
}
function clientExtras(prefix){return Object.assign({},supplierExtras(prefix),{limite:parseMoney(val(prefix+'-limite'))});}
function employeeExtras(prefix){return {rg:val(prefix+'-rg'),pis:val(prefix+'-pis'),ctps:val(prefix+'-ctps'),email:val(prefix+'-email'),telefoneEmergencial:val(prefix+'-emergencia'),cep:val(prefix+'-cep'),uf:val(prefix+'-uf').toUpperCase(),cidade:val(prefix+'-cidade'),rua:val(prefix+'-rua'),num:val(prefix+'-num'),compl:val(prefix+'-compl'),bairro:val(prefix+'-bairro'),sal:parseMoney(val(prefix+'-sal')),valeTransporte:parseMoney(val(prefix+'-vt')),adicional:parseMoney(val(prefix+'-adicional')),abono:parseMoney(val(prefix+'-abono'))};}
function persistSuppliers(){
  try{localStorage.setItem('mm_fornecedores_edit',JSON.stringify(FORNECEDORES||[]));}catch(e){}
  try{if(typeof fbSalvarImediato==='function')fbSalvarImediato();else if(typeof fbSalvar==='function')fbSalvar();}catch(e){}
  try{renderTabelaFornecedores();populateFornSelects();}catch(e){}
}
function persistEmployees(){
  try{localStorage.setItem('mm_funcionarios_edit',JSON.stringify(FUNCIONARIOS||[]));}catch(e){}
  try{if(typeof fbSalvarImediato==='function')fbSalvarImediato();else if(typeof fbSalvar==='function')fbSalvar();}catch(e){}
  try{renderTbFuncionarios();}catch(e){}
}

if(typeof legacy.saveNewSupplier==='function')global.salvarNovoFornecedor=function(){
  if(!preparePersonDocument('nf'))return false;
  const extras=supplierExtras('nf'),before=new Set((FORNECEDORES||[]).map(f=>f.cod));
  const result=legacy.saveNewSupplier.apply(this,arguments);
  const entity=(FORNECEDORES||[]).find(f=>!before.has(f.cod));if(entity){Object.assign(entity,extras);persistSuppliers();global.phase4MasterShowList('fornecedor');}
  return result;
};
if(typeof legacy.saveSupplier==='function')global.salvarEditFornecedor=function(){
  if(!preparePersonDocument('ef'))return false;
  const code=val('ef-cod'),extras=supplierExtras('ef');const result=legacy.saveSupplier.apply(this,arguments);const entity=supplierByCode(code);if(entity){Object.assign(entity,extras);persistSuppliers();global.phase4MasterShowList('fornecedor');}return result;
};
if(typeof legacy.saveNewClient==='function')global.salvarNovoCliente=function(){
  if(!preparePersonDocument('nc'))return false;
  const extras=clientExtras('nc'),before=new Set((CLIENTES||[]).map(c=>c.cod));const bank={banco:val('nc-banco'),agencia:val('nc-agencia'),conta:val('nc-conta'),pix:val('nc-pix')};
  const result=legacy.saveNewClient.apply(this,arguments);const entity=(CLIENTES||[]).find(c=>!before.has(c.cod));if(entity){Object.assign(entity,extras,bank);try{saveClientes();}catch(e){}global.phase4MasterShowList('cliente');}return result;
};
if(typeof legacy.saveClient==='function')global.salvarEditCliente=function(){
  if(!preparePersonDocument('ec'))return false;
  const idx=Number(document.getElementById('ec-idx')?.value),extras=clientExtras('ec'),bank={banco:val('ec-banco'),agencia:val('ec-agencia'),conta:val('ec-conta'),pix:val('ec-pix')};
  const result=legacy.saveClient.apply(this,arguments);const entity=CLIENTES?.[idx];if(entity){Object.assign(entity,extras,bank);try{saveClientes();}catch(e){}global.phase4MasterShowList('cliente');}return result;
};
if(typeof legacy.saveNewEmployee==='function')global.salvarNovoFuncionario=function(){
  const extras=employeeExtras('nfu'),before=new Set((FUNCIONARIOS||[]).map(f=>f.mat));const result=legacy.saveNewEmployee.apply(this,arguments);const entity=(FUNCIONARIOS||[]).find(f=>!before.has(f.mat));if(entity){Object.assign(entity,extras);persistEmployees();}return result;
};
if(typeof legacy.saveEmployee==='function')global.salvarEditFuncionario=function(){
  const idx=Number(document.getElementById('efn-idx')?.value),extras=employeeExtras('efn');const result=legacy.saveEmployee.apply(this,arguments);const entity=FUNCIONARIOS?.[idx];if(entity){Object.assign(entity,extras);persistEmployees();}return result;
};

// Hidden bank fields keep legacy client save compatible while the visible action uses multibank.
function clientBankHidden(entity,prefix){return entity;}

if(typeof legacy.openModal==='function')global.om=function(type){
  if(type==='fornecedor'){openSupplier(null);return;}
  if(type==='cliente'){openClient(null,null);return;}
  if(type==='funcionario'){openEmployee(null,null);return;}
  return legacy.openModal.apply(this,arguments);
};
global.editFornecedor=function(code){const entity=supplierByCode(code);if(entity)openSupplier(entity);else if(typeof legacy.editSupplier==='function')legacy.editSupplier.apply(this,arguments);};
global.editCliente=function(index){const entity=clientByIndex(index);if(entity)openClient(entity,index);else if(typeof legacy.editClient==='function')legacy.editClient.apply(this,arguments);};
global.editFuncionario=function(mat){const idx=(FUNCIONARIOS||[]).findIndex(f=>String(f.mat||'')===String(mat||''));const entity=idx>=0?FUNCIONARIOS[idx]:null;if(entity)openEmployee(entity,idx);else if(typeof legacy.editEmployee==='function')legacy.editEmployee.apply(this,arguments);};

global.__MASTER_DATA_FORMS_READY__=true;
})(window);
