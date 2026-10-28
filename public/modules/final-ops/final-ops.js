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
let trainingManager=false,trainingData={courses:{},enrollments:{},documents:{},employees:[],erpUsers:[],history:[]},trainingTab='pessoas';
let trainingSelectedEnrollmentId='';
let trainingUploadBusy=false;
let agendaPage=1,contractTablePage=1;
const TRAINING_CHOICES_PER_PAGE=8, CONTRACT_PAGE_SIZE=8;
const searchNorm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const pageCount=(n,size)=>Math.max(1,Math.ceil(n/size));
function ensureTab(id){let panel=$('#tab-'+id);if(!panel){panel=document.createElement('section');panel.id='tab-'+id;panel.className='tab-panel';$('.app-body .content')?.append(panel);}return panel;}
function addNav(group,label,id,icon){const nav=$('#nav-bar');if(!nav||nav.querySelector('[data-tab="'+id+'"]'))return;
  let target=$$('.sb-group',nav).find(g=>$('.sb-glabel',g)?.textContent?.trim()===group);
  if(!target){target=document.createElement('div');target.className='sb-group open';target.innerHTML='<div class="sb-group-hdr"><span class="sb-gicon">'+icon+'</span><span class="sb-glabel">'+esc(group)+'</span><span class="sb-arr">▶</span></div><div class="sb-items"></div>';target.querySelector('.sb-group-hdr').onclick=()=>target.classList.toggle('open');nav.append(target);}
  const a=document.createElement('div');a.className='nav-tab';a.dataset.tab=id;a.innerHTML='<span class="nt-icon">'+icon+'</span><span class="nt-label">'+esc(label)+'</span>';a.onclick=()=>{try{global.switchTab?.(id);}catch(e){console.error(e);}if(id==='matriz_capacitacao')refreshTraining();if(id==='help_center')renderHelp();};$('.sb-items',target).append(a);
}
async function installMenu(){ensureTab('help_center');addNav('Ajuda','Central de ajuda','help_center','?');
  try{
    const profileOwner=global.erpIsElaineOwner?.()===true;
    const t=await rawAuth()?.getIdTokenResult();
    const tokenOwner=Boolean(t?.claims?.admin)&&String(t?.claims?.erpUser||'').toLowerCase()==='elaine';
    // O menu usa a identidade do ERP já autenticado; a API valida as claims
    // do token novamente, inclusive quando a tela é aberta por URL ou script.
    trainingManager=profileOwner || tokenOwner;
    if(trainingManager){ensureTab('matriz_capacitacao');addNav('Administração','Matriz','matriz_capacitacao','▦');}
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
 const courses=courseItems(),employees=(trainingData.employees||[]).filter(e=>e.active!==false),enroll=enrollItems().sort((a,b)=>String(expiry(a)||'9999').localeCompare(String(expiry(b)||'9999')));
 if(tab==='cursos'){
   host.innerHTML=`<div class="ops-split"><form id="ops-new-course" class="ops-card"><h3>Novo curso ou especialização</h3><label>Curso<input name="title" required maxlength="120" placeholder="Operador de empilhadeira"></label><label>Categoria<input name="category" maxlength="60" placeholder="Operação de máquinas"></label><div class="ops-two"><label>Renovar a cada (meses)<input name="renewalMonths" type="number" min="0" max="240" value="12" required></label><label>Avisar com antecedência (dias)<input name="noticeDays" type="number" min="0" max="365" value="30" required></label></div><label>Observações<textarea name="description" maxlength="500"></textarea></label><label class="ops-inline"><input name="mandatory" type="checkbox">Obrigatório</label><button class="ops-primary">Cadastrar curso</button></form><div class="ops-card"><h3>Catálogo</h3><p class="ops-message">Os cursos cadastrados ficam no catálogo. Para registrar conclusão e vencimento de um funcionário, abra Matriz por funcionário e atribua um curso.</p><div class="ops-list">${courses.map(c=>`<div><b>${esc(c.title)}</b><span>${c.renewalMonths?c.renewalMonths+' meses':'Sem renovação'} · aviso ${c.noticeDays} dias</span><button data-archive-course="${esc(c.id)}">Inativar</button></div>`).join('')||'<p>Nenhum curso cadastrado.</p>'}</div></div></div>`;
   $('#ops-new-course').onsubmit=async event=>{event.preventDefault();await submitTraining({action:'course',...Object.fromEntries(new FormData(event.target)),mandatory:event.target.elements.mandatory.checked});};
   $$('[data-archive-course]',host).forEach(b=>b.onclick=()=>submitTraining({action:'archive',kind:'courses',id:b.dataset.archiveCourse}));return;
 }
 if(tab==='pessoas'){
 host.innerHTML=`<div class="ops-split"><form id="ops-new-enrollment" class="ops-card"><h3>Atribuir capacitação</h3><label>Funcionário<select name="employeeId" required><option value="">Selecione</option>${selectOptions(employees.map(e=>({id:e.id,name:e.name})))}</select></label><label>Curso<select name="courseId" required><option value="">Selecione um curso cadastrado</option>${selectOptions(courses.filter(c=>c.active!==false))}</select></label><label>Usuário do ERP que receberá avisos (opcional)<select name="employeeLogin"><option value="">Nenhum usuário vinculado</option>${(trainingData.erpUsers||[]).map(u=>`<option value="${esc(u.login)}">${esc(u.name)} (${esc(u.login)})</option>`).join('')}</select></label><p class="ops-message">Selecione uma conta existente do ERP apenas se esse funcionário utiliza o sistema. Nunca informe senhas. Sem conta, a capacitação continua registrada, mas não recebe aviso pessoal.</p><div class="ops-two"><label>Situação<select name="status"><option value="planejado">A fazer</option><option value="agendado">Agendado</option><option value="concluido">Concluído</option><option value="dispensado">Dispensado</option></select></label><label>Previsão<input type="date" name="scheduledAt"></label><label>Data de conclusão<input type="date" name="completedAt"></label><label>Vencimento (opcional)<input type="date" name="expiresAt"></label><label>Mostrar aviso a partir de<input type="date" name="notifyAt"></label></div><label class="ops-inline"><input type="checkbox" name="notifyEnabled">Exibir aviso na conta selecionada do ERP</label><label>Observação<textarea name="notes" maxlength="500"></textarea></label><button class="ops-primary">Salvar vínculo</button></form><div class="ops-card"><h3>Matriz de funcionários</h3><p class="ops-message">${courses.filter(c=>c.active!==false).length} curso(s) disponível(is): ${courses.filter(c=>c.active!==false).map(c=>esc(c.title)).join(' · ')||'nenhum cadastrado'}. ${!enroll.length?'Para aparecer na matriz, primeiro vincule um curso a um funcionário.':''}</p><input id="ops-enroll-filter" placeholder="Buscar funcionário ou curso" type="search"><div id="ops-enroll-list" class="ops-list">${enroll.map(e=>`<div data-matrix-row="${esc((employeeName(e.employeeId)+' '+courseName(e.courseId)).toLowerCase())}"><b>${esc(employeeName(e.employeeId))}</b><span>${esc(courseName(e.courseId))} · ${esc(badgeFor(e))}${expiry(e)?' · '+dateBR(expiry(e)):''}</span><button data-edit-enroll="${esc(e.id)}">Editar</button></div>`).join('')||'<p>Nenhum vínculo cadastrado.</p>'}</div></div></div>`;
 $('#ops-new-enrollment').onsubmit=async event=>{event.preventDefault();const form=event.target;
   if(form.elements.notifyEnabled.checked&&!form.elements.employeeLogin.value)return toast('Selecione o usuário do ERP para exibir avisos ou desmarque a opção.',true);
   await submitTraining({action:'enroll',...Object.fromEntries(new FormData(form)),notifyEnabled:form.elements.notifyEnabled.checked,id:form.dataset.id||undefined});};
 const loginField=$('#ops-new-enrollment').elements.employeeLogin;
 loginField.addEventListener('change',()=>{if(!loginField.value)$('#ops-new-enrollment').elements.notifyEnabled.checked=false;});
 $('#ops-enroll-filter').oninput=e=>$$('[data-matrix-row]',host).forEach(row=>row.hidden=!row.dataset.matrixRow.includes(e.target.value.toLowerCase()));
 $$('[data-edit-enroll]',host).forEach(b=>b.onclick=()=>{const e=trainingData.enrollments[b.dataset.editEnroll],form=$('#ops-new-enrollment');form.dataset.id=e.id;for(const [key,value] of Object.entries(e)){if(form.elements[key]&&form.elements[key].type!=='checkbox')form.elements[key].value=value||'';}form.elements.notifyEnabled.checked=Boolean(e.notifyEnabled);form.scrollIntoView({behavior:'smooth'});});return;
 }
 if(tab==='certificados'){
   const activeCourses=courses.filter(c=>c.active!==false);
   const enrollOptions=enroll.map(e=>({id:e.id,name:employeeName(e.employeeId)+' — '+courseName(e.courseId)}));
   const canLink=employees.length>0&&activeCourses.length>0;
   host.innerHTML=`<div class="ops-card ops-training-documents"><div class="ops-head"><div><h3>Documentos e certificados</h3><p>Vincule primeiro o curso ao funcionário para anexar seu certificado. Anexos PDF ou imagem de até 10 MB. Acesso restrito à Elaine.</p></div><span class="ops-doc-count">${Object.keys(trainingData.documents||{}).length} anexo(s)</span></div>
   ${!enroll.length?`<div class="ops-training-empty" role="status"><strong>Nenhuma capacitação vinculada a funcionário.</strong><p>${!activeCourses.length?'Cadastre primeiro um curso em Catálogo de cursos.':!employees.length?'Cadastre primeiro o funcionário no RH.':'Selecione um funcionário e um curso para criar o primeiro vínculo; depois você poderá anexar o certificado.'}</p></div>`:''}
   <form id="ops-quick-enroll" class="ops-training-link-box"><h4>Vincular curso a funcionário</h4><div class="ops-training-fields"><label>Funcionário<select name="employeeId" required ${!employees.length?'disabled':''}><option value="">Selecione o funcionário</option>${selectOptions(employees.map(e=>({id:e.id,name:e.name})))}</select></label><label>Curso cadastrado<select name="courseId" required ${!activeCourses.length?'disabled':''}><option value="">Selecione o curso</option>${selectOptions(activeCourses.map(c=>({id:c.id,name:c.title})))}</select></label><button class="ops-primary" type="submit" ${!canLink?'disabled':''}>Vincular capacitação</button></div><p class="ops-hint">Se já estiver vinculado, basta selecionar a capacitação abaixo. O vínculo não indica conclusão do curso.</p></form>
   <form id="ops-upload-doc" class="ops-form"><h4>Anexar certificado</h4><div class="ops-training-enroll-picker"><label for="ops-training-picker-toggle">Capacitação do funcionário</label><div id="ops-training-current" class="ops-training-current" role="status">Nenhuma capacitação selecionada</div><button type="button" id="ops-training-picker-toggle" class="ops-training-picker-toggle" aria-expanded="false" aria-controls="ops-training-picker-panel" ${!enrollOptions.length?'disabled':''}>${enrollOptions.length?'Selecionar capacitação ('+enrollOptions.length+' vínculos)':'Nenhuma capacitação disponível'}</button><div id="ops-training-picker-panel" class="ops-training-picker-panel" hidden><label for="ops-training-enroll-search">Pesquisar funcionário ou curso</label><input id="ops-training-enroll-search" type="search" placeholder="Digite um nome ou curso" autocomplete="off"><div id="ops-training-enroll-options" class="ops-training-enroll-list" role="radiogroup" aria-label="Selecione a capacitação do funcionário"></div><p id="ops-training-enroll-empty" class="ops-hint" hidden>Nenhuma capacitação corresponde à busca.</p><div id="ops-training-choice-pager" class="ops-pagination"></div></div></div><label>Arquivo PDF ou imagem<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" required ${!enrollOptions.length?'disabled':''}></label><button class="ops-primary" type="submit" ${!enrollOptions.length?'disabled':''}>Anexar certificado</button><div id="ops-training-upload-feedback" class="ops-training-upload-feedback" role="status" aria-live="polite" hidden><span id="ops-training-upload-label">Preparando arquivo…</span><progress id="ops-training-upload-progress" max="100" value="0"></progress></div></form>
   <div class="ops-list">${Object.values(trainingData.documents||{}).map(d=>`<div><b>${esc(d.name)}</b><span>${esc(employeeName(trainingData.enrollments[d.enrollmentId]?.employeeId))} · ${esc(courseName(trainingData.enrollments[d.enrollmentId]?.courseId))}</span><button data-open-doc="${esc(d.id)}">Abrir</button><button data-delete-doc="${esc(d.id)}">Excluir</button></div>`).join('')||'<p class="ops-hint">Nenhum certificado anexado.</p>'}</div></div>`;
   $('#ops-quick-enroll',host).onsubmit=async event=>{
     event.preventDefault();const form=event.currentTarget,employeeId=form.elements.employeeId.value,courseId=form.elements.courseId.value;
     if(!employeeId||!courseId)return toast('Selecione o funcionário e o curso.',true);
     const existing=enroll.find(e=>e.employeeId===employeeId&&e.courseId===courseId&&e.status!=='dispensado');
     if(existing){trainingSelectedEnrollmentId=existing.id;$('#ops-training-current',host).textContent=employeeName(existing.employeeId)+' — '+courseName(existing.courseId);$('#ops-training-current',host).classList.add('is-picked');return toast('Este vínculo já existe e foi selecionado para anexar o certificado.');}
     try{await request(null,{action:'enroll',employeeId,courseId,status:'planejado',notifyEnabled:false});toast('Capacitação vinculada. Selecione-a para anexar o certificado.');await refreshTraining();}catch(e){toast(e.message,true);}
   };
   const pickerToggle=$('#ops-training-picker-toggle',host),pickerPanel=$('#ops-training-picker-panel',host);
   const choiceList=$('#ops-training-enroll-options',host),search=$('#ops-training-enroll-search',host);
   const choicePager=$('#ops-training-choice-pager',host),choiceCurrent=$('#ops-training-current',host);
   if(!enroll.some(e=>e.id===trainingSelectedEnrollmentId))trainingSelectedEnrollmentId='';
   let choicePage=1;
   const setPickerOpen=open=>{pickerPanel.hidden=!open;pickerToggle.setAttribute('aria-expanded',String(open));if(open)search.focus();};
   const updateCurrent=()=>{const selected=enroll.find(e=>e.id===trainingSelectedEnrollmentId);choiceCurrent.textContent=selected?employeeName(selected.employeeId)+' — '+courseName(selected.courseId):'Nenhuma capacitação selecionada';choiceCurrent.classList.toggle('is-picked',!!selected);pickerToggle.textContent=selected?'Alterar capacitação':'Selecionar capacitação ('+enroll.length+' vínculos)';};
   const showChoices=()=>{
     const q=searchNorm(search.value);
     const options=enroll.filter(e=>searchNorm(employeeName(e.employeeId)+' '+courseName(e.courseId)).includes(q));
     choicePage=Math.min(choicePage,pageCount(options.length,TRAINING_CHOICES_PER_PAGE));
     const start=(choicePage-1)*TRAINING_CHOICES_PER_PAGE;
     choiceList.innerHTML=options.slice(start,start+TRAINING_CHOICES_PER_PAGE).map(e=>`<label class="ops-training-enroll-item" data-enroll-id="${esc(e.id)}"><input name="enrollmentId" type="radio" value="${esc(e.id)}" ${e.id===trainingSelectedEnrollmentId?'checked':''}><span><strong>${esc(employeeName(e.employeeId))}</strong><small>${esc(courseName(e.courseId))}</small></span></label>`).join('');
     $('#ops-training-enroll-empty',host).hidden=options.length>0;
     choicePager.innerHTML=options.length?`<span>${start+1}–${Math.min(start+TRAINING_CHOICES_PER_PAGE,options.length)} de ${options.length} vínculos</span><button type="button" data-page="prev" ${choicePage===1?'disabled':''}>Anterior</button><span>Página ${choicePage} de ${pageCount(options.length,TRAINING_CHOICES_PER_PAGE)}</span><button type="button" data-page="next" ${choicePage>=pageCount(options.length,TRAINING_CHOICES_PER_PAGE)?'disabled':''}>Próxima</button>`:'';
   };
   pickerToggle.addEventListener('click',()=>{setPickerOpen(pickerPanel.hidden);if(!pickerPanel.hidden)showChoices();});
   search.addEventListener('input',()=>{choicePage=1;showChoices();});
   choiceList.addEventListener('change',event=>{const radio=event.target.closest('input[name="enrollmentId"]');if(!radio)return;trainingSelectedEnrollmentId=radio.value;updateCurrent();setPickerOpen(false);});
   choicePager.addEventListener('click',event=>{const btn=event.target.closest('button[data-page]');if(!btn)return;choicePage+=btn.dataset.page==='next'?1:-1;showChoices();});
   updateCurrent();
   $('#ops-upload-doc',host).onsubmit=uploadTrainingDoc;
   $$('[data-open-doc]',host).forEach(b=>b.onclick=()=>openTrainingDoc(b.dataset.openDoc));
   $$('[data-delete-doc]',host).forEach(b=>b.onclick=()=>{if(confirm('Excluir este certificado permanentemente?'))submitTraining({action:'removeDocument',id:b.dataset.deleteDoc});});return;
 }
 host.innerHTML=`<div class="ops-card"><h3>Vencimentos e avisos</h3><p>Avisos são exibidos no ERP conforme o login do funcionário, sem envio de mensagens externas.</p><div class="ops-list">${enroll.filter(e=>badgeFor(e)!=='Em dia').map(e=>`<div><b>${esc(employeeName(e.employeeId))}</b><span>${esc(courseName(e.courseId))} · ${esc(badgeFor(e))} · ${dateBR(expiry(e))}${e.notifyEnabled?' · aviso ativo':' · aviso desativado'}</span></div>`).join('')||'<p>Nenhum vencimento pendente.</p>'}</div></div>`;
}
async function submitTraining(body){try{await request(null,body);toast('Registro atualizado.');await refreshTraining();}catch(e){toast(e.message,true);}}
// O mesmo arquivo enviado para o mesmo vínculo gera sempre o mesmo ID.
// Isso evita documentos duplicados após F5, falhas de rede ou cliques repetidos.
async function trainingDocumentId(enrollmentId,file){
 const hashBytes=new Uint8Array(await global.crypto.subtle.digest('SHA-256',await file.arrayBuffer()));
 const hash=Array.from(hashBytes,b=>b.toString(16).padStart(2,'0')).join('');
 const scoped=new TextEncoder().encode(enrollmentId+':'+hash);
 const scopedBytes=new Uint8Array(await global.crypto.subtle.digest('SHA-256',scoped));
 return 'TM'+Array.from(scopedBytes,b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);
}
async function trainingObjectMetadata(ref){
 try{return await ref.getMetadata();}
 catch(e){if(e?.code==='storage/object-not-found')return null;throw e;}
}
async function uploadTrainingDoc(event){
 event.preventDefault();
 // O lock é adquirido SINCRONAMENTE antes de qualquer await.
 if(trainingUploadBusy)return;
 const form=event.currentTarget||event.target;
 const file=form.elements.file.files[0];
 const enrollmentId=form.querySelector('input[name="enrollmentId"]:checked')?.value||trainingSelectedEnrollmentId||'';
 if(!enrollmentId)return toast('Selecione a capacitação do funcionário para anexar o certificado.',true);
 const extensions={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 if(!file||file.size>10*1024*1024||file.size<1||!extensions[file.type])return toast('Utilize PDF ou imagem até 10 MB.',true);
 trainingUploadBusy=true;
 const button=form.querySelector('button[type="submit"]'),buttonText=button?.textContent;
 const input=form.elements.file,picker=$('#ops-training-picker-toggle');
 const feedback=$('#ops-training-upload-feedback',form),label=$('#ops-training-upload-label',form),bar=$('#ops-training-upload-progress',form);
 if(button){button.disabled=true;button.textContent='Enviando…';}
 if(input)input.disabled=true;
 if(picker)picker.disabled=true;
 if(feedback)feedback.hidden=false;
 const status=(message,progress)=>{if(label)label.textContent=message;if(bar&&Number.isFinite(progress))bar.value=progress;};
 try{
   status('Preparando certificado…',0);
   const id=await trainingDocumentId(enrollmentId,file);
   // Um arquivo já confirmado na matriz não precisa ser enviado novamente.
   if(trainingData.documents?.[id]){toast('Este certificado já foi anexado a esta capacitação.');return;}
   const extension=extensions[file.type],path=`erp-files/training/${enrollmentId}/${id}.${extension}`;
   const ref=global.__fbRaw.storage.ref(path);
   status('Verificando se o arquivo já existe…',0);
   let metadata=await trainingObjectMetadata(ref);
   if(!metadata){
     status('Enviando certificado: 0%',0);
     try{
       const task=ref.put(file,{contentType:file.type});
       if(typeof task.on==='function')task.on('state_changed',snapshot=>{
         const percentage=snapshot.totalBytes?Math.min(100,Math.round(100*snapshot.bytesTransferred/snapshot.totalBytes)):0;
         status(`Enviando certificado: ${percentage}%`,percentage);
       });
       await task;
     }catch(uploadError){
       // Outra aba pode ter criado exatamente o mesmo objeto nesse intervalo.
       metadata=await trainingObjectMetadata(ref);
       if(!metadata)throw uploadError;
     }
   }
   if(metadata&&(Number(metadata.size)!==file.size||metadata.contentType!==file.type))throw Error('Já existe um anexo com identificador conflitante. Não foi substituído.');
   status('Confirmando o registro do certificado…',100);
   const result=await request(null,{action:'document',enrollmentId,id,extension,name:file.name});
   // Sem um GET de toda a matriz depois do upload (economiza latência).
   trainingData.documents[id]=result.document||{id,enrollmentId,name:file.name,path,createdAt:new Date().toISOString()};
   toast(result.alreadyExists?'Este certificado já estava anexado.':'Certificado anexado com sucesso.');
   if(trainingTab==='certificados'&&$('#ops-training-main'))renderTraining();
 }catch(e){
   status('Não foi possível concluir o envio. Confira a conexão e tente novamente.',0);
   toast(e.message||'Erro ao enviar certificado.',true);
 }finally{
   trainingUploadBusy=false;
   if(button){button.disabled=false;button.textContent=buttonText;}
   if(input)input.disabled=false;
   if(picker)picker.disabled=false;
 }
}
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
function ensureReports(containerId,id,label,printer){
 const host=$('#'+containerId);if(!host||$('#'+id,host))return;
 const box=document.createElement('section');box.className='ops-report';box.id=id;
 box.innerHTML='<label>Competência<input type="month" value="'+nowMonth()+'" aria-label="Mês do relatório"></label><label>Motorista<select aria-label="Filtrar por motorista"></select></label><button type="button">'+esc(label)+'</button>';
 host.prepend(box);
 const select=$('select',box),input=$('input',box),isFuel=containerId==='tab-combustivel_rudnick';
 // As listas chegam do Firebase DEPOIS do primeiro render da página. Atualizar
 // antes de abrir o filtro evita o select com apenas “Todos”.
 const refreshOptions=()=>{
   const previous=select.value;
   const list=isFuel?fuelEntries():tripEntries();
   const names=[...new Set(list.map(row=>String(row.motorista||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
   select.replaceChildren(new Option('Todos os motoristas',''));
   names.forEach(name=>select.add(new Option(name,name)));
   if(names.includes(previous))select.value=previous;
 };
 refreshOptions();
 ['focus','pointerdown','keydown'].forEach(type=>select.addEventListener(type,refreshOptions));
 // Ao entrar novamente em Combustível/Viagens, o Firebase pode ter concluído a carga.
 document.addEventListener('click',event=>{
   const nav=event.target.closest('[data-tab]');
   if(nav?.dataset.tab===containerId.slice(4))queueMicrotask(refreshOptions);
 });
 $('button',box).onclick=()=>{refreshOptions();printer(input.value,select.value);};
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
function enhanceContracts(){
 const host=$('#tab-contratos');if(!host||$('#ops-contracts',host))return;
 const oldRender=global.renderContratos;
 if(typeof oldRender==='function')global.renderContratos=function(){const result=oldRender.apply(this,arguments);queueMicrotask(()=>{renderContracts();paginateContractTable();});return result;};
 const wrap=document.createElement('section');wrap.id='ops-contracts';wrap.className='ops-card';
 host.insertBefore(wrap,host.querySelector('.tcard')||host.firstChild);
 const table=$('#tb-contratos',host)?.closest('table');
 if(table&&!$('#ops-contract-table-pager',host)){
   const pager=document.createElement('nav');pager.id='ops-contract-table-pager';pager.className='ops-pagination';pager.setAttribute('aria-label','Paginação de contratos');table.insertAdjacentElement('afterend',pager);
   pager.addEventListener('click',event=>{const b=event.target.closest('button[data-contract-table-page]');if(!b)return;contractTablePage+=b.dataset.contractTablePage==='next'?1:-1;paginateContractTable();});
 }
 // A pesquisa legada altera display; a paginação é aplicada depois sem alterar
 // os índices que são usados por visualizar, renomear, baixar e excluir anexos.
 host.addEventListener('input',event=>{if(!event.target.matches('.phase1-admin-search'))return;contractTablePage=1;queueMicrotask(paginateContractTable);});
 renderContracts();paginateContractTable();
}
function paginateContractTable(){
 const host=$('#tab-contratos'),body=$('#tb-contratos',host),pager=$('#ops-contract-table-pager',host);if(!body||!pager)return;
 const rows=Array.from(body.rows),query=searchNorm(host.querySelector('.phase1-admin-search')?.value);
 if(!contracts().length){rows.forEach(row=>{row.hidden=false;row.style.display='';});pager.hidden=true;pager.textContent='';return;}
 const matching=rows.filter(r=>!query||searchNorm(r.textContent).includes(query));
 contractTablePage=Math.min(Math.max(1,contractTablePage),pageCount(matching.length,CONTRACT_PAGE_SIZE));
 const first=(contractTablePage-1)*CONTRACT_PAGE_SIZE;
 const visible=new Set(matching.slice(first,first+CONTRACT_PAGE_SIZE));
 rows.forEach(row=>{row.hidden=!visible.has(row);row.style.display=visible.has(row)?'':'none';});
 pager.hidden=matching.length<=CONTRACT_PAGE_SIZE;
 pager.innerHTML=matching.length?`<span>Exibindo ${Math.min(first+1,matching.length)}–${Math.min(first+CONTRACT_PAGE_SIZE,matching.length)} de ${matching.length} contratos</span><button type="button" data-contract-table-page="prev" ${contractTablePage===1?'disabled':''}>Anterior</button><span>Página ${contractTablePage} de ${pageCount(matching.length,CONTRACT_PAGE_SIZE)}</span><button type="button" data-contract-table-page="next" ${contractTablePage>=pageCount(matching.length,CONTRACT_PAGE_SIZE)?'disabled':''}>Próxima</button>`:'<span>Nenhum contrato corresponde à pesquisa.</span>';
}
function renderContracts(){
 const wrap=$('#ops-contracts');if(!wrap)return;
 const entries=contracts();
 const dated=entries.filter(c=>/^\d{4}-\d{2}-\d{2}$/.test(c?.fim||'')).map(c=>({...c,days:daysDiff(c.fim)})).sort((a,b)=>a.days-b.days);
 const overdue=dated.filter(c=>c.days<0),soon=dated.filter(c=>c.days>=0&&c.days<=Number(c.remindDays??30));
 const withoutDate=entries.length-dated.length;
 const label=c=>c.days<0?`Vencido há ${Math.abs(c.days)} dia(s)`:c.days===0?'Vence hoje':`Vence em ${c.days} dia(s)`;
 agendaPage=Math.min(Math.max(1,agendaPage),pageCount(dated.length,CONTRACT_PAGE_SIZE));
 const first=(agendaPage-1)*CONTRACT_PAGE_SIZE,part=dated.slice(first,first+CONTRACT_PAGE_SIZE);
 const items=part.map(c=>`<div class="ops-contract-row"><div class="ops-contract-description"><b>${esc(c.desc||'Contrato')} ${c.days<0?'(VENCIDO)':''}</b><span>${esc(c.forn||'Sem fornecedor')} · Fim ${dateBR(c.fim)} · ${label(c)}</span></div><label>Avisar antes de <select data-contract-days="${esc(c.id||'')}">${[7,15,30,60,90].map(n=>`<option value="${n}"${Number(c.remindDays??30)===n?' selected':''}>${n} dias</option>`).join('')}</select></label><label>Nova data de término <input type="date" data-contract-date="${esc(c.id||'')}" value="${esc(c.fim)}"></label><button type="button" data-contract-renew="${esc(c.id||'')}">Atualizar contrato</button></div>`).join('');
 wrap.innerHTML=`<div class="ops-head"><div><h3>Agenda de vencimentos contratuais</h3><p>Agenda gerada pela data <strong>Fim</strong> dos contratos cadastrados abaixo. O aluguel já está cadastrado como contrato; não é um novo lançamento financeiro.</p><div class="ops-contract-summary"><span><strong>${overdue.length}</strong> vencidos</span><span><strong>${soon.length}</strong> a vencer</span><span><strong>${withoutDate}</strong> sem término</span></div></div><button type="button" id="ops-refresh-contracts">Atualizar</button></div><div class="ops-list ops-contract-list">${items||'<p>Nenhum contrato com data de término. Cadastre um contrato informando o campo Fim para incluí-lo na agenda.</p>'}</div><nav id="ops-contract-agenda-pager" class="ops-pagination" aria-label="Paginação da agenda" ${dated.length<=CONTRACT_PAGE_SIZE?'hidden':''}><span>${dated.length?`Exibindo ${first+1}–${Math.min(first+CONTRACT_PAGE_SIZE,dated.length)} de ${dated.length} vencimentos`:''}</span><button type="button" data-agenda-page="prev" ${agendaPage===1?'disabled':''}>Anterior</button><span>Página ${agendaPage} de ${pageCount(dated.length,CONTRACT_PAGE_SIZE)}</span><button type="button" data-agenda-page="next" ${agendaPage>=pageCount(dated.length,CONTRACT_PAGE_SIZE)?'disabled':''}>Próxima</button></nav><p class="ops-hint">Alterar o prazo aqui não renova, paga ou quita parcelas em Contas a Pagar.</p>`;
 const status=$('#kpi-cont-status'),sub=$('#kpi-cont-sub'),count=$('#kpi-cont-total');
 if(status){status.textContent=String(overdue.length);status.classList.toggle('ops-contract-has-overdue',overdue.length>0);}
 if(sub)sub.textContent=overdue.length?(overdue.length===1?'Contrato fora do prazo':'Contratos fora do prazo'):(soon.length?`${soon.length} a vencer em breve`:'Nenhum contrato vencido');
 if(count)count.textContent=String(entries.length);
 $('#ops-refresh-contracts').onclick=()=>{renderContracts();paginateContractTable();};
 $$('[data-agenda-page]',wrap).forEach(button=>button.onclick=()=>{agendaPage+=button.dataset.agendaPage==='next'?1:-1;renderContracts();});
 const store=async(id,fields)=>{
  if(!/^[A-Za-z0-9_-]{4,100}$/.test(id))return toast('Contrato sem identificador válido.',true);
  const c=contracts().find(x=>String(x.id)===id);if(!c)return toast('Contrato não localizado.',true);
  const db=global._fbDB||global.__fbRaw?.db;
  if(!db?.ref)return toast('Firebase não disponível. Nenhuma alteração realizada.',true);
  try{
   const ref=db.ref('erp/contratos/'+id);
   const snap=await ref.child('id').once('value');
   if(String(snap.val()||'')!==id)throw Error('O contrato não existe na nuvem. Atualize antes de editar.');
   await ref.update(fields);Object.assign(c,fields);toast('Prazo do contrato salvo.');renderContracts();
  }catch(e){toast(e.message||'Não foi possível atualizar o contrato.',true);renderContracts();}
 };
 $$('[data-contract-days]',wrap).forEach(sel=>sel.onchange=()=>store(sel.dataset.contractDays,{remindDays:Number(sel.value)}));
 $$('[data-contract-renew]',wrap).forEach(btn=>btn.onclick=()=>{
  const id=btn.dataset.contractRenew,input=$('[data-contract-date="'+id+'"]',wrap),value=input?.value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||Number.isNaN(Date.parse(value)))return toast('Informe um vencimento válido.',true);
  const old=contracts().find(c=>String(c.id)===id)?.fim;
  if(value===old)return toast('A data de término não foi alterada.');
  if(!confirm('Alterar a data Fim desse contrato de '+dateBR(old)+' para '+dateBR(value)+'?'))return;
  store(id,{fim:value});
 });
}
document.addEventListener('erp:user-started',()=>{queueMicrotask(installMenu);setTimeout(checkNotices,7000);});
document.addEventListener('erp:ready',()=>{addReportButtons();ensureTab('help_center');});
})(window);
