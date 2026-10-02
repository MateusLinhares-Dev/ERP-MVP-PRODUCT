function _agdHoje(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function _agdBr(iso){ if(!iso) return '?'; const p=String(iso).split('-'); return p.length===3 ? (p[2]+'/'+p[1]+'/'+p[0]) : iso; }
function agendaPersist(){ try{ localStorage.setItem('mm_agenda', JSON.stringify(AGENDA_DB)); }catch(e){} }
function agendaNovo(){
  const data=document.getElementById('agd-data').value;
  const hora=document.getElementById('agd-hora').value;
  const tipo=document.getElementById('agd-tipo').value;
  const nome=(document.getElementById('agd-nome').value||'').trim();
  const material=(document.getElementById('agd-material').value||'').trim();
  const obs=(document.getElementById('agd-obs').value||'').trim();
  if(!data){ showToast('Escolha a data da entrega','error'); return; }
  if(!nome){ showToast('Informe o nome do fornecedor/cliente','error'); return; }
  const _rdEl=document.getElementById('agd-rep-dias');
  const _rmEl=document.getElementById('agd-rep-meses');
  const repDias=_rdEl?(parseInt(_rdEl.value,10)||0):0;
  const repMeses=_rmEl?(parseInt(_rmEl.value,10)||3):3;
  const datas=[data];
  if(repDias>0){
    const p=data.split('-').map(Number);
    const fim=new Date(p[0],p[1]-1+repMeses,p[2],23,59,59);
    for(let k=1;k<=500;k++){
      const d=new Date(p[0],p[1]-1,p[2]+repDias*k);
      if(d>fim) break;
      datas.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));
    }
  }
  datas.forEach(function(dt){
    AGENDA_DB.push({ id:_syncAgenda.novoId(), data:dt, hora:hora||'', tipo:tipo, nome:nome, material:material, obs:obs, status:'Agendado', criadoPor:(typeof cu!=='undefined'&&cu)?cu.name:'', _upd:Date.now() });
  });
  agendaPersist(); try{ fbSalvar(); }catch(e){}
  document.getElementById('agd-nome').value=''; document.getElementById('agd-material').value=''; document.getElementById('agd-obs').value='';
  if(_rdEl) _rdEl.value='';
  showToast(datas.length>1 ? ('✅ '+datas.length+' entregas agendadas pra '+nome+' (horário fixo '+(hora||'sem hora')+')') : ('✅ Entrega agendada: '+nome),'success');
  agendaRender();
}
function agendaStatus(id, novo){
  const it=AGENDA_DB.find(a=>a&&a.id===id); if(!it) return;
  it.status=novo; it._upd=Date.now();
  agendaPersist(); try{ fbSalvar(); }catch(e){}
  agendaRender();
}
function agendaExcluir(id){
  const it=AGENDA_DB.find(a=>a&&a.id===id); if(!it) return;
  if(!confirm('Excluir o agendamento de '+(it.nome||'?')+'?')) return;
  const _pos=AGENDA_DB.indexOf(it);
  try{ _syncAgenda.remover(_pos); }catch(e){ if(_pos>=0) AGENDA_DB.splice(_pos,1); }
  agendaPersist(); try{ fbSalvar(); }catch(e){}
  agendaRender();
}
function _agdTelefonePor(nome){
  const alvo=String(nome||'').trim().toUpperCase();
  let tel='';
  try{ (typeof FORNECEDORES!=='undefined'?FORNECEDORES:[]).forEach(f=>{ if(f&&f.nome&&String(f.nome).toUpperCase()===alvo && (f.tel||f.telefone)) tel=f.tel||f.telefone; }); }catch(e){}
  if(!tel){ try{ (typeof CLIENTES!=='undefined'?CLIENTES:[]).forEach(c=>{ if(c&&c.nome&&String(c.nome).toUpperCase()===alvo && (c.tel||c.telefone)) tel=c.tel||c.telefone; }); }catch(e){} }
  return tel;
}
function agendaWhats(id){
  const a=AGENDA_DB.find(x=>x&&x.id===id); if(!a) return;
  let tel=_agdTelefonePor(a.nome);
  tel=String(tel||'').replace(/\D/g,'');
  if(!tel){
    const dig=prompt('Não achei o WhatsApp de "'+a.nome+'" no cadastro.\nDigite o número com DDD (só números):','47');
    if(!dig) return;
    tel=String(dig).replace(/\D/g,'');
  }
  if(tel.length===10||tel.length===11) tel='55'+tel;
  if(tel.length<12){ showToast('Número inválido — confira o DDD','error'); return; }
  const msg='Olá, '+a.nome+'! 👋\n\nConfirmando sua entrega agendada na *'+(typeof _empresaPrincipalLabel==='function'?_empresaPrincipalLabel():'')+'*:\n📅 Data: '+_agdBr(a.data)+(a.hora?('\n🕐 Horário: '+a.hora):'')+(a.material?('\n📦 Material: '+a.material):'')+'\n\n📍 '+(typeof _empresaPrincipalEnderecoCurto==='function'?_empresaPrincipalEnderecoCurto():'')+'\n\nDetalhes como placa do veículo acertamos no dia. Qualquer imprevisto, é só avisar. Obrigado!';
  window.open('https://wa.me/'+tel+'?text='+encodeURIComponent(msg),'_blank');
}
function agendaRender(){
  const tb=document.getElementById('agd-tbody'); if(!tb) return;
  try{ agdCalRender(); }catch(e){}
  try{ agdTimelineRender(); }catch(e){}
  const fEl=document.getElementById('agd-filtro-data');
  if(fEl && !fEl.value) fEl.value=_agdHoje();
  const dEl=document.getElementById('agd-data'); if(dEl && !dEl.value) dEl.value=_agdHoje();
  try{
    const dl=document.getElementById('agd-nomes');
    if(dl){
      const tipoSel=(document.getElementById('agd-tipo')||{}).value||'Fornecedor';
      const nomes=new Set();
      if(tipoSel==='Cliente'){
        (typeof CLIENTES!=='undefined'?CLIENTES:[]).forEach(c=>{ if(c&&c.nome) nomes.add(c.nome); });
      } else {
        (typeof FORNECEDORES!=='undefined'?FORNECEDORES:[]).forEach(f=>{
          if(f&&f.nome && !(typeof FORN_DELETED!=='undefined' && FORN_DELETED.has(f.cod))) nomes.add(f.nome);
        });
      }
      dl.innerHTML=[...nomes].sort().map(n=>'<option value="'+String(n).replace(/"/g,'&quot;')+'">').join('');
    }
  }catch(e){}
  const dia=fEl?fEl.value:_agdHoje();
  const todas=document.getElementById('agd-ver-todas') && document.getElementById('agd-ver-todas').checked;
  let itens=AGENDA_DB.filter(Boolean);
  if(todas){
    const lim=new Date(dia+'T12:00:00'); lim.setDate(lim.getDate()+15);
    const limIso=lim.getFullYear()+'-'+String(lim.getMonth()+1).padStart(2,'0')+'-'+String(lim.getDate()).padStart(2,'0');
    itens=itens.filter(a=>a.data>=dia && a.data<=limIso);
  } else {
    itens=itens.filter(a=>a.data===dia);
  }
  itens.sort((a,b)=>((a.data+' '+(a.hora||''))<(b.data+' '+(b.hora||''))?-1:1));
  const hoje=_agdHoje();
  const kH=document.getElementById('agd-kpi-hoje'); if(kH) kH.textContent=AGENDA_DB.filter(a=>a&&a.data===hoje).length;
  const kA=document.getElementById('agd-kpi-aguardando'); if(kA) kA.textContent=itens.filter(a=>a.status==='Agendado').length;
  const kC=document.getElementById('agd-kpi-chegou'); if(kC) kC.textContent=itens.filter(a=>a.status==='Chegou').length;
  if(!itens.length){ tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:#999;padding:14px">Nenhuma entrega '+(todas?'nos próximos 15 dias':'neste dia')+'</td></tr>'; return; }
  const esc=t=>String(t==null?'':t).replace(/</g,'&lt;');
  tb.innerHTML=itens.map(a=>{
    const chip=a.status==='Chegou' ? '<span style="background:#c8e6c9;color:#1b5e20;padding:3px 10px;border-radius:12px;font-size:.75rem;font-weight:700">✅ Chegou</span>'
      : a.status==='Cancelado' ? '<span style="background:#eee;color:#777;padding:3px 10px;border-radius:12px;font-size:.75rem;font-weight:700">✖ Cancelado</span>'
      : '<span style="background:#fff3cd;color:#8a6d00;padding:3px 10px;border-radius:12px;font-size:.75rem;font-weight:700">🕐 Agendado</span>';
    const acoes=(a.status==='Agendado'
      ? '<button class="btn-save" style="padding:4px 10px;font-size:.75rem" onclick="agendaStatus(\''+a.id+'\',\'Chegou\')">✅ Chegou</button> '+
        '<button class="btn-edit" style="padding:4px 10px;font-size:.75rem;background:#9e9e9e;color:#fff" onclick="agendaStatus(\''+a.id+'\',\'Cancelado\')">✖</button> '
      : '<button class="btn-edit" style="padding:4px 10px;font-size:.75rem" onclick="agendaStatus(\''+a.id+'\',\'Agendado\')">↩ Voltar</button> ')+
      '<button class="btn-save" style="padding:4px 10px;font-size:.75rem;background:#25D366" onclick="agendaWhats(\''+a.id+'\')">📱 Whats</button> '+
      '<button class="btn-edit" style="padding:4px 10px;font-size:.75rem;background:#e53935;color:#fff" onclick="agendaExcluir(\''+a.id+'\')">🗑</button>';
    return '<tr><td>'+_agdBr(a.data)+'</td><td>'+esc(a.hora)+'</td><td>'+esc(a.tipo)+'</td><td><b>'+esc(a.nome)+'</b></td><td>'+esc(a.material)+'</td><td>'+esc(a.obs)+'</td><td>'+chip+'</td><td style="white-space:nowrap">'+acoes+'</td></tr>';
  }).join('');
}
var _agdCalRef=null;
function agdCalMudar(delta){
  if(!_agdCalRef){ const h=new Date(); _agdCalRef=new Date(h.getFullYear(),h.getMonth(),1); }
  _agdCalRef=new Date(_agdCalRef.getFullYear(),_agdCalRef.getMonth()+delta,1);
  agdCalRender();
}
function agdCalDia(iso){
  const f=document.getElementById('agd-filtro-data'); if(f) f.value=iso;
  const t=document.getElementById('agd-ver-todas'); if(t) t.checked=false;
  agendaRender();
}
function agdCalRender(){
  const el=document.getElementById('agd-cal'); if(!el) return;
  if(!_agdCalRef){ const h=new Date(); _agdCalRef=new Date(h.getFullYear(),h.getMonth(),1); }
  const ano=_agdCalRef.getFullYear(), mes=_agdCalRef.getMonth();
  const tit=document.getElementById('agd-cal-titulo');
  if(tit) tit.textContent=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][mes]+' / '+ano;
  const esc=function(t){ return String(t==null?'':t).replace(/</g,'&lt;'); };
  const hoje=_agdHoje();
  const porDia={};
  (AGENDA_DB||[]).filter(Boolean).forEach(function(a){
    const p=String(a.data||'').split('-');
    if(Number(p[0])===ano && Number(p[1])===mes+1){ const dd=Number(p[2]); (porDia[dd]=porDia[dd]||[]).push(a); }
  });
  let html='';
  ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].forEach(function(d){ html+='<div style="text-align:center;font-weight:800;font-size:.75rem;padding:4px;color:#666">'+d+'</div>'; });
  const prim=new Date(ano,mes,1).getDay();
  const nd=new Date(ano,mes+1,0).getDate();
  for(let i=0;i<prim;i++) html+='<div></div>';
  for(let d=1;d<=nd;d++){
    const iso=ano+'-'+String(mes+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const lst=(porDia[d]||[]).slice().sort(function(a,b){ return (a.hora||'')<(b.hora||'')?-1:1; });
    const ehHoje=iso===hoje;
    let cell='<div onclick="agdCalDia(\''+iso+'\')" style="border:1.5px solid '+(ehHoje?'#f39c12':'#ddd')+';border-radius:8px;min-height:76px;padding:4px;cursor:pointer;background:'+(ehHoje?'#fffbe6':'#fff')+'">';
    cell+='<div style="font-weight:800;font-size:.8rem;color:'+(ehHoje?'#b45309':'#333')+'">'+d+'</div>';
    lst.slice(0,4).forEach(function(a){
      const cor=a.status==='Chegou'?'#c8e6c9':(a.status==='Cancelado'?'#eee':'#fff3cd');
      const corTx=a.status==='Chegou'?'#1b5e20':(a.status==='Cancelado'?'#777':'#8a6d00');
      cell+='<div style="background:'+cor+';color:'+corTx+';border-radius:5px;font-size:.68rem;font-weight:700;padding:1px 4px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(a.hora?esc(a.hora)+' ':'')+esc(a.nome)+'</div>';
    });
    if(lst.length>4) cell+='<div style="font-size:.65rem;color:#666;margin-top:2px">+'+(lst.length-4)+' mais…</div>';
    cell+='</div>';
    html+=cell;
  }
  el.innerHTML=html;
}
function _agdDataFiltro(){
  const f=document.getElementById('agd-filtro-data');
  return (f&&f.value)?f.value:_agdHoje();
}
function agdDiaNav(delta){
  const p=_agdDataFiltro().split('-').map(Number);
  const d=new Date(p[0],p[1]-1,p[2]+delta);
  const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const f=document.getElementById('agd-filtro-data'); if(f) f.value=iso;
  const t=document.getElementById('agd-ver-todas'); if(t) t.checked=false;
  agendaRender();
}
function agdDiaHoje(){
  const f=document.getElementById('agd-filtro-data'); if(f) f.value=_agdHoje();
  const t=document.getElementById('agd-ver-todas'); if(t) t.checked=false;
  agendaRender();
}
function agdTimelineRender(){
  const el=document.getElementById('agd-timeline'); if(!el) return;
  const esc=function(t){ return String(t==null?'':t).replace(/</g,'&lt;'); };
  const sel=_agdDataFiltro();
  const hoje=_agdHoje();
  // ─ faixa da semana (Dom a Sáb da semana do dia escolhido) ─
  const strip=document.getElementById('agd-sem-strip');
  if(strip){
    const p=sel.split('-').map(Number);
    const base=new Date(p[0],p[1]-1,p[2]);
    const dom=new Date(base.getFullYear(),base.getMonth(),base.getDate()-base.getDay());
    const nomes=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    let sh='';
    for(let i=0;i<7;i++){
      const d=new Date(dom.getFullYear(),dom.getMonth(),dom.getDate()+i);
      const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      const ativo=iso===sel;
      sh+='<button onclick="agdCalDia(\''+iso+'\')" style="border:none;border-radius:8px;padding:4px 9px;font-size:.72rem;font-weight:800;cursor:pointer;'+
        (ativo?'background:#c62828;color:#fff':'background:#eee;color:#444'+(iso===hoje?';outline:2px solid #f39c12':''))+'">'+
        nomes[i]+'<br>'+String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'</button>';
    }
    strip.innerHTML=sh;
  }
  // ─ linha do tempo de 06:00 às 19:00 (meia em meia hora) ─
  const doDia=(AGENDA_DB||[]).filter(function(a){ return a && a.data===sel; });
  const slots={}; const semHora=[];
  doDia.forEach(function(a){
    const m=/^(\d{1,2}):(\d{2})/.exec(String(a.hora||''));
    if(!m){ semHora.push(a); return; }
    let idx=Math.floor(((Number(m[1])*60+Number(m[2]))-360)/30);
    if(idx<0) idx=0; if(idx>25) idx=25;
    (slots[idx]=slots[idx]||[]).push(a);
  });
  function bloco(a){
    const cor=a.status==='Chegou'?'#a5d6a7':(a.status==='Cancelado'?'#e0e0e0':'#69f0ae');
    const tx=a.status==='Cancelado'?'#888':'#0b3d1e';
    const ico=a.status==='Chegou'?'✅ ':(a.status==='Cancelado'?'✖ ':'');
    const ext=a.material?(' — '+a.material):'';
    return '<div onclick="agdDetalhe(\''+a.id+'\')" title="Clique pra ver detalhes" style="cursor:pointer;background:'+cor+';color:'+tx+';border-radius:6px;padding:3px 8px;margin:2px 4px;font-size:.78rem;font-weight:700;'+(a.status==='Cancelado'?'text-decoration:line-through;':'')+'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+ico+(a.hora?esc(a.hora)+' · ':'')+esc(a.nome)+esc(ext)+'</div>';
  }
  let html='';
  if(semHora.length){
    html+='<div style="display:flex;border-bottom:1px solid #f0f0f0;background:#fffdf5"><div style="width:58px;flex-shrink:0;font-size:.7rem;color:#999;padding:4px;text-align:right">sem hora</div><div style="flex:1">'+semHora.map(bloco).join('')+'</div></div>';
  }
  let primeiro=-1;
  for(let i=0;i<26;i++){
    const hh=Math.floor((360+i*30)/60), mm=(360+i*30)%60;
    const rotulo=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
    const tem=slots[i]&&slots[i].length;
    if(tem&&primeiro<0) primeiro=i;
    html+='<div style="display:flex;border-bottom:1px solid #f0f0f0;min-height:26px;'+(mm===0?'background:#fafafa;':'')+'">'+
      '<div style="width:58px;flex-shrink:0;font-size:.72rem;color:#999;padding:4px;text-align:right;border-right:1px solid #eee">'+rotulo+'</div>'+
      '<div style="flex:1">'+(tem?slots[i].map(bloco).join(''):'')+'</div></div>';
  }
  el.innerHTML=html;
  if(primeiro>=0){ try{ el.scrollTop=Math.max(0,primeiro*26-40); }catch(e){} }
}
function agdDetalhe(id){
  const a=AGENDA_DB.find(x=>x&&x.id===id); if(!a) return;
  const esc=function(t){ return String(t==null?'':t).replace(/</g,'&lt;'); };
  const tel=_agdTelefonePor(a.nome);
  const chip=a.status==='Chegou'?'<span style="background:#c8e6c9;color:#1b5e20;padding:3px 12px;border-radius:12px;font-weight:800">✅ Chegou</span>'
    :(a.status==='Cancelado'?'<span style="background:#eee;color:#777;padding:3px 12px;border-radius:12px;font-weight:800">✖ Cancelado</span>'
    :'<span style="background:#fff3cd;color:#8a6d00;padding:3px 12px;border-radius:12px;font-weight:800">🕐 Agendado</span>');
  const oldOv=document.getElementById('agd-det-ov'); if(oldOv) oldOv.remove();
  const ov=document.createElement('div');
  ov.id='agd-det-ov';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.onclick=function(ev){ if(ev.target===ov) ov.remove(); };
  function lin(ico,rot,val){ return val?('<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid #f0f0f0"><div style="width:24px;text-align:center">'+ico+'</div><div><div style="font-size:.72rem;color:#999;font-weight:700">'+rot+'</div><div style="font-size:.92rem;font-weight:700;color:#222">'+val+'</div></div></div>'):''; }
  const card=document.createElement('div');
  card.style.cssText='background:#fff;border-radius:16px;max-width:420px;width:100%;max-height:88vh;overflow-y:auto;padding:18px 20px;box-shadow:0 10px 40px rgba(0,0,0,.3)';
  card.innerHTML=
    '<div style="display:flex;justify-content:space-around;border-bottom:2px solid #f0f0f0;padding-bottom:12px;margin-bottom:6px">'+
      '<div onclick="agendaWhats(\''+a.id+'\')" style="cursor:pointer;text-align:center;font-size:.7rem;font-weight:800;color:#25D366">📱<br>WHATS</div>'+
      (a.status==='Agendado'
        ? '<div onclick="agendaStatus(\''+a.id+'\',\'Chegou\');document.getElementById(\'agd-det-ov\').remove()" style="cursor:pointer;text-align:center;font-size:.7rem;font-weight:800;color:#2e7d32">✅<br>CHEGOU</div>'+
          '<div onclick="agendaStatus(\''+a.id+'\',\'Cancelado\');document.getElementById(\'agd-det-ov\').remove()" style="cursor:pointer;text-align:center;font-size:.7rem;font-weight:800;color:#9e9e9e">✖<br>CANCELAR</div>'
        : '<div onclick="agendaStatus(\''+a.id+'\',\'Agendado\');document.getElementById(\'agd-det-ov\').remove()" style="cursor:pointer;text-align:center;font-size:.7rem;font-weight:800;color:#f39c12">↩<br>VOLTAR</div>')+
      '<div onclick="document.getElementById(\'agd-det-ov\').remove();agendaExcluir(\''+a.id+'\')" style="cursor:pointer;text-align:center;font-size:.7rem;font-weight:800;color:#e53935">🗑<br>DELETAR</div>'+
    '</div>'+
    lin('🕐','Data e horário',_agdBr(a.data)+(a.hora?(' às '+esc(a.hora)):' (sem hora marcada)'))+
    lin('👤',esc(a.tipo||'Fornecedor'),'<b>'+esc(a.nome)+'</b>'+(tel?('<br><a href="tel:'+esc(tel)+'" style="color:#1565c0">'+esc(tel)+' 📞</a>'):''))+
    lin('💬','Observação',esc(a.obs))+
    lin('🏷️','Situação',chip)+
    lin('✍️','Agendado por',esc(a.criadoPor))+
    '<div style="text-align:center;margin-top:14px"><button onclick="document.getElementById(\'agd-det-ov\').remove()" style="background:none;border:none;font-weight:800;color:#555;cursor:pointer;font-size:.9rem;padding:8px 24px">FECHAR</button></div>';
  ov.appendChild(card);
  document.body.appendChild(ov);
}
