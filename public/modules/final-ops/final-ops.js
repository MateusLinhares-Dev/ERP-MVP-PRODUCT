/* Manuela Metais — ferramentas finais: relatórios, matriz, contratos e ajuda. */
(function(global){
'use strict';
const $=(q,root=document)=>root.querySelector(q);
const $$=(q,root=document)=>Array.from(root.querySelectorAll(q));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dateBR=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?v.slice(8)+'/'+v.slice(5,7)+'/'+v.slice(0,4):String(v||'—');
const dateISO=v=>{const s=String(v||'');return /^\d{2}\/\d{2}\/\d{4}$/.test(s)?s.slice(6)+'-'+s.slice(3,5)+'-'+s.slice(0,2):s;};
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const nowMonth=()=>today().slice(0,7);
const toast=(m,error=false)=>{try{global.showToast?.(m,error?'error':'success');}catch(e){alert(m);}};
const rawAuth=()=>global.__fbRaw?.auth?.currentUser;
async function token(){const t=await rawAuth()?.getIdToken();if(!t)throw Error('Sessão expirada; entre novamente.');return t;}
async function request(action,body){const t=await token();const response=await fetch('/api/training/matrix'+(action?'?view='+encodeURIComponent(action):''),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+t,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.message||'Não foi possível consultar a matriz.');return result;}
let trainingManager=false,trainingData={courses:{},enrollments:{},documents:{},employees:[],history:[]},trainingTab='pessoas';
function ensureTab(id){let panel=$('#tab-'+id);if(!panel){panel=document.createElement('section');panel.id='tab-'+id;panel.className='tab-panel';$('.app-body .content')?.append(panel);}return panel;}
function addNav(group,label,id,icon){const nav=$('#nav-bar');if(!nav||nav.querySelector('[data-tab="'+id+'"]'))return;
  let target=$$('.sb-group',nav).find(g=>$('.sb-glabel',g)?.textContent?.trim()===group);
  if(!target){target=document.createElement('div');target.className='sb-group open';target.innerHTML='<div class="sb-group-hdr"><span class="sb-gicon">'+icon+'</span><span class="sb-glabel">'+esc(group)+'</span><span class="sb-arr">▶</span></div><div class="sb-items"></div>';target.querySelector('.sb-group-hdr').onclick=()=>target.classList.toggle('open');nav.append(target);}
  const a=document.createElement('div');a.className='nav-tab';a.dataset.tab=id;a.innerHTML='<span class="nt-icon">'+icon+'</span><span class="nt-label">'+esc(label)+'</span>';a.onclick=()=>{try{global.switchTab?.(id);}catch(e){console.error(e);}if(id==='matriz_capacitacao')refreshTraining();if(id==='help_center')renderHelp();};$('.sb-items',target).append(a);
}
async function installMenu(){ensureTab('help_center');addNav('Ajuda','Help · Central de ajuda','help_center','?');
  try{const t=await rawAuth()?.getIdTokenResult();trainingManager=Boolean(t?.claims?.admin)&&String(t?.claims?.erpUser||'').toLowerCase()==='elaine';
    if(trainingManager){ensureTab('matriz_capacitacao');addNav('Administração','Matriz Curricular · Cursos','matriz_capacitacao','▦');}
    if(!$('#mm-training-notice')){const widget=document.createElement('div');widget.id='mm-training-notice';widget.hidden=true;widget.setAttribute('role','status');$('#app-screen')?.append(widget);}
    await checkNotices();
  }catch(e){console.warn('Não foi possível consultar avisos de capacitação.',e.message);}
  enhanceContracts();addReportButtons();
}
async function checkNotices(){if(!rawAuth())return;try{
 const d=await request('mine'),notices=d.notices||[],widget=$('#mm-training-notice');if(!widget)return;
 const dueContracts=trainingManager?contracts().filter(c=>c?.fim&&daysDiff(c.fim)<=Number(c.remindDays||30)).slice(0,5):[];
 const count=notices.length+dueContracts.length;
 widget.hidden=!count;widget.replaceChildren();
 if(count){const h=document.createElement('strong');h.textContent=count+' aviso(s) de prazos e capacitações';widget.append(h);
 notices.slice(0,5).forEach(n=>{const p=document.createElement('p');p.textContent=n.course+' · '+(n.expiresAt?'Vence '+dateBR(n.expiresAt):n.scheduledAt?'Previsto '+dateBR(n.scheduledAt):'A programar');widget.append(p);});
 dueContracts.forEach(c=>{const p=document.createElement('p');p.textContent='Contrato '+String(c.desc||'')+' · Vencimento '+dateBR(c.fim);widget.append(p);});
 const button=document.createElement('button');button.textContent='Fechar';button.onclick=()=>widget.hidden=true;widget.append(button);
 }
 }catch(e){}
}
const trainingHTML=()=>`<div class="ops-head"><div><h2>Matriz Curricular · Capacitações</h2><p>Gestão de cursos, certificados, vencimentos e avisos aos funcionários.</p></div><button type="button" id="ops-training-reload">Atualizar</button></div><div class="ops-tabs"><button data-training-tab="pessoas">Matriz por funcionário</button><button data-training-tab="cursos">Catálogo de cursos</button><button data-training-tab="certificados">Certificados</button><button data-training-tab="avisos">Avisos e vencimentos</button></div><div id="ops-training-main"></div><p class="ops-message" id="ops-training-status" role="status"></p>`;
async function refreshTraining(){if(!trainingManager)return;const page=ensureTab('matriz_capacitacao');if(!$('#ops-training-main',page)){page.innerHTML=trainingHTML();$('#ops-training-reload',page).onclick=refreshTraining;$$('[data-training-tab]',page).forEach(b=>b.onclick=()=>{trainingTab=b.dataset.trainingTab;renderTraining();});}
  try{trainingData=await request();renderTraining();}catch(e){$('#ops-training-status',page).textContent=e.message;}
}
const courseItems=()=>Object.values(trainingData.courses||{}).filter(Boolean);
const enrollItems=()=>Object.values(trainingData.enrollments||{}).filter(Boolean);
const employeeName=id=>trainingData.employees.find(f=>f.id===id)?.name||id;
const courseName=id=>trainingData.courses[id]?.title||id;
function selectOptions(items,selected=''){return items.map(i=>'<option value="'+esc(i.id)+'"'+(i.id===selected?' selected':'')+'>'+esc(i.name||i.title)+'</option>').join('');}
function daysDiff(date){if(!date)return null;return Math.floor((Date.parse(date+'T12:00:00Z')-Date.parse(today()+'T12:00:00Z'))/86400000);}
function expiry(e){if(e.expiresAt)return e.expiresAt;const c=trainingData.courses[e.courseId];if(!e.completedAt||!c?.renewalMonths)return'';
 const d=new Date(e.completedAt+'T12:00:00Z');const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+Number(c.renewalMonths));d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.toISOString().slice(0,10);
}
function badgeFor(e){const date=expiry(e),diff=daysDiff(date);if(e.status!=='concluido')return e.status;if(diff===null)return 'Sem vencimento';return diff<0?'Vencido':diff<=Number(trainingData.courses[e.courseId]?.noticeDays||30)?'A vencer':'Em dia';}
function renderTraining(){const host=$('#ops-training-main'),tab=trainingTab;$$('[data-training-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.trainingTab===tab));if(!host)return;
 const courses=courseItems(),employees=trainingData.employees||[],enroll=enrollItems().sort((a,b)=>String(expiry(a)||'9999').localeCompare(String(expiry(b)||'9999')));
 if(tab==='cursos'){
   host.innerHTML=`<div class="ops-split"><form id="ops-new-course" class="ops-card"><h3>Novo curso ou especialização</h3><label>Curso<input name="title" required maxlength="120" placeholder="Operador de empilhadeira"></label><label>Categoria<input name="category" maxlength="60" placeholder="Operação de máquinas"></label><div class="ops-two"><label>Renovar a cada (meses)<input name="renewalMonths" type="number" min="0" max="240" value="12" required></label><label>Avisar com antecedência (dias)<input name="noticeDays" type="number" min="0" max="365" value="30" required></label></div><label>Observações<textarea name="description" maxlength="500"></textarea></label><label class="ops-inline"><input name="mandatory" type="checkbox">Obrigatório</label><button class="ops-primary">Cadastrar curso</button></form><div class="ops-card"><h3>Catálogo</h3><div class="ops-list">${courses.map(c=>`<div><b>${esc(c.title)}</b><span>${c.renewalMonths?c.renewalMonths+' meses':'Sem renovação'} · aviso ${c.noticeDays} dias</span><button data-archive-course="${esc(c.id)}">Inativar</button></div>`).join('')||'<p>Nenhum curso cadastrado.</p>'}</div></div></div>`;
   $('#ops-new-course').onsubmit=async event=>{event.preventDefault();await submitTraining({action:'course',...Object.fromEntries(new FormData(event.target)),mandatory:event.target.elements.mandatory.checked});};
   $$('[data-archive-course]',host).forEach(b=>b.onclick=()=>submitTraining({action:'archive',kind:'courses',id:b.dataset.archiveCourse}));return;
 }
 if(tab==='pessoas'){
 host.innerHTML=`<div class="ops-split"><form id="ops-new-enrollment" class="ops-card"><h3>Atribuir capacitação</h3><label>Funcionário<select name="employeeId" required><option value="">Selecione</option>${selectOptions(employees.map(e=>({id:e.id,name:e.name})))}</select></label><label>Curso<select name="courseId" required><option value="">Selecione</option>${selectOptions(courses.filter(c=>c.active!==false))}</select></label><label>Login do funcionário para receber aviso<input name="employeeLogin" placeholder="Login cadastrado no ERP" maxlength="80"></label><div class="ops-two"><label>Situação<select name="status"><option value="planejado">A fazer</option><option value="agendado">Agendado</option><option value="concluido">Concluído</option><option value="dispensado">Dispensado</option></select></label><label>Previsão<input type="date" name="scheduledAt"></label><label>Data de conclusão<input type="date" name="completedAt"></label><label>Vencimento (opcional)<input type="date" name="expiresAt"></label><label>Mostrar aviso a partir de<input type="date" name="notifyAt"></label></div><label class="ops-inline"><input type="checkbox" name="notifyEnabled">Mostrar aviso ao funcionário vinculado</label><label>Observação<textarea name="notes" maxlength="500"></textarea></label><button class="ops-primary">Salvar vínculo</button></form><div class="ops-card"><h3>Matriz de funcionários</h3><input id="ops-enroll-filter" placeholder="Buscar funcionário ou curso" type="search"><div id="ops-enroll-list" class="ops-list">${enroll.map(e=>`<div data-matrix-row="${esc((employeeName(e.employeeId)+' '+courseName(e.courseId)).toLowerCase())}"><b>${esc(employeeName(e.employeeId))}</b><span>${esc(courseName(e.courseId))} · ${esc(badgeFor(e))}${expiry(e)?' · '+dateBR(expiry(e)):''}</span><button data-edit-enroll="${esc(e.id)}">Editar</button></div>`).join('')||'<p>Nenhum vínculo cadastrado.</p>'}</div></div></div>`;
 $('#ops-new-enrollment').onsubmit=async event=>{event.preventDefault();const form=event.target;await submitTraining({action:'enroll',...Object.fromEntries(new FormData(form)),notifyEnabled:form.elements.notifyEnabled.checked,id:form.dataset.id||undefined});};
 $('#ops-enroll-filter').oninput=e=>$$('[data-matrix-row]',host).forEach(row=>row.hidden=!row.dataset.matrixRow.includes(e.target.value.toLowerCase()));
 $$('[data-edit-enroll]',host).forEach(b=>b.onclick=()=>{const e=trainingData.enrollments[b.dataset.editEnroll],form=$('#ops-new-enrollment');form.dataset.id=e.id;for(const [key,value] of Object.entries(e)){if(form.elements[key]&&form.elements[key].type!=='checkbox')form.elements[key].value=value||'';}form.elements.notifyEnabled.checked=Boolean(e.notifyEnabled);form.scrollIntoView({behavior:'smooth'});});return;
 }
 if(tab==='certificados'){
 host.innerHTML=`<div class="ops-card"><h3>Documentos e certificados</h3><p>Anexos PDF ou imagem de até 10 MB. Apenas Elaine pode consultar ou alterar.</p><form id="ops-upload-doc" class="ops-form"><label>Curso vinculado<select name="enrollmentId" required>${selectOptions(enroll.map(e=>({id:e.id,name:employeeName(e.employeeId)+' — '+courseName(e.courseId)})))}</select></label><label>Arquivo<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" required></label><button class="ops-primary">Anexar certificado</button></form><div class="ops-list">${Object.values(trainingData.documents||{}).map(d=>`<div><b>${esc(d.name)}</b><span>${esc(employeeName(trainingData.enrollments[d.enrollmentId]?.employeeId))}</span><button data-open-doc="${esc(d.id)}">Abrir</button><button data-delete-doc="${esc(d.id)}">Excluir</button></div>`).join('')||'<p>Nenhum documento anexado.</p>'}</div></div>`;
 $('#ops-upload-doc').onsubmit=uploadTrainingDoc;
 $$('[data-open-doc]',host).forEach(b=>b.onclick=()=>openTrainingDoc(b.dataset.openDoc));$$('[data-delete-doc]',host).forEach(b=>b.onclick=()=>{if(confirm('Excluir este certificado permanentemente?'))submitTraining({action:'removeDocument',id:b.dataset.deleteDoc});});return;
 }
 host.innerHTML=`<div class="ops-card"><h3>Vencimentos e avisos</h3><p>Avisos são exibidos no ERP conforme o login do funcionário, sem envio de mensagens externas.</p><div class="ops-list">${enroll.filter(e=>badgeFor(e)!=='Em dia').map(e=>`<div><b>${esc(employeeName(e.employeeId))}</b><span>${esc(courseName(e.courseId))} · ${esc(badgeFor(e))} · ${dateBR(expiry(e))}${e.notifyEnabled?' · aviso ativo':' · aviso desativado'}</span></div>`).join('')||'<p>Nenhum vencimento pendente.</p>'}</div></div>`;
}
async function submitTraining(body){try{await request(null,body);toast('Registro atualizado.');await refreshTraining();}catch(e){toast(e.message,true);}}
async function uploadTrainingDoc(event){event.preventDefault();const form=event.target,file=form.elements.file.files[0],enrollmentId=form.elements.enrollmentId.value;
 if(!file||file.size>10*1024*1024||file.size<1||!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type))return toast('Utilize PDF ou imagem até 10 MB.',true);
 try{const id='TM'+global.crypto.randomUUID().replace(/-/g,'').slice(0,24),extension={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type],path=`erp-files/training/${enrollmentId}/${id}.${extension}`;
 await global.__fbRaw.storage.ref(path).put(file,{contentType:file.type});
 await request(null,{action:'document',enrollmentId,id,extension,name:file.name});toast('Certificado anexado.');await refreshTraining();
 }catch(e){toast(e.message,true);}}
async function openTrainingDoc(id){const doc=trainingData.documents[id];if(!doc)return;try{const url=await global.__fbRaw.storage.ref(doc.path).getDownloadURL();global.open(url,'_blank','noopener,noreferrer');}catch(e){toast(e.message,true);}}

const helpModules={
 'Compra de Sucata':'Abra Pesagens a fechar, confira os pesos e finalize o pedido. Use Lançamento para criar ou editar uma compra. Confirme adiantamentos antes de salvar.',
 'Adiantamentos':'Cadastre valores pagos antes da compra, vincule ao fornecedor correto e confira o status no histórico. Um abatimento quitado não deve ser aplicado duas vezes.',
 'Contas a Pagar':'Selecione o título, registre o pagamento e confira a baixa. Alterações em contas financeiras afetam relatórios e canhotos.',
 'Conciliação Bancária':'Importe um extrato OFX, compare com lançamentos, escolha correspondências e confirme. Importar não deve duplicar movimentos nem dar baixa automaticamente.',
 'Fiscal':'Selecione empresa e competência. Registre notas após revisão; importação XML preenche rascunho. Apuração e fechamento devem ser revisados pela responsável fiscal.',
 'Viagens de Motoristas':'Cadastre saída, retorno, motorista, alimentação e despesas. Em Viagens, use Visualizar e Imprimir histórico mensal para prestação de contas.',
 'Combustível':'Registre abastecimentos e entradas do tanque. Use o filtro por mês e Imprimir relatório mensal para conferir litros e gastos.',
 'Contratos':'Cadastre vencimento, valor e anexo. Consulte Vencimentos para acompanhar os prazos e ajustar avisos por contrato.',
 'Matriz de Capacitações':'Elaine cadastra cursos, vincula funcionários, registra conclusões e certificados, e controla avisos e renovações.',
 'Estoque':'Confira entradas e saídas de materiais; evite alterar manualmente saldos após lançamentos conciliados.',
 'Clientes e Fornecedores':'Cadastros comerciais e fiscais são independentes. Confira se o nome correto foi selecionado antes de registrar uma nota.',
 'Folha de Pagamento':'Revise remuneração, descontos e ajustes antes de fechar. O custo por funcionário é uma estimativa e não substitui folha contábil.',
 'Dashboard':'Acompanhe compras, vendas, estoque e financeiro. Corrija dados no módulo de origem.',
 'Avisos':'Verifique alertas e pendências; abra o módulo correspondente para resolver.',
 'Agenda de Entregas':'Programe entregas, consulte datas e compromissos pendentes.',
 'Balança Rodoviária':'Registre pesagens e confira bruto, tara e líquido.',
 'Balanceiro':'Conclua a pesagem e relacione o ticket ao fornecedor correto.',
 'Vendas':'Registre materiais, pesos, valores e vencimentos, conferindo a ficha do cliente.',
 'Preços de Clientes':'Mantenha valores de venda por material e cliente.',
 'Preços de Fornecedores':'Configure preços de compra por fornecedor e material.',
 'Contas a Receber':'Acompanhe vendas e registre pagamentos recebidos para o cliente correto.',
 'Cheques':'Controle emissão, compensação, vencimento e destinatário dos cheques.',
 'Bancos':'Cadastre contas, confira extratos e evite pagamentos duplicados.',
 'Fluxo de Caixa':'Consulte entradas, saídas e projeções financeiras.',
 'Funcionários':'Cadastre colaboradores, status e documentos, mantendo ativos e inativos separados.',
 'Ponto':'Registre faltas e horas extras; revise os cartões importados antes da folha.',
 'Vales':'Registre adiantamentos e vale-transporte, conferindo os descontos.',
 'EPI e Almoxarifado':'Entregue EPIs pelo Almoxarifado para reduzir estoque uma única vez.',
 'Frota':'Cadastre veículos, manutenção, documentos e despesas.',
 'Despesas por Grupo':'Classifique despesas por categoria e centro de custo.',
 'Lista de Compras':'Planeje itens, responsáveis e quantidades antes da compra.',
 'Documentos':'Organize anexos por pessoa ou empresa, verificando permissões e validade.',
 'Usuários':'Gerencie acessos por módulo, principalmente RH, Financeiro e Fiscal.',
 'Configurações':'Gerencie parâmetros com cuidado e valide alterações na homologação.',
 'Coordenação':'Acompanhe equipe, atividades, notas e documentos operacionais.',
 'Almoxarifado':'Gerencie itens, entradas, saídas e controle de estoque.',
 'Custo da Casa':'Registre gastos administrativos sem misturar despesas empresariais.',
 'Chat':'Comunique-se com os usuários; evite compartilhar senhas.',
 'Afazeres':'Cadastre tarefas, datas, responsáveis e atualize os status.'
};
function renderHelp(){const host=ensureTab('help_center');host.innerHTML='<div class="ops-head"><div><h2>Help · Central de ajuda</h2><p>Instruções práticas para operar os módulos com segurança.</p></div></div><input id="ops-help-search" type="search" placeholder="Buscar um módulo ou dúvida" aria-label="Buscar ajuda"><div id="ops-help-list" class="ops-help-list"></div>';const out=$('#ops-help-list');const show=()=>{const q=String($('#ops-help-search').value||'').toLowerCase();out.replaceChildren();Object.entries(helpModules).filter(([title,desc])=>(title+' '+desc).toLowerCase().includes(q)).forEach(([title,description])=>{const block=document.createElement('details');block.className='ops-card';const sum=document.createElement('summary');sum.textContent=title;const p=document.createElement('p');p.textContent=description;block.append(sum,p);out.append(block);});};$('#ops-help-search').oninput=show;show();}
function printReport(title,subtitle,columns,rows,totals){const printWin=global.open('','_blank');if(!printWin)return toast('Permita pop-ups para imprimir.',true);
 const html=`<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:13px Arial;color:#1e3429;margin:34px}header{display:flex;align-items:center;gap:16px;border-bottom:3px solid #194c34;padding-bottom:15px;margin-bottom:22px}img{width:76px;height:auto}h1{font-size:21px;margin:0}p{color:#6b7d72;margin:5px 0}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #d6e2d9;text-align:left;padding:9px 8px}th{background:#eff5f0}tfoot td{font-weight:bold}small{color:#678}@page{size:A4 landscape;margin:16mm}@media print{button{display:none}}</style></head><body><header><img src="/assets/branding/manuela-metais-logo.webp" alt="Manuela Metais"><div><h1>Manuela Metais — ${esc(title)}</h1><p>${esc(subtitle)}</p></div></header><table><thead><tr>${columns.map(c=>'<th>'+esc(c)+'</th>').join('')}</tr></thead><tbody>${rows.map(row=>'<tr>'+row.map(cell=>'<td>'+esc(cell)+'</td>').join('')+'</tr>').join('')}</tbody></table><h3>${esc(totals)}</h3><small>Gerado em ${esc(new Date().toLocaleString('pt-BR'))} · Conferir antes de assinar.</small><p style="margin-top:52px">______________________________________ &nbsp;&nbsp; Assinatura do responsável</p><button onclick="window.print()">Imprimir / Salvar PDF</button></body></html>`;
 printWin.document.open();printWin.document.write(html);printWin.document.close();
}
function fuelEntries(){try{return typeof COMBUSTIVEL_DB!=='undefined'&&Array.isArray(COMBUSTIVEL_DB)?COMBUSTIVEL_DB:[];}catch(_){return[];}}
function tripEntries(){try{return typeof VIAGEM_DB!=='undefined'&&Array.isArray(VIAGEM_DB)?VIAGEM_DB:[];}catch(_){return[];}}
function ensureReports(containerId,id,label,printer){const host=$('#'+containerId);if(!host||$('#'+id,host))return;const box=document.createElement('section');box.className='ops-report';box.id=id;box.innerHTML='<label>Competência<input type="month" value="'+nowMonth()+'" aria-label="Mês do relatório"></label><label>Filtro<select aria-label="Seleção"></select></label><button type="button">'+esc(label)+'</button>';
 host.prepend(box);const s=$('select',box);s.add(new Option('Todos',''));const list=containerId==='tab-combustivel_rudnick'?fuelEntries():tripEntries();const names=[...new Set(list.map(c=>containerId==='tab-combustivel_rudnick'?c.motorista:c.motorista).filter(Boolean))].sort();names.forEach(name=>s.add(new Option(name,name)));$('button',box).onclick=()=>printer($('input',box).value,s.value);
}
function printFuel(month,motorista){if(!/^\d{4}-\d{2}$/.test(month))return toast('Informe o mês.',true);const list=fuelEntries().filter(v=>dateISO(v.data).startsWith(month)&&(!motorista||v.motorista===motorista)),litres=list.reduce((s,x)=>s+Number(x.litros||0),0),total=list.reduce((s,x)=>s+Number(x.total||0),0);
 printReport('Combustível · relatório mensal',month+' · '+(motorista||'Todos os motoristas'),['Data','Veículo','Motorista','Fonte','Litros','Valor'],list.map(v=>[dateBR(dateISO(v.data)),v.caminhao||'—',v.motorista||'—',v.fonte||'—',String(v.litros||0),money(v.total)]),list.length+' abastecimentos · '+litres.toLocaleString('pt-BR')+' litros · '+money(total));}
function printTrips(month,motorista){if(!/^\d{4}-\d{2}$/.test(month))return toast('Informe o mês.',true);const list=tripEntries().filter(v=>dateISO(v.data).startsWith(month)&&(!motorista||v.motorista===motorista));const sum=list.reduce((s,v)=>s+Number(v.totalRefeicoes||0)+Number(v.combustivel||0)+Number(v.gastosExtras||0)+Number(v.totalDiarias||0),0);
 printReport('Viagens · histórico mensal',month+' · '+(motorista||'Todos os motoristas'),['Saída','Volta','Motorista','Destino','Diárias','Alimentação','Combustível','Extras'],list.map(v=>[dateBR(dateISO(v.data)),dateBR(dateISO(v.volta)),v.motorista||'—',v.destino||'—',money(v.totalDiarias),money(v.totalRefeicoes),money(v.combustivel),money(v.gastosExtras)]),list.length+' viagens · Custo registrado estimado: '+money(sum));}
function printOneTrip(record){
 const items=[
  ['Motorista',record.motorista||'—'],['Destino',record.destino||'—'],
  ['Saída',dateBR(dateISO(record.data))],['Volta',dateBR(dateISO(record.volta))],
  ['Diárias',money(record.totalDiarias)],['Alimentação',money(record.totalRefeicoes)],
  ['Combustível',money(record.combustivel)],['Extras',money(record.gastosExtras)],
  ['Adiantamento',money(record.dinheiroAlim)]
 ];
 const meal=Array.isArray(record.refeicoesPorDia)?record.refeicoesPorDia:[];
 const rows=items.map(([label,value])=>[label,value]);
 for(const day of meal){const dtotal=['cafeManha','almoco','cafeTarde','janta'].reduce((s,k)=>s+Number(day[k]||0),0);rows.push(['Refeições '+dateBR(dateISO(day.data)),money(dtotal)]);}
 const amount=Number(record.totalDiarias||0)+Number(record.totalRefeicoes||0)+Number(record.combustivel||0)+Number(record.gastosExtras||0);
 printReport('Ficha de viagem',record.motorista+' · '+dateBR(dateISO(record.data)),['Informação','Valor'],rows,'Total de despesas: '+money(amount));
}
function ensureTripPrintButton(){const record=$('#phase2-trip-record');if(!record||record.hidden)return;
 const header=$('.phase2-trip-record-header',record);if(!header||$('#ops-print-trip',header))return;
 const btn=document.createElement('button');btn.id='ops-print-trip';btn.type='button';btn.className='ops-primary';btn.textContent='Imprimir ficha';btn.onclick=()=>{
   const edit=$('[data-trip-edit]',record);const index=Number(edit?.dataset.tripIndex),list=tripEntries();
   const item=list.find(x=>String(x.id||'')===edit?.dataset.tripEdit)||list[index];if(item)printOneTrip(item);else toast('Viagem não encontrada.',true);
 };header.append(btn);
}
function addReportButtons(){ensureReports('tab-combustivel_rudnick','ops-fuel-print','Imprimir combustível do mês',printFuel);ensureReports('tab-viagem_motorista','ops-trip-print','Imprimir viagens do mês',printTrips);ensureTripPrintButton();} 
// A ficha é renderizada sob demanda pelo módulo de viagens.
document.addEventListener('click',e=>{if(e.target.closest('[data-trip-open]'))setTimeout(ensureTripPrintButton,60);});
function contracts(){try{return typeof CONTRATOS_DB!=='undefined'&&Array.isArray(CONTRATOS_DB)?CONTRATOS_DB:[];}catch(_){return[];}}
function enhanceContracts(){const host=$('#tab-contratos');if(!host||$('#ops-contracts',host))return;const oldRender=global.renderContratos;if(typeof oldRender==='function')global.renderContratos=function(){const result=oldRender.apply(this,arguments);queueMicrotask(renderContracts);return result;};const wrap=document.createElement('section');wrap.id='ops-contracts';wrap.className='ops-card';host.insertBefore(wrap,host.querySelector('.tcard')||host.firstChild);renderContracts();}
function renderContracts(){
 const wrap=$('#ops-contracts');if(!wrap)return;
 const list=contracts().filter(x=>x?.fim).map(c=>({...c,days:daysDiff(c.fim)})).sort((a,b)=>a.days-b.days);
 const alertCount=list.filter(c=>c.days<=Number(c.remindDays||30)).length;
 wrap.innerHTML='<div class="ops-head"><div><h3>Agenda de vencimentos contratuais</h3><p>'+alertCount+' contrato(s) dentro do prazo de aviso. Atualize vencimentos e alertas sem recriar o contrato.</p></div><button id="ops-refresh-contracts">Atualizar</button></div><div class="ops-list">'+list.map(c=>`<div><b>${esc(c.desc||'Contrato')}</b><span>${esc(c.forn||'')} · ${dateBR(c.fim)} · ${c.days<0?'Vencido há '+Math.abs(c.days)+' dias':c.days+' dias restantes'}</span><label>Avisar antes de <select data-contract-days="${esc(c.id||'')}">${[7,15,30,60,90].map(n=>'<option value="'+n+'"'+(Number(c.remindDays||30)===n?' selected':'')+'>'+n+' dias</option>').join('')}</select></label><label>Prorrogar até <input type="date" data-contract-date="${esc(c.id||'')}" value="${esc(c.fim)}"></label><button data-contract-renew="${esc(c.id||'')}">Salvar prazo</button></div>`).join('')+'</div>';
 $('#ops-refresh-contracts').onclick=renderContracts;
 const store=async(id,fields)=>{
  if(!/^[A-Za-z0-9_-]+$/.test(id))return toast('Contrato sem identificador válido.',true);
  const c=contracts().find(x=>String(x.id)===id);if(!c)return toast('Contrato não localizado.',true);
  try{await global.__fbRaw.db.ref('erp/contratos/'+id).update(fields);Object.assign(c,fields);toast('Contrato atualizado.');renderContracts();}
  catch(e){toast('Não foi possível atualizar o contrato no Firebase.',true);}
 };
 $$('[data-contract-days]',wrap).forEach(sel=>sel.onchange=()=>store(sel.dataset.contractDays,{remindDays:Number(sel.value)}));
 $$('[data-contract-renew]',wrap).forEach(btn=>btn.onclick=()=>{
  const id=btn.dataset.contractRenew,input=$('[data-contract-date="'+id+'"]',wrap),value=input?.value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return toast('Informe um vencimento válido.',true);
  if(!confirm('Atualizar o vencimento desse contrato para '+dateBR(value)+'?'))return;
  store(id,{fim:value});
 });
}
document.addEventListener('erp:user-started',()=>{queueMicrotask(installMenu);setTimeout(checkNotices,7000);});
document.addEventListener('erp:ready',()=>{addReportButtons();ensureTab('help_center');});
})(window);
