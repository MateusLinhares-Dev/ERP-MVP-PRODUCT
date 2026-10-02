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

  
  window.saveUsers = saveUsers = function(){
    _salvarPerfisLocal();
    try{ fbSalvar(); }catch(e){}
  };

  window.doLogin = doLogin = async function(){
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

  
  window.togglePwd = togglePwd = function(){ showToast('Por segurança, a senha não é recuperável. Use “🔑 Senha” para definir uma nova.','info',4500); };

  window.populateUsers = populateUsers = function(){
    const grid=document.getElementById('users-grid'); if(!grid)return;
    grid.innerHTML=Object.entries(USERS).map(([un,u])=>{
      const isAdmin=u&&u.admin===true;
      const granted=(u.tabs||[]).filter(t=>TABS_CFG[t]).map(t=>`<span class="tag">${TABS_CFG[t].icon} ${TABS_CFG[t].label}</span>`).join('');
      return `<div class="ucard ${isAdmin?'admin':''}">
        <div class="ucard-hdr"><div class="ucard-av ${isAdmin?'gold':''}">${(u.name||'?')[0]}</div>
        <div style="flex:1"><div class="ucard-name">${u.name||un}</div><div class="ucard-role">${u.role||''} · <code>${un}</code></div></div>
        <button class="btn-edit" onclick="editUsuario('${un}')" style="margin-left:8px">✏️ Editar</button>
        <button onclick="mudarSenha('${un}')" title="Mudar senha" style="background:#1565c0;color:#fff;border:none;border-radius:7px;padding:5px 10px;font-size:.78rem;font-weight:700;cursor:pointer;margin-left:4px">🔑 Senha</button></div>
        <p class="ucard-desc">${u.descricao||''}</p>
        <div style="display:flex;align-items:center;gap:8px;margin:10px 0 6px;padding:8px 10px;background:#f5f5f5;border-radius:7px;border:1px solid #e0e0e0">
          <span style="font-size:.72rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px">Senha:</span>
          <span style="font-family:monospace;font-size:.88rem;font-weight:700;color:#1a3a2a;letter-spacing:2px">••••••••</span>
          <span style="font-size:.68rem;color:#777">protegida no servidor</span>
        </div>
        <div style="font-size:.7rem;font-weight:700;color:#888;margin:8px 0 4px;text-transform:uppercase;letter-spacing:.5px">Abas com acesso (${(u.tabs||[]).filter(t=>TABS_CFG[t]).length})</div>
        <div class="tags">${granted||'<span style="color:#aaa;font-size:.75rem">Nenhuma aba</span>'}</div></div>`;
    }).join('')+`<div style="margin-top:16px"><button class="btn-add" onclick="novoUsuario()">➕ Novo Usuário</button></div>`;
  };

  window.mudarSenha = mudarSenha = function(un){
    const u=USERS[un]; if(!u)return;
    const old=document.getElementById('modal-ov-confirm'); if(old)old.remove();
    const ov=document.createElement('div'); ov.className='modal-ov open'; ov.id='modal-ov-confirm';
    const box=document.createElement('div'); box.className='modal'; box.style.maxWidth='360px';
    box.innerHTML='<h3 style="margin-bottom:12px">🔑 Mudar Senha — '+u.name+'</h3>'+ 
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
  window.editUsuario = editUsuario = function(un){
    _editUsuarioOriginal(un);
    const p=document.getElementById('eu-pass');
    if(p){ p.value=''; p.type='password'; p.placeholder='deixe em branco para manter'; }
    const lbl=p&&p.closest('.fg')?.querySelector('label'); if(lbl) lbl.textContent='Nova senha (opcional)';
  };

  window.salvarEditUsuario = salvarEditUsuario = async function(un){
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

  window.salvarNovoUsuario = salvarNovoUsuario = async function(){
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

  window.excluirUsuario = excluirUsuario = async function(un){
    if(USERS[un]&&USERS[un].admin===true){alert('Não é possível excluir a administradora.');return;}
    if(!confirm('Excluir usuário '+(USERS[un]?.name||un)+'?\n\nEle não poderá mais entrar no sistema.'))return;
    try{
      await window.secureAuth.manageUser('delete',{login:un});
      delete USERS[un]; _usersMarcarApagado(un); _salvarPerfisLocal(); cm(); populateUsers(); showToast('Usuário excluído.','warn');
    }catch(e){ alert(e.message||'Erro ao excluir usuário.'); }
  };

  window.fiscalSalvarUsuario = fiscalSalvarUsuario = async function(){
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
 
  window._balConfirmarExclusao = _balConfirmarExclusao = async function(){
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
