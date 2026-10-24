(function(){
  'use strict';

  function _perfilSeguro(u){
    if(!u) return null;
    return {
      name:u.name||'', role:u.role||'Usuário', descricao:u.descricao||'',
      tabs:Array.isArray(u.tabs)?[...u.tabs]:[], tabsCustom:!!u.tabsCustom,
      admin:u.admin===true,
      ...(u.cpApenasFornecedor?{cpApenasFornecedor:true}:{})
    };
  }
  function _aplicarPerfil(login, profile){
    if(!login||!profile) return;
    const atual=USERS[login]||{};
    USERS[login]={...atual,...profile,password:''};
    if(!Array.isArray(USERS[login].tabs)) USERS[login].tabs=[];
  }
  function _salvarPerfisLocal(){
    try{
      localStorage.setItem('mm_users', JSON.stringify(Object.fromEntries(
        Object.entries(USERS).map(([k,u])=>[k,_perfilSeguro(u)])
      )));
      localStorage.setItem('mm_users_del', JSON.stringify(_USERS_DEL||[]));
    }catch(e){ console.warn('saveUsers local:',e); }
  }

  
  window.saveUsers = function(){
    _salvarPerfisLocal();
    try{ fbSalvar(); }catch(e){}
  };

  window.doLogin = async function(){
    const inp=document.getElementById('inp-p');
    const err=document.getElementById('lerr');
    const password=(inp&&inp.value||'').trim();
    if(!password){ if(err){err.textContent='Digite a senha.';err.style.display='block';} inp&&inp.focus(); return; }
    if(err){ err.style.color=''; err.textContent='Verificando acesso...'; err.style.display='block'; }
    const btn=document.querySelector('.btn-login'); if(btn) btn.disabled=true;
    try{
      const result=await window.secureAuth.login(password);
      _aplicarPerfil(result.username,result.profile);
      _salvarPerfisLocal();
      if(err) err.style.display='none';
      fbCarregar(function(){
        try{ loadUsers(); }catch(e){}
        _aplicarPerfil(result.username,result.profile);
        startApp(result.username);
        try{ fbIniciarListener(); }catch(e){}
        try{ _secIniciarInatividade(); }catch(e){}
      });
    }catch(e){
      if(err){
        if(e.status===429 && e.retryAfterSeconds){
          const min=Math.max(1,Math.ceil(e.retryAfterSeconds/60));
          err.textContent='🔒 Acesso temporariamente bloqueado. Tente novamente em '+min+' min.';
        }else err.textContent=e.message||'Senha incorreta.';
        err.style.display='block';
      }
      if(inp){ inp.value=''; inp.focus(); }
    }finally{ if(btn) btn.disabled=false; }
  };

  
  window.togglePwd = function(){ showToast('Por segurança, a senha não é recuperável. Use “🔑 Senha” para definir uma nova.','info',4500); };

  // Dados de perfis vêm da nuvem: nunca interpolar texto de usuário em HTML/handlers.
  function _safeText(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  window.populateUsers = function(){
    const grid=document.getElementById('users-grid');
    if(!grid)return;
    const entries=Object.entries(USERS).filter(function(entry){return entry[1] && typeof entry[1]==='object';});
    grid.innerHTML=entries.map(function(entry,index){
      const un=entry[0],u=entry[1];
      const isAdmin=u.admin===true;
      const validTabs=Array.isArray(u.tabs)?u.tabs.filter(function(t){return Object.prototype.hasOwnProperty.call(TABS_CFG,t);}):[];
      const granted=validTabs.map(function(t){
        const cfg=TABS_CFG[t];
        return '<span class="tag">'+_safeText(cfg.label)+'</span>';
      }).join('');
      return '<article class="ucard'+(isAdmin?' admin':'')+'" data-erp-user-index="'+index+'">'+
        '<div class="ucard-hdr">'+
          '<div class="ucard-av'+(isAdmin?' gold':'')+'">'+_safeText((u.name||'?').slice(0,1))+'</div>'+
          '<div class="erp-user-identity"><div class="ucard-name">'+_safeText(u.name||un)+'</div>'+
          '<div class="ucard-role">'+_safeText(u.role||'Usuário')+' · <code>'+_safeText(un)+'</code></div></div>'+
          '<div class="erp-user-actions"><button type="button" class="btn-edit" data-erp-user-action="edit">Editar</button>'+
          '<button type="button" class="btn-edit" data-erp-user-action="password">Alterar senha</button></div></div>'+
        (u.descricao?'<p class="ucard-desc">'+_safeText(u.descricao)+'</p>':'')+
        '<details class="erp-user-permissions"><summary>Permissões ('+validTabs.length+')</summary>'+
          '<div class="tags">'+(granted||'<span>Sem permissões de módulos</span>')+'</div></details></article>';
    }).join('')+'<div class="erp-user-create"><button type="button" class="btn-add" data-erp-user-action="new">Novo usuário</button></div>';
    grid.onclick=function(event){
      const button=event.target.closest('[data-erp-user-action]');
      if(!button||!grid.contains(button))return;
      const action=button.dataset.erpUserAction;
      if(action==='new'){window.novoUsuario();return;}
      const card=button.closest('[data-erp-user-index]');
      const idx=card?Number(card.dataset.erpUserIndex):-1;
      if(!Number.isInteger(idx)||idx<0||idx>=entries.length)return;
      const login=entries[idx][0];
      if(action==='edit')window.editUsuario(login);
      if(action==='password')window.mudarSenha(login);
    };
  };

  window.mudarSenha = function(un){
    const u=USERS[un]; if(!u)return;
    const old=document.getElementById('modal-ov-confirm'); if(old)old.remove();
    const ov=document.createElement('div'); ov.className='modal-ov open'; ov.id='modal-ov-confirm';
    const box=document.createElement('div'); box.className='modal'; box.style.maxWidth='360px';
    box.innerHTML='<h3 style="margin-bottom:12px">🔑 Alterar senha — '+_safeText(u.name||un)+'</h3>'+ 
      '<div class="fg"><label>Nova Senha</label><input id="_ms-nova" type="password" placeholder="Digite a nova senha" autocomplete="new-password"></div>'+ 
      '<div class="fg"><label>Confirmar Senha</label><input id="_ms-conf" type="password" placeholder="Repita a nova senha"></div>'+ 
      '<div id="_ms-err" style="color:#c62828;font-size:.82rem;margin-bottom:8px;display:none"></div>'+ 
      '<div class="modal-ft"><button class="btn-cancel" id="_ms-cancel">Cancelar</button><button class="btn-save" id="_ms-ok">💾 Salvar</button></div>';
    ov.appendChild(box); document.body.appendChild(ov);
    document.getElementById('_ms-cancel').onclick=()=>ov.remove();
    document.getElementById('_ms-ok').onclick=async function(){
      const nova=(document.getElementById('_ms-nova').value||'').trim();
      const conf=(document.getElementById('_ms-conf').value||'').trim();
      const e=document.getElementById('_ms-err');
      if(nova.length<8){e.textContent='Use pelo menos 8 caracteres.';e.style.display='block';return;}
      if(nova!==conf){e.textContent='As senhas não coincidem.';e.style.display='block';return;}
      this.disabled=true;
      try{ await window.secureAuth.manageUser('resetPassword',{login:un,password:nova}); ov.remove(); showToast('Senha de '+u.name+' alterada com sucesso!','success'); }
      catch(err){ e.textContent=err.message||'Erro ao alterar senha.';e.style.display='block'; }
      finally{ this.disabled=false; }
    };
    setTimeout(()=>document.getElementById('_ms-nova')?.focus(),80);
  };

  
  const _editUsuarioOriginal=window.editUsuario;
  window.editUsuario = function(un){
    _editUsuarioOriginal(un);
    const p=document.getElementById('eu-pass');
    if(p){ p.value=''; p.type='password'; p.placeholder='deixe em branco para manter'; }
    const lbl=p&&p.closest('.fg')?.querySelector('label'); if(lbl) lbl.textContent='Nova senha (opcional)';
  };

  window.salvarEditUsuario = async function(un){
    const u=USERS[un]; if(!u)return;
    const profile={
      name:(document.getElementById('eu-nome').value||'').trim()||u.name,
      role:(document.getElementById('eu-role').value||'').trim()||u.role,
      descricao:(document.getElementById('eu-desc').value||'').trim()||u.descricao,
      tabs:[...document.querySelectorAll('#modal-body input[type=checkbox]')].filter(c=>c.checked).map(c=>c.value),
      tabsCustom:true,
      admin:u.admin===true,
      ...(u.cpApenasFornecedor?{cpApenasFornecedor:true}:{})
    };
    let newLogin=un;
    const le=document.getElementById('eu-login');
    if(le&&!(u&&u.admin===true)) newLogin=(le.value||un).trim().toLowerCase().replace(/\s+/g,'')||un;
    const password=(document.getElementById('eu-pass')?.value||'').trim();
    try{
      await window.secureAuth.manageUser('update',{login:un,newLogin,profile,password:password||undefined});
      if(newLogin!==un){ delete USERS[un]; _usersMarcarApagado(un); _usersDesmarcarApagado(newLogin); }
      USERS[newLogin]={...profile,password:''};
      _salvarPerfisLocal(); cm(); populateUsers(); showToast('Usuário '+profile.name+' atualizado!','success');
    }catch(e){ alert(e.message||'Erro ao atualizar usuário.'); }
  };

  window.salvarNovoUsuario = async function(){
    const login=(document.getElementById('nu-login').value||'').trim().toLowerCase().replace(/\s+/g,'');
    const name=(document.getElementById('nu-nome').value||'').trim();
    const password=(document.getElementById('nu-pass').value||'').trim();
    const role=(document.getElementById('nu-role').value||'').trim()||'Usuário';
    if(!login||!name||!password){alert('Preencha login, nome e senha!');return;}
    if(password.length<8){alert('A senha precisa ter pelo menos 8 caracteres.');return;}
    const tabs=[...document.querySelectorAll('#modal-body input[type=checkbox]')].filter(c=>c.checked).map(c=>c.value);
    const profile={name,role,descricao:'',tabs,tabsCustom:true,admin:false};
    try{
      await window.secureAuth.manageUser('create',{login,password,profile});
      USERS[login]={...profile,password:''}; _usersDesmarcarApagado(login); _salvarPerfisLocal(); cm(); populateUsers(); showToast('Usuário '+name+' criado!','success');
    }catch(e){ alert(e.message||'Erro ao criar usuário.'); }
  };

  window.excluirUsuario = async function(un){
    if(USERS[un]&&USERS[un].admin===true){alert('Não é possível excluir a administradora.');return;}
    if(!confirm('Excluir usuário '+(USERS[un]?.name||un)+'?\n\nEle não poderá mais entrar no sistema.'))return;
    try{
      await window.secureAuth.manageUser('delete',{login:un});
      delete USERS[un]; _usersMarcarApagado(un); _salvarPerfisLocal(); cm(); populateUsers(); showToast('Usuário excluído.','warn');
    }catch(e){ alert(e.message||'Erro ao excluir usuário.'); }
  };

  window.fiscalSalvarUsuario = async function(){
    const login=(document.getElementById('fu-login').value||'').trim().toLowerCase().replace(/\s+/g,'');
    const name=(document.getElementById('fu-nome').value||'').trim();
    const password=(document.getElementById('fu-pass').value||'').trim();
    const role=(document.getElementById('fu-role').value||'').trim()||'Fiscal';
    if(!login||!name||!password){showToast('Preencha login, nome e senha!','error');return;}
    if(password.length<8){showToast('Senha deve ter no mínimo 8 caracteres.','error');return;}
    const profile={name,role,descricao:'Acesso Fiscal',tabs:['fiscal'],tabsCustom:true};
    try{
      await window.secureAuth.manageUser('create',{login,password,profile});
      USERS[login]={...profile,password:''}; _usersDesmarcarApagado(login); _salvarPerfisLocal(); cm(); showToast('Usuário "'+name+'" criado e salvo! ✅','success');
    }catch(e){ showToast(e.message||'Erro ao criar usuário.','error'); }
  };
 
  window._balConfirmarExclusao = async function(){
    const tid=window._balDelTid;
    const pwd=(document.getElementById('_del-pwd')?.value||'').trim();
    const err=document.getElementById('_del-err');
    if(!pwd){ if(err){err.textContent='Digite a senha da administradora.';err.style.display='block';} return; }
    try{
      await window.secureAuth.verifyAdminPassword(pwd);
    }catch(e){ if(err){err.textContent='Senha incorreta.';err.style.display='block';} return; }
    cm(); _ticketExcluir(tid);
    for(let i=CONTAS_PAGAR.length-1;i>=0;i--){ const cp=CONTAS_PAGAR[i]; if(cp.ticket===tid||(cp.obs&&cp.obs.indexOf('Ticket '+tid)>=0)) _removerCPporIndice(i); }
    saveDB(); renderBalanceiro(); balRenderHistorico(); try{renderTickets();}catch(e){} showToast('🗑️ Ticket '+tid+' excluído!','warn',3000);
  };
 
  window.chatInit = function(){
    
    
    try{ if(typeof hdrAtualizarBadge === 'function') hdrAtualizarBadge(); }catch(e){}
    try{ if(typeof _chatAjustarAltura === 'function') _chatAjustarAltura(); }catch(e){}
    try{ if(typeof chatRenderConvs === 'function') chatRenderConvs(); }catch(e){}
    try{ if(typeof chatRenderMsgs === 'function') chatRenderMsgs(); }catch(e){}
  };

  window.chatDestroy = function(){
    
    
  };
  
  if (typeof window.rodCancelarPesagem !== 'function') {
    window.rodCancelarPesagem = function(){
      try{
        if (typeof _rodTicketVendaAtivo !== 'undefined' && _rodTicketVendaAtivo) {
          if (typeof rodCancelarModoMateriais === 'function') rodCancelarModoMateriais();
          if (typeof showToast === 'function') showToast('Operação de pesagem de venda fechada. O ticket foi mantido.','info',3500);
          return;
        }
        if (typeof _rodTicketCompraAtivo !== 'undefined' && _rodTicketCompraAtivo) {
          if (typeof rodCancelarModoMateriaisCompra === 'function') rodCancelarModoMateriaisCompra();
          if (typeof showToast === 'function') showToast('Operação de pesagem de compra fechada. O ticket foi mantido.','info',3500);
          return;
        }
        if (typeof _rodTicketSaida !== 'undefined' && _rodTicketSaida) {
          _rodTicketSaida = null;
          const sel = document.getElementById('rod-sel-saida'); if (sel) sel.value='';
          const tara = document.getElementById('rod-saida-manual'); if (tara) tara.value='';
          const bruto = document.getElementById('rod-display-bruto'); if (bruto) bruto.textContent='— kg';
          const liq = document.getElementById('rod-display-liquido'); if (liq) liq.textContent='— kg';
          if (typeof _rodRecalcularLiquido === 'function') _rodRecalcularLiquido();
          if (typeof showToast === 'function') showToast('Seleção de saída cancelada. Nenhum ticket foi excluído.','info',3500);
          return;
        }
        const ids=['rod-peso-manual','rod-saida-manual','rod-placa','rod-motorista','rod-obs','rod-material'];
        ids.forEach(function(id){ const el=document.getElementById(id); if(el) el.value=''; });
        const selPessoa=document.getElementById('rod-forn-sel'); if(selPessoa) selPessoa.value='';
        try{ _rodPesoAtual=0; }catch(e){}
        const peso=document.getElementById('rod-peso-big'); if(peso) peso.textContent='0.0';
        const pesoSai=document.getElementById('rod-peso-big-saida'); if(pesoSai) pesoSai.textContent='0.0 kg';
        try{ _rodTipoAtual='compra'; if(typeof rodTipoChange==='function') rodTipoChange('compra'); }catch(e){}
        if (typeof showToast === 'function') showToast('Campos da pesagem limpos. Nenhum registro salvo foi excluído.','info',3500);
      }catch(e){
        console.warn('rodCancelarPesagem compat:', e);
        if (typeof showToast === 'function') showToast('Não foi possível cancelar a operação em tela.','error');
      }
    };
  }

  if (typeof window.rodImprimirUltimo !== 'function') {
    window.rodImprimirUltimo = function(){
      try{
        let tid = null;
        try{ if(typeof _rodTicketSaida!=='undefined' && _rodTicketSaida) tid=_rodTicketSaida; }catch(e){}
        try{ if(!tid && typeof _rodTicketVendaAtivo!=='undefined' && _rodTicketVendaAtivo) tid=_rodTicketVendaAtivo; }catch(e){}
        try{ if(!tid && typeof _rodTicketCompraAtivo!=='undefined' && _rodTicketCompraAtivo) tid=_rodTicketCompraAtivo; }catch(e){}
        if(!tid && typeof _rodGetHistorico==='function'){
          const hist=_rodGetHistorico();
          if(hist && hist.length) tid=hist[0][0];
        }
        if(!tid){
          if (typeof showToast === 'function') showToast('Nenhuma pesagem rodoviária disponível para imprimir.','warn',4000);
          return;
        }
        if(typeof rodImprimirRomaneio==='function') rodImprimirRomaneio(tid);
      }catch(e){
        console.warn('rodImprimirUltimo compat:', e);
        if (typeof showToast === 'function') showToast('Não foi possível imprimir a última pesagem.','error');
      }
    };
  }
 
  try{ _salvarPerfisLocal(); }catch(e){}

  
  try{ const unlock=document.getElementById('lerr-unlock'); if(unlock) unlock.remove(); }catch(e){}
})();
