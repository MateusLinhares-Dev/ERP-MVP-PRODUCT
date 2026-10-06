const _FB_CONFIG = (window.__APP_CONFIG__ && window.__APP_CONFIG__.firebase) || {};
  const _APP_BUILD = '2026-09-05-1800-v212-dinheiro-2-casas';
  let _versaoChecagemAtiva=false;
  function _iniciarChecagemVersao(){
    if(location.protocol==='file:'){
      try{
        if(!document.getElementById('aviso-arquivo-local') && document.body){
          const av=document.createElement('div');
          av.id='aviso-arquivo-local';
          av.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99998;background:#b45309;color:#fff;padding:8px 14px;font-size:.85rem;font-weight:700;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)';
          av.innerHTML='📁 Você abriu o ERP pelo ARQUIVO do computador. O certo é usar o site: '
            +'<a href="https://erp-2gcj.vercel.app" style="color:#fff;text-decoration:underline;font-weight:800">erp-2gcj.vercel.app</a>';
          document.body.appendChild(av);
        }
      }catch(e){}
      return;
    }
    if(_versaoChecagemAtiva || !window._fbDB) return;
    _versaoChecagemAtiva=true;
    try{
      const ref = window._fbDB.ref('erp/_appBuild');
      ref.transaction(function(atual){
        if(!atual || String(_APP_BUILD) > String(atual)) return _APP_BUILD;
        return;
      }).catch(function(){});
      ref.on('value', function(snap){
        const v = snap && snap.val ? snap.val() : null;
        if(v && String(v) > String(_APP_BUILD)) _avisarVersaoDesatualizada();
      });
    }catch(e){ console.warn('_iniciarChecagemVersao erro:', e); }
  }
  function _avisarVersaoDesatualizada(){
    if(document.getElementById('aviso-versao-nova') || !document.body) return;
    const b=document.createElement('div');
    b.id='aviso-versao-nova';
    b.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#c0392b;color:#fff;padding:10px 16px;font-size:.85rem;font-weight:700;text-align:center;box-shadow:0 -2px 10px rgba(0,0,0,.3)';
    b.innerHTML='⚠️ Essa aba está com uma versão desatualizada do sistema e pode reverter dados salvos por outra pessoa. '
      +'<button onclick="location.reload()" style="margin-left:8px;background:#fff;color:#c0392b;border:none;border-radius:5px;padding:4px 14px;font-weight:800;cursor:pointer">🔄 Atualizar agora</button>';
    document.body.appendChild(b);
  }

  function _fbTentarInit(){
    if(typeof firebase==='undefined' || !firebase.database) return false;
    try{
      if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(_FB_CONFIG);
      window._fbRawDB = firebase.database();
       window._fbDB = window.__legacyDbAdapter ? window.__legacyDbAdapter(window._fbRawDB) : window._fbRawDB;
      try{ if(typeof _fbSetStatus==='function') _fbSetStatus('ok'); }catch(e){}
      var banner=document.getElementById('fb-offline-banner'); if(banner) banner.remove();
      try{ if(firebase.auth && firebase.auth().currentUser) _iniciarChecagemVersao(); }catch(e){}

      try{ if(typeof cu!=='undefined' && cu && typeof fbCarregar==='function'){ var _goFb=function(){ fbCarregar(function(){ try{ if(typeof fbIniciarListener==='function') fbIniciarListener(); }catch(e){} }); }; var _unFb=''; try{ _unFb=sessionStorage.getItem('mm_sessao')||''; }catch(e){} if(_unFb && firebase.auth && !firebase.auth().currentUser){ _fbAuthLogin(_unFb, _goFb, _goFb); } else { _goFb(); } } }catch(e){}
      return true;
    }catch(e){ console.warn('Firebase init (retry):', e&&e.message); return false; }
  }
  function _fbInjetarScripts(cb){
    if(typeof firebase!=='undefined'){ cb&&cb(); return; }
    var urls=[
      'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
      'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js'
    ];
    var i=0;
    (function next(){
      if(i>=urls.length){ cb&&cb(); return; }
      var s=document.createElement('script'); s.src=urls[i]; s.async=false;
      s.onload=function(){ i++; next(); };
      s.onerror=function(){ i++; next(); };
      document.head.appendChild(s);
    })();
  }
  function _fbAvisoOffline(){
    if(document.getElementById('fb-offline-banner') || !document.body) return;
    var b=document.createElement('div');
    b.id='fb-offline-banner';
    b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#c0392b;color:#fff;padding:8px 14px;font-size:.85rem;font-weight:600;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)';
    b.innerHTML='⚠️ Sem conexão com a nuvem — os dados estão sendo salvos só neste computador. '
      +'<button onclick="location.reload()" style="margin-left:8px;background:#fff;color:#c0392b;border:none;border-radius:5px;padding:3px 12px;font-weight:800;cursor:pointer">🔄 Recarregar</button>';
    document.body.appendChild(b);
  }
  function _fbEnsureLoaded(attempt){
    attempt = attempt||0;
    if(_fbTentarInit()) return;
    if(attempt >= 8){ _fbAvisoOffline(); return; }
    _fbInjetarScripts(function(){ setTimeout(function(){ _fbEnsureLoaded(attempt+1); }, 1500); });
  }
  _fbEnsureLoaded(0);

   
  const _FB_AUTH_MAP = {}; 

  
  function _fbAuthLogin(erpUser, onSuccess, onError){
    try{
      if(!window.secureAuth || typeof window.secureAuth.restore !== 'function'){
        onError && onError(new Error('Camada segura de autenticação indisponível.'));
        return;
      }
      window.secureAuth.restore(erpUser)
        .then(function(ok){
          if(ok){
            try{ const b=document.getElementById('fb-auth-banner'); if(b) b.remove(); }catch(e){}
            try{ _versaoChecagemAtiva=false; _iniciarChecagemVersao(); }catch(e){}
            onSuccess && onSuccess();
          } else {
            onError && onError(new Error('Sessão Firebase não encontrada ou expirada.'));
          }
        })
        .catch(function(err){ onError && onError(err); });
    }catch(err){ onError && onError(err); }
  }

  
  function _fbAuthLogout(){
    try{ firebase.auth().signOut(); }catch(e){}
  }

  function _fbTemUsuarioAuth(){
    try{ return !!(typeof firebase!=='undefined' && firebase.auth && firebase.auth().currentUser); }catch(e){ return false; }
  }

  function _fbRestaurarAuthEExecutar(fn, atrasoErro){
    if(_fbTemUsuarioAuth()){ fn&&fn(); return true; }
    if(window.__ERP_LOGOUT_IN_PROGRESS__) return false;
    let un=''; try{ un=sessionStorage.getItem('mm_sessao')||''; }catch(e){}
    if(!un) return false;
    _fbAuthLogin(un, function(){ setTimeout(function(){ try{ fn&&fn(); }catch(e){} },50); }, function(){
      if(atrasoErro) setTimeout(function(){ try{ fn&&fn(); }catch(e){} }, atrasoErro);
    });
    return false;
  }

  
  function _estoqueAplicarDaNuvem(remoto, confiavel, shallowKeys){
    try{
      if(typeof ESTOQUE_DB==='undefined') return false;
      const cloudTinha=Array.isArray(shallowKeys) && shallowKeys.indexOf('estoque')>=0;
      const leituraOk=remoto && typeof remoto==='object' && !Array.isArray(remoto);
      if(confiavel){
        
        
        if(cloudTinha && !leituraOk) return false;
        Object.keys(ESTOQUE_DB).forEach(function(k){ delete ESTOQUE_DB[k]; });
        if(leituraOk) Object.assign(ESTOQUE_DB, remoto);
      } else if(leituraOk){
        
        Object.assign(ESTOQUE_DB, remoto);
      } else return false;
      try{ localStorage.setItem('mm_estoque', JSON.stringify(ESTOQUE_DB)); }catch(e){}
      try{ if(typeof refreshMetaisGlobals==='function') refreshMetaisGlobals(); }catch(e){}
      return true;
    }catch(e){ console.warn('_estoqueAplicarDaNuvem:',e); return false; }
  }

  function _fcAplicarNuvem(d){
    if(!d || !Array.isArray(d._shallowKeys)) return false;
    const refs=[
      ['adtCli', ADT_CLI], ['chequesCli', CHEQUES_CLI],
      ['fcLanc', FC_LANC], ['fcSaldoIni', FC_SALDO_INI]
    ];
    for(const [key,target] of refs){
      const presente=d._shallowKeys.includes(key);
      const valor=d[key];
      if(presente && (valor===undefined || valor===null)){
        console.warn('Ficha financeira: leitura parcial de '+key+'; mantendo dados até nova leitura.');
        return false;
      }
      if(valor!==undefined && valor!==null && (typeof valor!=='object' || Array.isArray(valor))){
        console.warn('Ficha financeira: formato inesperado em '+key+'; não aplicar snapshot.');
        return false;
      }
    }
    for(const [key,target] of refs){
      Object.keys(target).forEach(k=>delete target[k]);
      Object.assign(target,d[key]||{});
    }
    window.__ERP_FINANCE_CLOUD_READY__=true;
    
    
    return true;
  }

  function _fcRedesenharSeAberta(){
    if(!window.__ERP_FINANCE_CLOUD_READY__) return;
    try{
      const aba=document.getElementById('tab-fin_clientes');
      if(aba && aba.classList.contains('active')){
        if(typeof renderFichaCliente==='function') renderFichaCliente();
        if(typeof fcRenderResumo==='function' && typeof _fcAba!=='undefined' && _fcAba==='resumo') fcRenderResumo();
      }
    }catch(e){console.warn('Atualização da ficha financeira:',e);}
  }

  function _aplicarConfigNegocio(d){
    try{
      var cfg=d&&d.config;
      if(!cfg || typeof cfg!=='object') return;
      if(typeof ERP_BUSINESS_CONFIG!=='undefined'){ Object.keys(ERP_BUSINESS_CONFIG).forEach(function(k){delete ERP_BUSINESS_CONFIG[k];}); Object.assign(ERP_BUSINESS_CONFIG,cfg); }
      if(typeof EMPRESAS_INFO!=='undefined' && cfg.companies && typeof cfg.companies==='object'){
        Object.keys(EMPRESAS_INFO).forEach(function(k){ delete EMPRESAS_INFO[k]; });
        Object.assign(EMPRESAS_INFO, cfg.companies);
      }
      if(typeof EMPRESAS!=='undefined' && Array.isArray(cfg.expenseGroups)){
        EMPRESAS.length=0; cfg.expenseGroups.forEach(function(x){ if(x!=null) EMPRESAS.push(String(x)); });
      }
      if(typeof EMP_COLORS!=='undefined' && cfg.expenseGroupColors && typeof cfg.expenseGroupColors==='object'){
        Object.keys(EMP_COLORS).forEach(function(k){ delete EMP_COLORS[k]; });
        Object.assign(EMP_COLORS, cfg.expenseGroupColors);
      }
      try{ if(typeof _popularEmpresasDespesa==='function') _popularEmpresasDespesa(); }catch(_e){}
      try{ if(typeof window.__erpRefreshCompanySources==='function') window.__erpRefreshCompanySources(); }catch(_e){}
      try{ if(Array.isArray(cfg.financeCompanies) && typeof _cpRenderEmpresaBotoes==='function') _cpRenderEmpresaBotoes(); }catch(_e){}
      try{
        var nf=document.getElementById('nfu-emp');
        if(nf && typeof _cfgEmployeeCompanyOptionsHtml==='function') nf.innerHTML=_cfgEmployeeCompanyOptionsHtml(nf.value||'');
        var ef=document.getElementById('efn-emp');
        if(ef && typeof _cfgEmployeeCompanyOptionsHtml==='function') ef.innerHTML=_cfgEmployeeCompanyOptionsHtml(ef.value||'');
      }catch(_e){}
      try{
        var dlEmp=document.getElementById('dlist-empresas');
        if(dlEmp && Array.isArray(cfg.transferCompanies)){
          dlEmp.innerHTML=cfg.transferCompanies.map(function(v){return '<option value="'+String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'">';}).join('');
        }
        try{ if(typeof _cpRenderEmpresaBotoes==='function') _cpRenderEmpresaBotoes(); }catch(_e2){}
        var fcfg=cfg.fiscalCompanies&&typeof cfg.fiscalCompanies==='object'?cfg.fiscalCompanies:{};
        try{ if(typeof _fiscalEnsureEmpresa==='function') _fiscalEnsureEmpresa(); if(typeof _fiscalRenderEmpresaBotoes==='function') _fiscalRenderEmpresaBotoes(); }catch(_e3){}
        var fkey=(typeof _fiscalEmpresa!=='undefined'?_fiscalEmpresa:''); var fv=fcfg[fkey]||{};
        var fbadge=document.getElementById('fiscal-emp-badge'); if(fbadge){ var fl=String(fv.label||''); fbadge.textContent=(fv.icon?String(fv.icon)+' ':'')+fl+(fl?' selecionada':''); }
        var fest=document.getElementById('est-emp-label'); if(fest) fest.textContent=String(fv.shortLabel||fv.label||'');
        var mods=cfg.dashboardModules&&typeof cfg.dashboardModules==='object'?cfg.dashboardModules:{};
        document.querySelectorAll('[data-dashboard-description]').forEach(function(el){ var m=mods[el.getAttribute('data-dashboard-description')]||{}; el.textContent=String(m.description||''); });
        document.querySelectorAll('[data-dashboard-responsible]').forEach(function(el){ var m=mods[el.getAttribute('data-dashboard-responsible')]||{}; el.textContent=String(m.responsible||''); });
      }catch(_e){}
      if(Array.isArray(cfg.chequeBanks)){
        try{
          if(typeof _ADT_CHQ_BANCOS!=='undefined'){ _ADT_CHQ_BANCOS.length=0; cfg.chequeBanks.forEach(function(x){if(x&&x.name)_ADT_CHQ_BANCOS.push(String(x.name));}); }
          if(typeof _CHQ_BANCO_COD!=='undefined'){ Object.keys(_CHQ_BANCO_COD).forEach(function(k){delete _CHQ_BANCO_COD[k];}); cfg.chequeBanks.forEach(function(x){if(x&&x.name&&x.code)_CHQ_BANCO_COD[x.name]=x.code;}); }
          if(typeof _CHQ_BANCO_COR!=='undefined'){ Object.keys(_CHQ_BANCO_COR).forEach(function(k){delete _CHQ_BANCO_COR[k];}); cfg.chequeBanks.forEach(function(x){if(x&&x.name&&x.color)_CHQ_BANCO_COR[x.name]=x.color;}); }
        }catch(_e){}
      }
      
      if(cfg.fiscalData && typeof cfg.fiscalData==='object'){
        try{
          if(typeof FISCAL_LANC_SEED_2026!=='undefined') FISCAL_LANC_SEED_2026=cfg.fiscalData.lancSeed2026||{};
          if(typeof FISCAL_KG_PATCH_2026!=='undefined') FISCAL_KG_PATCH_2026=cfg.fiscalData.kgPatch2026||{};
          if(typeof FISCAL_KG_PATCH_2026_V6!=='undefined') FISCAL_KG_PATCH_2026_V6=cfg.fiscalData.kgPatch2026v6||{};
          if(typeof FISCAL_ENTRADA_PATCH_NF4954!=='undefined') FISCAL_ENTRADA_PATCH_NF4954=cfg.fiscalData.entradaPatchNF4954||{};
          if(typeof FISCAL_DEVOLUCAO_PATCHES_2026!=='undefined') FISCAL_DEVOLUCAO_PATCHES_2026=cfg.fiscalData.devolucaoPatches2026||[];
          if(typeof FISCAL_DOCS_JUL2026_PATCHES!=='undefined') FISCAL_DOCS_JUL2026_PATCHES=cfg.fiscalData.docsJul2026Patches||[];
          if(typeof FISCAL_DATA_REAL_2026!=='undefined') FISCAL_DATA_REAL_2026=cfg.fiscalData.dataReal2026||{};
          if(typeof FISCAL_SALDO_INICIAL_2026!=='undefined') FISCAL_SALDO_INICIAL_2026=cfg.fiscalData.saldoInicial2026||[];
          if(typeof FISCAL_SALDO_INICIAL_DATA!=='undefined') FISCAL_SALDO_INICIAL_DATA=cfg.fiscalData.saldoInicialData||'';
          if(typeof FISCAL_AJUSTE_ESTOQUE_2026!=='undefined') FISCAL_AJUSTE_ESTOQUE_2026=cfg.fiscalData.ajusteEstoque2026||[];
          if(typeof FISCAL_AJUSTE_ESTOQUE_DATA!=='undefined') FISCAL_AJUSTE_ESTOQUE_DATA=cfg.fiscalData.ajusteEstoqueData||'';
          if(typeof FISCAL_NCM_OVERRIDE_2026!=='undefined') FISCAL_NCM_OVERRIDE_2026=cfg.fiscalData.ncmOverride2026||{};
        }catch(_e){}
      }
      try{
        var rep=cfg.legacyRepairs||{};
        if(typeof _CHQ_FIX_GS!=='undefined') _CHQ_FIX_GS=((rep.gratusSicrediDefinitive||{}).records||[]);
      }catch(_e){}
    }catch(e){ console.warn('config negócio:', e); }
  }

  function _verificarReset(d){
    try{
      if(!d || !d._reset) return false;
      let visto=null; try{ visto=localStorage.getItem('mm_reset_visto'); }catch(e){}
      if(String(visto)===String(d._reset)) return false;
      console.warn('RECOMEÇO detectado — limpando dados locais deste computador.');
      const chaves=[];
      for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.indexOf('mm_')===0) chaves.push(k); }
      chaves.forEach(function(k){ try{ localStorage.removeItem(k); }catch(e){} });
      try{ localStorage.setItem('mm_reset_visto', String(d._reset)); }catch(e){}
      location.reload();
      return true;
    }catch(e){ console.warn('_verificarReset erro:', e); return false; }
  }

  
  function _aplicarUntomb(u){
    try{
      if(u && u.tickets && typeof TICKETS_DELETED!=='undefined'){
        let mudou=false;
        Object.keys(u.tickets).forEach(function(id){ if(TICKETS_DELETED.has(id)){ TICKETS_DELETED.delete(id); mudou=true; } });
        if(mudou){ try{ localStorage.setItem('mm_tickets_deletados', JSON.stringify([...TICKETS_DELETED])); }catch(e){} }
      }
      if(u && u.contasPagar && typeof CONTAS_PAGAR_DELETED!=='undefined'){
        let mudou2=false;
        Object.keys(u.contasPagar).forEach(function(id){ if(CONTAS_PAGAR_DELETED.has(id)){ CONTAS_PAGAR_DELETED.delete(id); mudou2=true; } });
        if(mudou2){ try{ localStorage.setItem('mm_cp_deletados', JSON.stringify([...CONTAS_PAGAR_DELETED])); }catch(e){} }
      }
    }catch(e){ console.warn('_aplicarUntomb erro:', e); }
  }

  function _fbAvisoAuthFalhou(codigo){
    try{
      if(document.getElementById('fb-auth-banner') || !document.body) return;
      const b=document.createElement('div');
      b.id='fb-auth-banner';
      b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#c0392b;color:#fff;padding:8px 14px;font-size:.85rem;font-weight:600;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)';
      b.innerHTML='⚠️ Não foi possível entrar na nuvem ('+(codigo||'erro')+') — os dados NÃO vão sincronizar neste computador. '
        +'<button onclick="location.reload()" style="margin-left:8px;background:#fff;color:#c0392b;border:none;border-radius:5px;padding:3px 12px;font-weight:800;cursor:pointer">🔄 Tentar de novo</button>';
      document.body.appendChild(b);
    }catch(e){}
  }
  

  let _fbSyncPendente = false;
  let _fbAtualizando = false;
  let _fbPronto = false; 
  let _fbPendente = false; 
  let _fbDadosCarregados = false; 
  let CUSTO_CASA = {};
  let VEICPESS_DB = [];   
  let MANUTPESS_DB = [];  
  let _fbTimer = null;
  let _fbOnline = true;
  let _fbSaveRetries = 0;
  let _fbAtualizandoTimer = null;

  function _fbSetStatus(status, detalhe){ 
    const el=document.getElementById('fb-status-dot');
    if(!el) return;
    const map={ok:'🟢',saving:'🟡',error:'🔴',offline:'⚫'};
    const tip={ok:'Firebase OK',saving:'Salvando...',error:'Erro ao salvar — tentando novamente',offline:'Sem conexão — dados salvos localmente'};
    el.textContent=map[status]||'🟡';
    el.title=(tip[status]||'')+(detalhe?(' | Detalhe do erro: '+detalhe):'');
  }

  function _comTimeoutFirebase(promise, ms){
    return new Promise(function(resolve, reject){
      const t=setTimeout(function(){ reject(new Error('Tempo esgotado ao salvar no Firebase (rede lenta ou instável)')); }, ms);
      promise.then(function(v){ clearTimeout(t); resolve(v); }, function(e){ clearTimeout(t); reject(e); });
    });
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  function _expandirEntradaGrande(chave, valor, limiteBytes){
    let tamanho;
    try{ tamanho=JSON.stringify(valor).length+chave.length+4; }catch(e){ tamanho=0; }
    if(tamanho<=limiteBytes) return [[chave, valor]];
    if(valor && typeof valor==='object' && !Array.isArray(valor)){
      const subchaves=Object.keys(valor);
      if(subchaves.length>1){
        let resultado=[];
        subchaves.forEach(function(sk){
          resultado=resultado.concat(_expandirEntradaGrande(chave+'/'+sk, valor[sk], limiteBytes));
        });
        return resultado;
      }
    }
    
    
    
    return [[chave, valor]];
  }
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const MAX_ITENS_POR_LOTE = 3000;
  
  
  
  
  
  function _prioridadeChave(k){
    const raiz = String(k).split('/')[0];
    const alta = ['tickets','contasPagar','contasPagarDeleted','contasReceber','vendas','vales','adiantamentos','cheques','saldos','estoque','lancBanco','fcLanc','fcSaldoIni','adtCli','chequesCli','clientes','fornecedores','fornDeleted','bancos','metais','custosCasa','tanque','precosForn','precosCli','saldoDevedor','bags','bagsMov','users','agendaEntregas','viagem','combustivel','fornDespesa','ponto','folha','frota','manutencao','frotaDeleted','manutencaoDeleted','afazeres','afazeresDeleted'];
    const baixa = ['docsEmpresas','contratos','coordNotas','epi','reunioes','advertencias','historico','funcEdit','fornVeiculos','coordFuncObs','fiscal','fiscalApur','almoxa','almoxaMov','despGrupo'];
    if(alta.indexOf(raiz)>=0) return 0;
    if(baixa.indexOf(raiz)>=0) return 2;
    return 1;
  }
  
  
  
  
  
  const _fbEnviadoOk = {};
  function _fbFiltrarJaEnviado(dados){
    const filtrado={};
    let pulados=0;
    Object.keys(dados).forEach(function(k){
      if(k==='_ts'||k==='_user'){ filtrado[k]=dados[k]; return; }
      let str; try{ str=JSON.stringify(dados[k]); }catch(e){ str=undefined; }
      if(str!==undefined && _fbEnviadoOk[k]===str){ pulados++; return; }
      filtrado[k]=dados[k];
    });
    if(pulados>0) console.info('fbSalvar: '+pulados+' itens inalterados pulados (já estão na nuvem).');
    return filtrado;
  }
  function _fbMarcarEnviado(objLote){
    Object.keys(objLote).forEach(function(k){
      if(k==='_ts'||k==='_user') return;
      try{ _fbEnviadoOk[k]=JSON.stringify(objLote[k]); }catch(e){}
    });
  }
  function _dividirEmLotes(dados, limiteBytes, maxItens){
    maxItens = maxItens || MAX_ITENS_POR_LOTE;
    let entradas=[];
    Object.entries(dados).forEach(function(par){
      entradas=entradas.concat(_expandirEntradaGrande(par[0], par[1], limiteBytes));
    });
    entradas.sort(function(a,b){ return _prioridadeChave(a[0])-_prioridadeChave(b[0]); });
    const lotes=[];
    let loteAtual={};
    let tamanhoAtual=2; 
    let itensAtual=0;
    entradas.forEach(function(par){
      const k=par[0], v=par[1];
      let tamanhoItem;
      try{ tamanhoItem=JSON.stringify(v).length+k.length+4; }catch(e){ tamanhoItem=0; }
      if((tamanhoAtual+tamanhoItem>limiteBytes || itensAtual>=maxItens) && itensAtual>0){
        lotes.push(loteAtual);
        loteAtual={};
        tamanhoAtual=2;
        itensAtual=0;
      }
      loteAtual[k]=v;
      tamanhoAtual+=tamanhoItem;
      itensAtual++;
    });
    if(itensAtual>0) lotes.push(loteAtual);
    return lotes;
  }
  
  
  
  
  
  function _fbLimparUndefined(o){
    if(Array.isArray(o)) return o.map(_fbLimparUndefined);
    if(o && typeof o==='object'){
      const r={};
      for(const k in o){ if(!Object.prototype.hasOwnProperty.call(o,k)) continue; const v=_fbLimparUndefined(o[k]); if(v!==undefined) r[k]=v; }
      return r;
    }
    if(o===undefined) return undefined;
    if(typeof o==='number' && !isFinite(o)) return undefined; 
    return o;
  }
  function _agruparAtualizacoesErp(dados){
    const grupos={};
    Object.keys(dados||{}).forEach(function(chave){
      const partes=String(chave).split('/');
      const raiz=partes.shift();
      if(!raiz) return;
      if(!grupos[raiz]) grupos[raiz]={temValor:false,valor:undefined,patch:{}};
      if(!partes.length){
        grupos[raiz].temValor=true;
        grupos[raiz].valor=dados[chave];
      }else{
        grupos[raiz].patch[partes.join('/')]=dados[chave];
      }
    });
    return grupos;
  }

  async function _enviarMapaErp(dados){
    const grupos=_agruparAtualizacoesErp(dados);
    const entradas=Object.entries(grupos);
    const concorrencia=8;
    for(let inicio=0;inicio<entradas.length;inicio+=concorrencia){
      const faixa=entradas.slice(inicio,inicio+concorrencia);
      await Promise.all(faixa.map(async function(par){
        const raiz=par[0], grupo=par[1];
        const ref=window._fbDB.ref('erp/'+raiz);
        if(grupo.temValor){
          await _comTimeoutFirebase(ref.set(grupo.valor),75000);
          if(Object.keys(grupo.patch).length) await _comTimeoutFirebase(ref.update(grupo.patch),75000);
          return;
        }
        if(Object.keys(grupo.patch).length) await _comTimeoutFirebase(ref.update(grupo.patch),75000);
      }));
    }
  }

  async function _enviarDadosEmLotes(dados, limiteBytes){
    dados = _fbFiltrarJaEnviado(dados);
    dados = _fbLimparUndefined(dados);
    let tamanhoTotal;
    try{ tamanhoTotal=JSON.stringify(dados).length; }catch(e){ tamanhoTotal=0; }
    if(tamanhoTotal<=limiteBytes && Object.keys(dados).length<=MAX_ITENS_POR_LOTE){
      try{
        const _r = await _enviarMapaErp(dados);
        _fbMarcarEnviado(dados);
        return _r;
      }catch(e){
        e.message = (e&&e.message?e.message:'Erro desconhecido')+' [lote único, '+Object.keys(dados).length+' itens, ~'+Math.round(tamanhoTotal/1024)+'KB]';
        throw e;
      }
    }
    const _ts=dados._ts, _user=dados._user;
    const resto={}; Object.keys(dados).forEach(function(k){ if(k!=='_ts'&&k!=='_user') resto[k]=dados[k]; });
    const lotes=_dividirEmLotes(resto, limiteBytes);
    for(let i=0;i<lotes.length;i++){
      try{
        await _enviarMapaErp(lotes[i]);
        _fbMarcarEnviado(lotes[i]);
        try{ _fbSetStatus('saving', 'Enviando '+(i+1)+' de '+lotes.length+' pacotes...'); }catch(_){ }
      }catch(e){
        let _tamLote; try{ _tamLote=JSON.stringify(lotes[i]).length; }catch(_){ _tamLote=0; }
        e.message = (e&&e.message?e.message:'Erro desconhecido')+' [lote '+(i+1)+' de '+lotes.length+', '+Object.keys(lotes[i]).length+' itens, ~'+Math.round(_tamLote/1024)+'KB, chaves: '+Object.keys(lotes[i]).slice(0,3).join(', ')+(Object.keys(lotes[i]).length>3?'...':'')+']';
        throw e;
      }
    }
    const meta={};
    if(_ts!==undefined) meta._ts=_ts;
    if(_user!==undefined) meta._user=_user;
    if(Object.keys(meta).length){ await _enviarMapaErp(meta); _fbMarcarEnviado(meta); }
  }

  function fbSalvar() {
    try{ _fbPendente=true; localStorage.setItem('mm_fb_pendente','1'); }catch(e){}
    clearTimeout(_fbTimer);
    _fbTimer = setTimeout(_fbSalvarAgora, 800);
  }
  function fbSalvarImediato(){ clearTimeout(_fbTimer); _fbSalvarAgora(); }

  async function _fbSalvarAgora() {
    if(window.__ERP_RESTORING__){console.warn('Salvamento suspenso durante restauração.');return;}

    
    if(_fbAtualizando){
      if(!_fbAtualizandoTimer) _fbAtualizandoTimer=setTimeout(()=>{ _fbAtualizando=false; _fbAtualizandoTimer=null; },8000);
      
      
      
      clearTimeout(_fbTimer);
      _fbTimer = setTimeout(_fbSalvarAgora, 300);
      return;
    }
    if(!_fbPronto) return;
    if(!_fbDadosCarregados){
      const temDados = Object.keys(TICKETS_DB||{}).length > 0 ||
                       Object.keys(ADT_POR_FORN||{}).length > 0 ||
                       (CONTAS_PAGAR||[]).length > 0 ||
                       (BANCOS_DB||[]).length > 0 ||
                       (CLIENTES||[]).length > 0 ||
                       
                       
                       
                       
                       (function(){ try{ return !!localStorage.getItem('mm_funcionarios_edit'); }catch(e){ return false; } })() ||
                       (typeof AGENDA_DB!=='undefined' && (AGENDA_DB||[]).length > 0) ||
                       
                       
                       
                       
                       (typeof MANUTENCAO_DB!=='undefined' && (MANUTENCAO_DB||[]).length > 0) ||
                       (typeof MANUTPESS_DB!=='undefined' && (MANUTPESS_DB||[]).length > 0) ||
                       (typeof EPI_DB!=='undefined' && (EPI_DB||[]).length > 0) ||
                       (typeof PONTO_DB!=='undefined' && (PONTO_DB||[]).length > 0) ||
                       (typeof ALX_ITENS!=='undefined' && (ALX_ITENS||[]).length > 0) ||
                       (typeof ALX_MOV!=='undefined' && (ALX_MOV||[]).length > 0) ||
                       (typeof VIAGEM_DB!=='undefined' && (VIAGEM_DB||[]).length > 0) ||
                       (typeof COMBUSTIVEL_DB!=='undefined' && (COMBUSTIVEL_DB||[]).length > 0) ||
                       (typeof CONTAS_RECEBER!=='undefined' && (CONTAS_RECEBER||[]).length > 0) ||
                       (typeof VALES_DB!=='undefined' && (VALES_DB||[]).length > 0);
      if(!temDados){ console.warn('fbSalvar bloqueado: Firebase não carregou dados e local está vazio.'); return; }
    }
    if(!window._fbDB){ _fbSetStatus('offline'); return; }
    if(!_fbTemUsuarioAuth()){
      _fbSetStatus('saving','Restaurando sessão...');
      _fbRestaurarAuthEExecutar(_fbSalvarAgora,1500);
      return;
    }
    
    
    
    
    
    
    
    
    
    
    
    
    const _agoraPre=Date.now();
    const _pularChecagens = window._fbUltimaChecagemRemota && (_agoraPre - window._fbUltimaChecagemRemota) < 20000;
    if(!_pularChecagens) window._fbUltimaChecagemRemota=_agoraPre;
    if(!_pularChecagens) try{ await _mesclarContasPagarComNuvem(); }catch(e){}
    
    
    
    
    if(!_pularChecagens) try{
      await Promise.all([
        _syncContasReceber.buscarTombstonesRemotosEAplicar(),
        _syncAfazeres.buscarTombstonesRemotosEAplicar(),
        _syncVendas.buscarTombstonesRemotosEAplicar(),
        _syncVales.buscarTombstonesRemotosEAplicar(),
        _syncLancBanco.buscarTombstonesRemotosEAplicar(),
        _syncViagem.buscarTombstonesRemotosEAplicar(),
        _syncCombustivel.buscarTombstonesRemotosEAplicar(),
        _syncFrota.buscarTombstonesRemotosEAplicar(),
        _syncManutencao.buscarTombstonesRemotosEAplicar(),
        _syncAlxItens.buscarTombstonesRemotosEAplicar(),
        _syncAlxMov.buscarTombstonesRemotosEAplicar(),
        _syncClientes.buscarTombstonesRemotosEAplicar(),
        _syncFornecedores.buscarTombstonesRemotosEAplicar(),
        _syncBancos.buscarTombstonesRemotosEAplicar(),
        _syncDespGrupo.buscarTombstonesRemotosEAplicar(),
        _syncAlxNotas.buscarTombstonesRemotosEAplicar(),
        _syncContratos.buscarTombstonesRemotosEAplicar(),
        _syncDocsEmpresas.buscarTombstonesRemotosEAplicar(),
        _syncEpi.buscarTombstonesRemotosEAplicar(),
        _syncReunioes.buscarTombstonesRemotosEAplicar(),
        _syncAgenda.buscarTombstonesRemotosEAplicar(),
        _syncAdvertencias.buscarTombstonesRemotosEAplicar(),
        _syncBagsMov.buscarTombstonesRemotosEAplicar(),
        _syncHistorico.buscarTombstonesRemotosEAplicar(),
        _syncPonto.buscarTombstonesRemotosEAplicar(),
        _syncPontoBatidas.buscarTombstonesRemotosEAplicar(),
        _syncFornDespesa.buscarTombstonesRemotosEAplicar()
      ]);
    }catch(e){}
    _fbSetStatus('saving');
    try {
      const dados = {
        
        
        
        
        
        
        
        
        
        
        
        
        metais: METAIS||[],
        
        
        
        
        
        
        custosCasa: CUSTO_CASA||{},
        veicPess: VEICPESS_DB||[],
        manutPess: MANUTPESS_DB||[],
        
        
        
        
        
        tanque: TANQUE_DB||{},
        precosForn: PRECOS_FORN_DATA||{},
        precosCli: PRECOS_CLI_DATA||{},
        saldoDevedor: SALDO_DEVEDOR_FORN||{},
        
        
        
        
        users: JSON.parse(localStorage.getItem('mm_users')||'{}'),
        usersDeleted: _USERS_DEL||[],
        funcEdit: JSON.parse(localStorage.getItem('mm_funcionarios_edit')||'[]'),
        fornVeiculos: JSON.parse(localStorage.getItem('mm_forn_veiculos')||'{}'),
        
        
        
        
        
        viagemLimite: localStorage.getItem('mm_viagem_limite')||'',
        fiscal: (typeof FISCAL_DB !== 'undefined' ? FISCAL_DB : {}),
        fiscalApur: (typeof FISCAL_APUR !== 'undefined' ? FISCAL_APUR : {}),
        bags: { novos: BAGS_DB.novos||0, usados: BAGS_DB.usados||0 }, 
        ticketsDeleted: (typeof TICKETS_DELETED !== 'undefined' ? [...TICKETS_DELETED] : []),
        adtPorFornDeleted: [..._DEL_SETS.adtPorForn],
        chequesPorFornDeleted: [..._DEL_SETS.chequesPorForn],
        saldoDevedorDeleted: [..._DEL_SETS.saldoDevedor],
        estoqueDeleted: [..._DEL_SETS.estoque],
        fcSaldoIniDeleted: [..._DEL_SETS.fcSaldoIni],
        adtItensDeleted: [..._DEL_SETS.adtItens],
        chequeItensDeleted: [..._DEL_SETS.chequeItens],
        
        
        
        
        contasReceberDeleted: [..._syncContasReceber.deletedSet],
        afazeresDeleted: [..._syncAfazeres.deletedSet],
        vendasDeleted: [..._syncVendas.deletedSet],
        valesDeleted: [..._syncVales.deletedSet],
        lancBancoDeleted: [..._syncLancBanco.deletedSet],
        viagemDeleted: [..._syncViagem.deletedSet],
        combustivelDeleted: [..._syncCombustivel.deletedSet],
        frotaDeleted: [..._syncFrota.deletedSet],
        manutencaoDeleted: [..._syncManutencao.deletedSet],
        almoxaDeleted: [..._syncAlxItens.deletedSet],
        almoxaMovDeleted: [..._syncAlxMov.deletedSet],
        clientesDeleted: [..._syncClientes.deletedSet],
        fornecedoresDeleted: [..._syncFornecedores.deletedSet],
        bancosDeleted: [..._syncBancos.deletedSet],
        despGrupoDeleted: [..._syncDespGrupo.deletedSet],
        coordNotasDeleted: [..._syncAlxNotas.deletedSet],
        contratosDeleted: [..._syncContratos.deletedSet],
        docsEmpresasDeleted: [..._syncDocsEmpresas.deletedSet],
        epiDeleted: [..._syncEpi.deletedSet],
        reunioesDeleted: [..._syncReunioes.deletedSet],
        agendaEntregasDeleted: [..._syncAgenda.deletedSet],
        advertenciasDeleted: [..._syncAdvertencias.deletedSet],
        bagsMovDeleted: [..._syncBagsMov.deletedSet],
        historicoDeleted: [..._syncHistorico.deletedSet],
        pontoDeleted: [..._syncPonto.deletedSet],
        pontoBatidasDeleted: [..._syncPontoBatidas.deletedSet],
        fornDespesaDeleted: [..._syncFornDespesa.deletedSet],
        _ts: Date.now(),
        _user: (typeof cu !== 'undefined' && cu) ? cu.name : '?'
      };
      
      
      
      
      
      
      
      
      try{
        
        
        
        if(Array.isArray(dados.funcEdit) && dados.funcEdit.length===0){ delete dados.funcEdit; }
        else {
          const _funcEditAtual = JSON.stringify(dados.funcEdit);
          if(_funcEditAtual === _funcEditSnapJSON){ delete dados.funcEdit; }
        }
        
        
        
        if(dados.users && Object.keys(dados.users).length===0){ delete dados.users; }
        
        
        
        
        
        if(dados.custosCasa && Object.keys(dados.custosCasa).length===0){ delete dados.custosCasa; }
        if(Array.isArray(dados.veicPess) && dados.veicPess.length===0){ delete dados.veicPess; }
        if(Array.isArray(dados.manutPess) && dados.manutPess.length===0){ delete dados.manutPess; }
      }catch(e){}
      
      
      
      
      
      
      delete dados.users;
      delete dados.usersDeleted;
      
      
      if(!window.__ERP_BANKS_CLOUD_READY__) delete dados.bancosDeleted;
      if(!window.__ERP_FINANCE_CLOUD_READY__) delete dados.fcSaldoIniDeleted;
      const _valoresDelArrAtual = _deletedArrPularSeIgual(dados);
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      const _ticketsParaSalvar = {};
      Object.keys(TICKETS_DB).forEach(function(k){
        if(JSON.stringify(TICKETS_DB[k]) !== _ticketsSnapJSON[k]) _ticketsParaSalvar[k] = TICKETS_DB[k];
      });
      _patchIncremental(dados, 'tickets', _ticketsParaSalvar, TICKETS_DELETED);
      _patchIncremental(dados, 'historico', _syncHistorico.paraObjeto(), _syncHistorico.deletedSet);
      _patchIncremental(dados, 'ponto', _syncPonto.paraObjeto(), _syncPonto.deletedSet);
      _patchIncremental(dados, 'pontoBatidas', _syncPontoBatidas.paraObjeto(), _syncPontoBatidas.deletedSet);
      _patchIncremental(dados, 'folha', FOLHA_DB, null);
      _patchIncremental(dados, 'fornDespesa', _syncFornDespesa.paraObjeto(), _syncFornDespesa.deletedSet);
      _patchIncremental(dados, 'contasPagar', _cpParaObjeto(), CONTAS_PAGAR_DELETED);
      Object.keys(_cpDeletedParaObjeto()).forEach(function(id){ dados['contasPagarDeleted/'+id] = true; });
      _patchIncremental(dados, 'contasReceber', _syncContasReceber.paraObjeto(), _syncContasReceber.deletedSet);
      _patchIncremental(dados, 'afazeres', _syncAfazeres.paraObjeto(), _syncAfazeres.deletedSet);
      _patchIncremental(dados, 'vendas', _syncVendas.paraObjeto(), _syncVendas.deletedSet);
      _patchIncremental(dados, 'vales', _syncVales.paraObjeto(), _syncVales.deletedSet);
      _patchIncremental(dados, 'lancBanco', _syncLancBanco.paraObjeto(), _syncLancBanco.deletedSet);
      _patchIncremental(dados, 'viagem', _syncViagem.paraObjeto(), _syncViagem.deletedSet);
      _patchIncremental(dados, 'combustivel', _syncCombustivel.paraObjeto(), _syncCombustivel.deletedSet);
      _patchIncremental(dados, 'frota', _syncFrota.paraObjeto(), _syncFrota.deletedSet);
      _patchIncremental(dados, 'manutencao', _syncManutencao.paraObjeto(), _syncManutencao.deletedSet);
      _patchIncremental(dados, 'almoxa', _syncAlxItens.paraObjeto(), _syncAlxItens.deletedSet);
      _patchIncremental(dados, 'almoxaMov', _syncAlxMov.paraObjeto(), _syncAlxMov.deletedSet);
      _patchIncremental(dados, 'clientes', _syncClientes.paraObjeto(), _syncClientes.deletedSet);
      _patchIncremental(dados, 'fornecedores', _syncFornecedores.paraObjeto(), _syncFornecedores.deletedSet);
      Object.keys(_fornDeletedParaObjeto()).forEach(function(cod){ dados['fornDeleted/'+cod] = true; });
      if(window.__ERP_BANKS_CLOUD_READY__)
        _patchIncremental(dados, 'bancos', _syncBancos.paraObjeto(), _syncBancos.deletedSet);
      _patchIncremental(dados, 'despGrupo', _syncDespGrupo.paraObjeto(), _syncDespGrupo.deletedSet);
      _patchIncremental(dados, 'coordNotas', _syncAlxNotas.paraObjeto(), _syncAlxNotas.deletedSet);
      _patchIncremental(dados, 'contratos', _syncContratos.paraObjeto(), _syncContratos.deletedSet);
      _patchIncremental(dados, 'docsEmpresas', _syncDocsEmpresas.paraObjeto(), _syncDocsEmpresas.deletedSet);
      _patchIncremental(dados, 'epi', _syncEpi.paraObjeto(), _syncEpi.deletedSet);
      _patchIncremental(dados, 'reunioes', _syncReunioes.paraObjeto(), _syncReunioes.deletedSet);
      _patchIncremental(dados, 'agendaEntregas', _syncAgenda.paraObjeto(), _syncAgenda.deletedSet);
      _patchIncremental(dados, 'advertencias', _syncAdvertencias.paraObjeto(), _syncAdvertencias.deletedSet);
      
      
      
      
      
      
      
      _patchIncremental(dados, 'bagsMov', _syncBagsMov.paraObjeto(), _syncBagsMov.deletedSet);
      _patchIncremental(dados, 'coordFuncObs', COORD_FUNC_OBS, null);
      
      
      
      
      
      
      
      _patchIncremental(dados, 'adiantamentos', ADT_POR_FORN, null);
      _patchIncremental(dados, 'cheques', CHEQUES_POR_FORN, _DEL_SETS.chequesPorForn);
      _patchIncremental(dados, 'saldos', SALDO_DEVEDOR_FORN, _DEL_SETS.saldoDevedor);
      try{ _limparMateriaisInvalidos(); }catch(e){}
      try{ _arredondarDinheiro2Casas(); }catch(e){}
      _patchIncremental(dados, 'estoque', ESTOQUE_DB, _DEL_SETS.estoque);
      if(window.__ERP_FINANCE_CLOUD_READY__)
        _patchIncremental(dados, 'fcSaldoIni', FC_SALDO_INI, _DEL_SETS.fcSaldoIni);
      if(window.__ERP_FINANCE_CLOUD_READY__){
        _patchIncremental(dados, 'adtCli', ADT_CLI, null);
        _patchIncremental(dados, 'chequesCli', CHEQUES_CLI, null);
        _patchIncremental(dados, 'fcLanc', FC_LANC, null);
      }
      
      
      
      
      
      
      window._fbUltimoTs = dados._ts;
      if(!window._fbTsPendentesProprios) window._fbTsPendentesProprios = new Set();
      window._fbTsPendentesProprios.add(dados._ts);
      return _enviarDadosEmLotes(dados, 150*1024)
        .then(()=>{ _fbSetStatus('ok'); _fbSaveRetries=0; try{ _fbPendente=false; localStorage.setItem('mm_fb_pendente','0'); }catch(e){} _ticketsAtualizarSnapshot(); _funcEditAtualizarSnapshot(); _deletedArrConfirmarSnapshots(_valoresDelArrAtual); })
        .catch(e=>{
          console.warn('Firebase write error:',e);
          const _msgErro=(e&&e.message)?e.message:'Erro desconhecido (sem mensagem)';
          if(window._fbTsPendentesProprios) window._fbTsPendentesProprios.delete(dados._ts);
          
          
          
          
          try{
            const _ehPerm = (String((e&&e.code)||'')+' '+String(_msgErro)).toUpperCase().indexOf('PERMISSION')>=0;
            if(_ehPerm && _fbSaveRetries<3){
              _fbSaveRetries++;
              _fbSetStatus('error', _msgErro);
              let _un=''; try{ _un=sessionStorage.getItem('mm_sessao')||''; }catch(_e2){}
              if(_un){ _fbAuthLogin(_un, function(){ setTimeout(_fbSalvarAgora, 800); }, function(){ setTimeout(_fbSalvarAgora, 3000); }); return; }
            }
          }catch(_e){}
          _fbSaveRetries++;
          if(_fbSaveRetries<=3){
            _fbSetStatus('error', _msgErro);
            try{ showToast('⚠️ Erro ao salvar no Firebase: '+_msgErro,'error',9000); }catch(_){}
            setTimeout(_fbSalvarAgora, 3000*_fbSaveRetries); 
          } else {
            _fbSetStatus('offline', _msgErro);
            _fbSaveRetries=0;
          }
        });
    } catch(e) { console.warn('fbSalvar error:',e); _fbSetStatus('error'); }
  }

  
  function fbCarregar(callback) {
    if(!window._fbDB) { if(callback) callback(); return; }
    
    
    
    
    
    
    let _seguiu=false;
    const _seguir=()=>{ if(_seguiu) return; _seguiu=true; _fbCarregarComProtecoes(callback); };
    try{
      const _tGuard=setTimeout(_seguir, 4000);
      window._fbDB.ref('erp/_reset').once('value', function(snap){
        clearTimeout(_tGuard);
        try{ if(snap && snap.val()!=null && _verificarReset({_reset: snap.val()})) return; }catch(e){}
        _seguir();
      }, function(){ clearTimeout(_tGuard); _seguir(); });
    }catch(e){ _seguir(); }
  }
  function _fbCarregarComProtecoes(callback) {
    if(!window._fbDB) { if(callback) callback(); return; }
    
    
    
    
    
    
    
    
    try{
      if(localStorage.getItem('mm_fb_pendente')==='1'){
        console.warn('fbCarregar: alterações locais pendentes — entrando já, push em segundo plano, pull quando confirmar.');
        _fbPronto=true;
        
        
        let temLocal=false;
        try{
          temLocal = Object.keys(TICKETS_DB||{}).length>0 || (CONTAS_PAGAR||[]).length>0 ||
                     Object.keys(ADT_POR_FORN||{}).length>0 || (CLIENTES||[]).length>0;
        }catch(e){}
        if(!temLocal){ try{ localStorage.setItem('mm_fb_pendente','0'); }catch(e){} _fbCarregarDaNuvem(callback); return; }
        
        
        if(callback) callback();
        
        
        
        
        
        
        setTimeout(function(){ try{ _fbCarregarDaNuvem(function(){}); }catch(e){} }, 2000);
        let _pPush=null;
        try{ clearTimeout(_fbTimer); _pPush=_fbSalvarAgora(); }catch(e){}
        const _aposPush=function(){
          let aindaPendente=true;
          try{ aindaPendente = localStorage.getItem('mm_fb_pendente')==='1'; }catch(e){}
          if(aindaPendente){
            
            
            
            setTimeout(function(){ try{ fbSalvarImediato(); }catch(e){} }, 5000);
            return;
          }
          
          _fbCarregarDaNuvem(null);
        };
        if(_pPush && typeof _pPush.then==='function'){ _pPush.then(_aposPush, _aposPush); }
        else { setTimeout(_aposPush, 1500); }
        return;
      }
    }catch(e){}
    _fbCarregarDaNuvem(callback);
  }
  
  
  
  
  
  
  
  const _ERP_NOS_PESADOS = { frotaDocs:1, funcDocs:1, empresaDocs:1 };
  const _ERP_NOS_SINCRONIZADOS = [
    '_ts',
    '_user',
    '_untomb',
    'config',
    'metais',
    'custosCasa',
    'veicPess',
    'manutPess',
    'tanque',
    'precosForn',
    'precosCli',
    'saldoDevedor',
    'users',
    'usersDeleted',
    'funcEdit',
    'funcEditDel',
    'fornVeiculos',
    'viagemLimite',
    'fiscal',
    'fiscalApur',
    'bags',
    'ticketsDeleted',
    'adtPorFornDeleted',
    'chequesPorFornDeleted',
    'saldoDevedorDeleted',
    'estoqueDeleted',
    'fcSaldoIniDeleted',
    'adtItensDeleted',
    'chequeItensDeleted',
    'contasReceberDeleted',
    'afazeresDeleted',
    'vendasDeleted',
    'valesDeleted',
    'lancBancoDeleted',
    'viagemDeleted',
    'combustivelDeleted',
    'frotaDeleted',
    'manutencaoDeleted',
    'almoxaDeleted',
    'almoxaMovDeleted',
    'clientesDeleted',
    'fornecedoresDeleted',
    'bancosDeleted',
    'despGrupoDeleted',
    'coordNotasDeleted',
    'contratosDeleted',
    'docsEmpresasDeleted',
    'epiDeleted',
    'reunioesDeleted',
    'agendaEntregasDeleted',
    'advertenciasDeleted',
    'bagsMovDeleted',
    'historicoDeleted',
    'pontoDeleted',
    'pontoBatidasDeleted',
    'fornDespesaDeleted',
    'tickets',
    'historico',
    'ponto',
    'pontoBatidas',
    'folha',
    'fornDespesa',
    'contasPagar',
    'contasPagarDeleted',
    'contasReceber',
    'afazeres',
    'vendas',
    'vales',
    'lancBanco',
    'viagem',
    'combustivel',
    'frota',
    'manutencao',
    'almoxa',
    'almoxaMov',
    'clientes',
    'fornecedores',
    'fornDeleted',
    'bancos',
    'despGrupo',
    'coordNotas',
    'contratos',
    'docsEmpresas',
    'epi',
    'reunioes',
    'agendaEntregas',
    'advertencias',
    'bagsMov',
    'coordFuncObs',
    'adiantamentos',
    'cheques',
    'saldos',
    'estoque',
    'fcSaldoIni',
    'adtCli',
    'chequesCli',
    'fcLanc'
  ];
  function _lerErpSemPesados(onOk, onErr){
    (async function(){
      try{
        var u=(firebase.auth && firebase.auth().currentUser)||null;
        if(!u) throw new Error('Sessão Firebase não autenticada.');
        var tokenResult=await u.getIdTokenResult();
        var claims=(tokenResult&&tokenResult.claims)||{};
        if(claims.erpAccess!==true) throw new Error('Sessão sem acesso ao ERP.');
        var keys=_ERP_NOS_SINCRONIZADOS.slice();
        if(claims.canChat===true) keys.push('chat');
        var partes=await Promise.all(keys.map(async function(k){
          try{
            var snap=await window._fbDB.ref('erp/'+k).once('value');
            return [k,snap.val(),true];
          }catch(error){
            var code=String((error&&error.code)||'').toUpperCase();
            if(code.indexOf('PERMISSION')>=0) return [k,undefined,false];
            throw error;
          }
        }));
        var d={};
        var shallowKeys=[];
        partes.forEach(function(p){
          if(!p[2]) return;
          if(p[1]!==undefined && p[1]!==null){ d[p[0]]=p[1]; shallowKeys.push(p[0]); }
        });
        try{ Object.defineProperty(d,'_shallowKeys',{value:shallowKeys,enumerable:false,configurable:true}); }
        catch(e){ try{ d._shallowKeys=shallowKeys; }catch(_e){} }
        onOk(d);
      }catch(e){ if(onErr) onErr(e); else onOk(null); }
    })();
  }
  function _fbCarregarDaNuvem(callback) {
    if(!window._fbDB) { if(callback) callback(); return; }
    const loadingEl = document.getElementById('fb-loading');
    if(loadingEl) loadingEl.style.display='flex';
    
    let _fbCallbackChamado = false;
    const _fbTimeout = setTimeout(function(){
      if(_fbCallbackChamado) return;
      _fbCallbackChamado = true;
      console.warn('fbCarregar: timeout — usando dados locais');
      if(loadingEl) loadingEl.style.display='none';
      if(callback) callback();
    }, 8000);
    _lerErpSemPesados((d) => {
      const _chegouTarde = _fbCallbackChamado; 
      clearTimeout(_fbTimeout);
      _fbCallbackChamado = true;
      if(loadingEl) loadingEl.style.display='none';
      if(d && _verificarReset(d)) return;
      if(d) {
        _fbAtualizando = true;
        try {
          
          
          
          
          
          _normalizarDeletedV2EmD(d);
          _aplicarConfigNegocio(d);
          
          const _fbConfiavel = !!d._ts;
          
          function _fbArr(arr){ return Array.isArray(arr) && (_fbConfiavel || arr.length > 0); }

          
          const _adtLocal   = JSON.parse(JSON.stringify(ADT_POR_FORN));
          const _cheqLocal  = JSON.parse(JSON.stringify(CHEQUES_POR_FORN));
          const _saldLocal  = JSON.parse(JSON.stringify(SALDO_DEVEDOR_FORN));

          
          
          function _safeMerge(local, remote, target){
            if(_fbConfiavel){
              
              Object.keys(target).forEach(k=>delete target[k]);
              if(remote) Object.assign(target, remote);
              Object.entries(local).forEach(([k,v])=>{ if(!(remote&&remote[k]) && v&&(Array.isArray(v)?v.length:true)) target[k]=v; });
            } else if(remote && Object.keys(remote).length>0){
              Object.assign(target, remote);
              Object.entries(local).forEach(([k,v])=>{ if(!remote[k] && v&&(Array.isArray(v)?v.length:true)) target[k]=v; });
            }
          }

          
          
          
          
          
          
          { const _tkLocal=JSON.parse(JSON.stringify(TICKETS_DB)); _safeMerge(_tkLocal, d.tickets||{}, TICKETS_DB); }
          
          
          
          
          
          
          
          
          
          
          
          
          
          if(d.ticketsDeleted && Array.isArray(d.ticketsDeleted) && typeof TICKETS_DELETED!=='undefined'){
            d.ticketsDeleted.forEach(function(tid){ TICKETS_DELETED.add(tid); });
            try{ localStorage.setItem('mm_tickets_deletados', JSON.stringify([...TICKETS_DELETED])); }catch(e){}
          }
          if(d._untomb){ _aplicarUntomb(d._untomb); }
          
          
          
          
          try{
            let _tkRemovidos=false;
            TICKETS_DELETED.forEach(function(tid){ if(TICKETS_DB[tid]!==undefined){ delete TICKETS_DB[tid]; _tkRemovidos=true; } });
          }catch(e){}
          if(typeof TICKETS_DELETED!=='undefined'){ TICKETS_DELETED.forEach(function(tid){ delete TICKETS_DB[tid]; }); }
          _ticketsAtualizarSnapshot();
          
          
          _mergeAdtCloudManda(_adtLocal, d.adiantamentos, ADT_POR_FORN, _fbConfiavel, (d._shallowKeys && d._shallowKeys.indexOf('adiantamentos')>=0));
          _mergeObjDeArraysPorId(_cheqLocal, d.cheques||{},       CHEQUES_POR_FORN, 'id');
          _safeMerge(_saldLocal, d.saldos||{},        SALDO_DEVEDOR_FORN);
          
          
          
          
          
          _syncHistorico.carregarDeRemoto(d.historico, _fbConfiavel);
          HISTORICO_DB.sort((a,b)=>(a&&a.ts||0)-(b&&b.ts||0));
          if(HISTORICO_DB.length>1000) HISTORICO_DB.splice(0,HISTORICO_DB.length-1000);
          _fcAplicarNuvem(d);
          _estoqueAplicarDaNuvem(d.estoque, _fbConfiavel, d._shallowKeys);
          
          
          
          _aplicarTombstonesRemotos('adtPorForn', ADT_POR_FORN, d.adtPorFornDeleted);
          _aplicarTombstonesRemotos('chequesPorForn', CHEQUES_POR_FORN, d.chequesPorFornDeleted);
          _aplicarTombstonesRemotos('saldoDevedor', SALDO_DEVEDOR_FORN, d.saldoDevedorDeleted);
          _aplicarTombstonesRemotos('estoque', ESTOQUE_DB, d.estoqueDeleted);
          _aplicarTombstonesRemotos('fcSaldoIni', FC_SALDO_INI, d.fcSaldoIniDeleted);
          
          
          
          _aplicarTombstonesItensPorForn('adtItens', ADT_POR_FORN, 'cod', d.adtItensDeleted);
          _aplicarTombstonesItensPorForn('chequeItens', CHEQUES_POR_FORN, 'id', d.chequeItensDeleted);
          _mergeMetaisRemoto(d.metais, d.estoqueDeleted);
          try{ _recuperarMateriaisComMovimento(true); }catch(e){}
          
          
          
          _cpCarregarDeRemoto(d.contasPagar, _fbConfiavel);
          _cpDeletedCarregarDeRemoto(d.contasPagarDeleted);
          
          
          _syncContasReceber.carregarDeRemoto(d.contasReceber, _fbConfiavel);
          _syncContasReceber.aplicarTombstonesRemotos(d.contasReceberDeleted);
          _syncAfazeres.carregarDeRemoto(d.afazeres, _fbConfiavel);
          _syncAfazeres.aplicarTombstonesRemotos(d.afazeresDeleted);
          _syncVendas.carregarDeRemoto(d.vendas, _fbConfiavel);
          _syncVendas.aplicarTombstonesRemotos(d.vendasDeleted);
          if(d.custosCasa){
            
            
            try{ Object.keys(d.custosCasa).forEach(function(m){
              if(!CUSTO_CASA[m] || (Array.isArray(d.custosCasa[m]) && d.custosCasa[m].length>=((CUSTO_CASA[m]||[]).length))) CUSTO_CASA[m]=d.custosCasa[m];
            }); }catch(e){ CUSTO_CASA=d.custosCasa; }
          }
          if(d.veicPess) VEICPESS_DB = Array.isArray(d.veicPess)?d.veicPess:Object.values(d.veicPess);
          if(d.manutPess) MANUTPESS_DB = Array.isArray(d.manutPess)?d.manutPess:Object.values(d.manutPess);
          _syncVales.carregarDeRemoto(d.vales, _fbConfiavel);
          _syncVales.aplicarTombstonesRemotos(d.valesDeleted);
          _syncPonto.carregarDeRemoto(d.ponto, _fbConfiavel);
          _syncPonto.aplicarTombstonesRemotos(d.pontoDeleted);
          _syncPontoBatidas.carregarDeRemoto(d.pontoBatidas, _fbConfiavel);
          _syncPontoBatidas.aplicarTombstonesRemotos(d.pontoBatidasDeleted);
          
          
          
          
          
          
          if(d.folha && typeof d.folha==='object' && !Array.isArray(d.folha)){ Object.assign(FOLHA_DB, d.folha); }
          _syncViagem.carregarDeRemoto(d.viagem, _fbConfiavel);
          _syncViagem.aplicarTombstonesRemotos(d.viagemDeleted);
          _syncCombustivel.carregarDeRemoto(d.combustivel, _fbConfiavel);
          _syncCombustivel.aplicarTombstonesRemotos(d.combustivelDeleted);
          if(d.tanque) Object.assign(TANQUE_DB, d.tanque);
          if(d.precosForn) Object.assign(PRECOS_FORN_DATA, d.precosForn);
          if(d.precosCli) Object.assign(PRECOS_CLI_DATA, d.precosCli);
          _syncClientes.carregarDeRemoto(d.clientes, _fbConfiavel);
          _syncClientes.aplicarTombstonesRemotos(d.clientesDeleted);
          _syncFornecedores.carregarDeRemoto(d.fornecedores, _fbConfiavel);
          _syncFornecedores.aplicarTombstonesRemotos(d.fornecedoresDeleted);
          try{ if(typeof rodPopularPessoaSelect==='function') rodPopularPessoaSelect(); }catch(e){}
          if(Array.isArray(d.usersDeleted)){
            d.usersDeleted.forEach(function(k){ if(k && _USERS_DEL.indexOf(k)<0) _USERS_DEL.push(k); });
            try{ localStorage.setItem('mm_users_del', JSON.stringify(_USERS_DEL)); }catch(e){}
          }
          if(d.users){
            
            const _uu=d.users||{};
            _USERS_DEL.forEach(function(k){ if(_uu[k]) delete _uu[k]; });
            localStorage.setItem('mm_users', JSON.stringify(_uu));
          }
          try{ loadUsers(); }catch(e){}
          
          
          
          {
            var _mrgFE = _mesclarFuncEdit(d.funcEdit, d.funcEditDel);
            if(_mrgFE && _mrgFE.length && typeof FUNCIONARIOS!=='undefined'){
              FUNCIONARIOS.length=0; _mrgFE.forEach(f=>FUNCIONARIOS.push(f));
              try{ localStorage.setItem('mm_funcionarios_edit', JSON.stringify(_mrgFE)); }catch(e){ console.warn('funcEdit localStorage cheio'); }
              try{ document.dispatchEvent(new CustomEvent('erp:alert-source-changed',{detail:{source:'funcionarios'}})); }catch(e){}
              var _remLen = Array.isArray(d.funcEdit)?d.funcEdit.length:0;
              if(_mrgFE.length > _remLen){
                
                
                try{ _funcEditSnapJSON=null; }catch(e){}
                try{ if(typeof fbSalvar==='function') fbSalvar(); }catch(e){}
              } else {
                try{ _funcEditAtualizarSnapshot(); }catch(e){}
              }
            } else {
              try{ _funcEditAtualizarSnapshot(); }catch(e){}
            }
          }
          if(d.fornVeiculos) localStorage.setItem('mm_forn_veiculos', JSON.stringify(d.fornVeiculos));
          if(d.chat && typeof CHAT_MSGS!=='undefined'){ const _msgsChat=_chatMsgsFromRemote(d.chat); CHAT_MSGS.length=0; _msgsChat.forEach(m=>CHAT_MSGS.push(m)); localStorage.setItem('mm_chat',JSON.stringify(_msgsChat)); }
          _fornDeletedCarregarDeRemoto(d.fornDeleted);
          _syncFornDespesa.carregarDeRemoto(d.fornDespesa, _fbConfiavel);
          _syncFornDespesa.aplicarTombstonesRemotos(d.fornDespesaDeleted);
          
          
          
          
          _syncFrota.carregarDeRemoto(d.frota, _fbConfiavel);
          _syncFrota.aplicarTombstonesRemotos(d.frotaDeleted);
          _syncManutencao.carregarDeRemoto(d.manutencao, _fbConfiavel);
          _syncManutencao.aplicarTombstonesRemotos(d.manutencaoDeleted);
          if(!d._shallowKeys || !d._shallowKeys.includes('bancos') || d.bancos!=null){
            _bancosPrepararTombstonesCloud();
            _syncBancos.carregarDeRemoto(_normalizarBancosRemotos(d.bancos), _fbConfiavel);
            _syncBancos.aplicarTombstonesRemotos(d.bancosDeleted);
            window.__ERP_BANKS_CLOUD_READY__=true;
          } else console.warn('Bancos: snapshot parcial, cadastro remoto não foi carregado.');
          _syncLancBanco.carregarDeRemoto(d.lancBanco, _fbConfiavel);
          _syncLancBanco.aplicarTombstonesRemotos(d.lancBancoDeleted);
          _syncDespGrupo.carregarDeRemoto(d.despGrupo, _fbConfiavel);
          _syncDespGrupo.aplicarTombstonesRemotos(d.despGrupoDeleted);
          if(d.viagemLimite){ localStorage.setItem('mm_viagem_limite', d.viagemLimite); }
          _syncAlxItens.carregarDeRemoto(d.almoxa, _fbConfiavel);
          _syncAlxItens.aplicarTombstonesRemotos(d.almoxaDeleted);
          _syncAlxMov.carregarDeRemoto(d.almoxaMov, _fbConfiavel);
          _syncAlxMov.aplicarTombstonesRemotos(d.almoxaMovDeleted);
          _syncAlxNotas.carregarDeRemoto(d.coordNotas, _fbConfiavel);
          _syncAlxNotas.aplicarTombstonesRemotos(d.coordNotasDeleted);
          _syncContratos.carregarDeRemoto(d.contratos, _fbConfiavel);
          _syncContratos.aplicarTombstonesRemotos(d.contratosDeleted);
          _syncDocsEmpresas.carregarDeRemoto(d.docsEmpresas, _fbConfiavel);
          _syncDocsEmpresas.aplicarTombstonesRemotos(d.docsEmpresasDeleted);
          localStorage.setItem('mm_docs_empresas',JSON.stringify(DOCS_EMPRESAS));
          try{ document.dispatchEvent(new CustomEvent('erp:alert-source-changed',{detail:{source:'documentos_empresas'}})); }catch(e){}
          if(d.fiscal && typeof d.fiscal==='object' && typeof FISCAL_DB!=='undefined'){ Object.keys(FISCAL_DB).forEach(k=>delete FISCAL_DB[k]); Object.assign(FISCAL_DB, d.fiscal); localStorage.setItem('mm_fiscal',JSON.stringify(FISCAL_DB)); }
          if(d.fiscalApur && typeof d.fiscalApur==='object' && typeof FISCAL_APUR!=='undefined'){ Object.keys(FISCAL_APUR).forEach(k=>delete FISCAL_APUR[k]); Object.assign(FISCAL_APUR, d.fiscalApur); try{localStorage.setItem('mm_fiscal_apur',JSON.stringify(FISCAL_APUR));}catch(_){} }
          _syncEpi.carregarDeRemoto(d.epi, _fbConfiavel);
          _syncEpi.aplicarTombstonesRemotos(d.epiDeleted);
          localStorage.setItem('mm_epi',JSON.stringify(EPI_DB));
          _syncReunioes.carregarDeRemoto(d.reunioes, _fbConfiavel);
          _syncReunioes.aplicarTombstonesRemotos(d.reunioesDeleted);
          _syncAgenda.carregarDeRemoto(d.agendaEntregas, !!d._ts);
          _syncAgenda.aplicarTombstonesRemotos(d.agendaEntregasDeleted);
          try{ localStorage.setItem('mm_agenda', JSON.stringify(AGENDA_DB)); }catch(_e){}
          localStorage.setItem('mm_reunioes',JSON.stringify(REUNIOES_DB));
          _syncAdvertencias.carregarDeRemoto(d.advertencias, _fbConfiavel);
          _syncAdvertencias.aplicarTombstonesRemotos(d.advertenciasDeleted);
          localStorage.setItem('mm_advertencias',JSON.stringify(ADVERTENCIAS_DB));
          
          
          
          
          _syncBagsMov.carregarDeRemoto(('bagsMov' in d) ? d.bagsMov : (d.bags && d.bags.mov), _fbConfiavel);
          _syncBagsMov.aplicarTombstonesRemotos(d.bagsMovDeleted);
          _bagsRecalcularTotais();
          localStorage.setItem('mm_bags',JSON.stringify(BAGS_DB));
          
          
          
          
          if(d.coordFuncObs && typeof d.coordFuncObs==='object'){ Object.assign(COORD_FUNC_OBS, d.coordFuncObs); localStorage.setItem('mm_coord_fobs',JSON.stringify(COORD_FUNC_OBS)); }
        } catch(err){ console.warn('fbCarregar parse error:',err); }
        _fbAtualizando = false;
        _fcRedesenharSeAberta();
        _fbDadosCarregados = true;window.__FB_DATA_READY__=true;
        _fbSetStatus('ok');

        
        try{ if(typeof _supCarregarEExecutarPatches==='function') setTimeout(_supCarregarEExecutarPatches, 500); }catch(_){}

        
        
        
        
        try{
          localStorage.setItem('mm_adt',         JSON.stringify(ADT_POR_FORN));
          localStorage.setItem('mm_adt_cli',      JSON.stringify(ADT_CLI||{}));
          localStorage.setItem('mm_cheques',      JSON.stringify(CHEQUES_POR_FORN));
          localStorage.setItem('mm_cheques_cli',  JSON.stringify(CHEQUES_CLI||{}));
          localStorage.setItem('mm_fc_lanc',      JSON.stringify(FC_LANC||{}));
          localStorage.setItem('mm_fc_saldoini',  JSON.stringify(FC_SALDO_INI||{}));
          localStorage.setItem('mm_cp',           JSON.stringify(CONTAS_PAGAR));
          localStorage.setItem('mm_precos_forn',  JSON.stringify(PRECOS_FORN_DATA));
          localStorage.setItem('mm_precos_cli',   JSON.stringify(PRECOS_CLI_DATA));
          localStorage.setItem('mm_saldo_devedor',JSON.stringify(SALDO_DEVEDOR_FORN));
          localStorage.setItem('mm_bancos',       JSON.stringify(typeof BANCOS_DB!=='undefined'?BANCOS_DB:[]));
          localStorage.setItem('mm_lanc_banco',   JSON.stringify(typeof LANC_BANCO_DB!=='undefined'?LANC_BANCO_DB:[]));
          if(typeof ESTOQUE_DB!=='undefined') localStorage.setItem('mm_estoque', JSON.stringify(ESTOQUE_DB));
          if(typeof VIAGEM_DB!=='undefined')  localStorage.setItem('mm_viagem',  JSON.stringify(VIAGEM_DB));
          if(typeof COMBUSTIVEL_DB!=='undefined') localStorage.setItem('mm_comb_ru', JSON.stringify(COMBUSTIVEL_DB));
          if(typeof PONTO_DB!=='undefined')   localStorage.setItem('mm_ponto',   JSON.stringify(PONTO_DB));
          if(typeof FOLHA_DB!=='undefined')   localStorage.setItem('mm_folha_db',JSON.stringify(FOLHA_DB));
          if(typeof VALES_DB!=='undefined')   localStorage.setItem('mm_vales',   JSON.stringify(VALES_DB));
          if(typeof EPI_DB!=='undefined')     localStorage.setItem('mm_epi',     JSON.stringify(EPI_DB));
          if(typeof REUNIOES_DB!=='undefined') localStorage.setItem('mm_reunioes',JSON.stringify(REUNIOES_DB));
          if(typeof ADVERTENCIAS_DB!=='undefined') localStorage.setItem('mm_advertencias',JSON.stringify(ADVERTENCIAS_DB));
          if(typeof BAGS_DB!=='undefined')        localStorage.setItem('mm_bags',       JSON.stringify(BAGS_DB));
          if(typeof COORD_FUNC_OBS!=='undefined') localStorage.setItem('mm_coord_fobs', JSON.stringify(COORD_FUNC_OBS));
        }catch(lsErr){ console.warn('fbCarregar localStorage sync error:', lsErr); }
        
      } else {
        
        
        console.log('Firebase vazio ou sem dados — saves automáticos mantidos bloqueados até ação do usuário.');
        _fbPronto = true;
        
        const temDadosLocais = Object.keys(ADT_POR_FORN||{}).length > 0 ||
                               (CONTAS_PAGAR||[]).length > 0 ||
                               (BANCOS_DB||[]).length > 0 ||
                               Object.keys(TICKETS_DB||{}).length > 0;
        if(temDadosLocais){
          _fbDadosCarregados = true;window.__FB_DATA_READY__=true;
          setTimeout(()=>{ try{ _fbSalvarAgora(); }catch(e){} }, 1000);
        }
      }
      _fbPronto = true;
      if(!_chegouTarde){ if(callback) callback(); }
      else {
        
        try{ showToast('☁️ Dados da nuvem chegaram — telas atualizadas.','info',4000); }catch(e){}
        [ 'renderTbFuncionarios','renderVendas','renderContasReceber','renderContasPagar',
          'renderTabelaFornecedores','renderEstoque','renderAdiantamentos','renderFrota',
          'agendaRender','renderDashboard','renderCombustivel','renderBancos','renderEpi','renderRodBalanca'
        ].forEach(function(fn){ try{ if(typeof window[fn]==='function') window[fn](); }catch(e){} });
      }
    }, err => {
      if(loadingEl) loadingEl.style.display='none';
      console.warn('Firebase load error:', err);
      try{ if(String((err&&err.code)||err||'').toUpperCase().indexOf('PERMISSION')>=0) _fbAvisoAuthFalhou((err&&err.code)||'permission-denied'); }catch(e){}
      
      _fbPronto = true;
      if(callback) callback(); 
    });
  }

  
  let _fbListenerAtivo = false;
  function fbIniciarListener() {
    if(_fbListenerAtivo) return;
    if(!window._fbDB) return;
    if(!_fbTemUsuarioAuth()){
      _fbRestaurarAuthEExecutar(fbIniciarListener,1500);
      return;
    }
    _fbListenerAtivo = true;

    
    window._fbDB.ref('.info/connected').on('value', snap => {
      _fbOnline = !!snap.val();
      _fbSetStatus(_fbOnline ? 'ok' : 'offline');
      if(_fbOnline && _fbDadosCarregados){
        
        clearTimeout(_fbTimer);
        setTimeout(_fbSalvarAgora, 1000);
      }
    });

    window._fbDB.ref('erp/_ts').on('value', snap => {
      if(_fbAtualizando) return;
      const ts = snap.val();
      if(!ts) return;
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      if(window._fbTsPendentesProprios && window._fbTsPendentesProprios.has(ts)){
        window._fbTsPendentesProprios.delete(ts);
        window._fbUltimoTs = ts;
        return;
      }
      if(!window._fbUltimoTs) { window._fbUltimoTs = ts; return; }
      if(ts === window._fbUltimoTs) return;
      window._fbUltimoTs = ts;
      
      
      
      
      
      
      
      
      
      const _flushAntes = _fbTimer
        ? (function(){ clearTimeout(_fbTimer); _fbTimer=null; return _fbSalvarAgora().catch(function(){}); })()
        : Promise.resolve();
      _flushAntes.then(function(){
      
      _lerErpSemPesados(function(d){
        if(!d) return;
        if(_verificarReset(d)) return;
        _fbAtualizando = true;
        try {
          
          
          _normalizarDeletedV2EmD(d);
          _aplicarConfigNegocio(d);
          
          const _fbConf2 = !!d._ts;
          const _mergeObj=(local,remote,target)=>{
            Object.keys(target).forEach(k=>delete target[k]);
            if(remote) Object.assign(target,remote);
            Object.entries(local).forEach(([k,v])=>{if(!(remote&&remote[k])&&v&&(Array.isArray(v)?v.length:true))target[k]=v;});
          };
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          { const _tkLocal=JSON.parse(JSON.stringify(TICKETS_DB)); _mergeObj(_tkLocal, d.tickets||{}, TICKETS_DB); }
          
          
          
          
          
          if(d.ticketsDeleted && Array.isArray(d.ticketsDeleted) && typeof TICKETS_DELETED!=='undefined'){
            d.ticketsDeleted.forEach(function(tid){ TICKETS_DELETED.add(tid); });
            try{ localStorage.setItem('mm_tickets_deletados', JSON.stringify([...TICKETS_DELETED])); }catch(e){}
          }
          if(d._untomb){ _aplicarUntomb(d._untomb); }
          
          
          
          
          try{
            let _tkRemovidos=false;
            TICKETS_DELETED.forEach(function(tid){ if(TICKETS_DB[tid]!==undefined){ delete TICKETS_DB[tid]; _tkRemovidos=true; } });
          }catch(e){}
          if(typeof TICKETS_DELETED!=='undefined'){ TICKETS_DELETED.forEach(function(tid){ delete TICKETS_DB[tid]; }); }
          _ticketsAtualizarSnapshot();
          _syncHistorico.carregarDeRemoto(d.historico, !!d._ts);
          HISTORICO_DB.sort((a,b)=>(a&&a.ts||0)-(b&&b.ts||0));
          if(HISTORICO_DB.length>1000) HISTORICO_DB.splice(0,HISTORICO_DB.length-1000);
          
          
          { const loc=JSON.parse(JSON.stringify(ADT_POR_FORN)); _mergeAdtCloudManda(loc, d.adiantamentos, ADT_POR_FORN, _fbConf2, (d._shallowKeys && d._shallowKeys.indexOf('adiantamentos')>=0)); }
          { const loc=JSON.parse(JSON.stringify(CHEQUES_POR_FORN)); _mergeObjDeArraysPorId(loc, d.cheques||{}, CHEQUES_POR_FORN, 'id'); }
          { const loc=JSON.parse(JSON.stringify(SALDO_DEVEDOR_FORN)); _mergeObj(loc, d.saldos||{}, SALDO_DEVEDOR_FORN); }
          _fcAplicarNuvem(d);
          _cpCarregarDeRemoto(d.contasPagar, !!d._ts);
          _cpDeletedCarregarDeRemoto(d.contasPagarDeleted);
          _syncVendas.carregarDeRemoto(d.vendas, !!d._ts);
          _syncVendas.aplicarTombstonesRemotos(d.vendasDeleted);
          _syncContasReceber.carregarDeRemoto(d.contasReceber, !!d._ts);
          _syncContasReceber.aplicarTombstonesRemotos(d.contasReceberDeleted);
          _syncAfazeres.carregarDeRemoto(d.afazeres, !!d._ts);
          _syncAfazeres.aplicarTombstonesRemotos(d.afazeresDeleted);
          _syncVales.carregarDeRemoto(d.vales, !!d._ts);
          _syncVales.aplicarTombstonesRemotos(d.valesDeleted);
          _estoqueAplicarDaNuvem(d.estoque, _fbConf2, d._shallowKeys);
          
          _aplicarTombstonesRemotos('adtPorForn', ADT_POR_FORN, d.adtPorFornDeleted);
          _aplicarTombstonesRemotos('chequesPorForn', CHEQUES_POR_FORN, d.chequesPorFornDeleted);
          _aplicarTombstonesRemotos('saldoDevedor', SALDO_DEVEDOR_FORN, d.saldoDevedorDeleted);
          _aplicarTombstonesRemotos('estoque', ESTOQUE_DB, d.estoqueDeleted);
          _aplicarTombstonesRemotos('fcSaldoIni', FC_SALDO_INI, d.fcSaldoIniDeleted);
          _aplicarTombstonesItensPorForn('adtItens', ADT_POR_FORN, 'cod', d.adtItensDeleted);
          _aplicarTombstonesItensPorForn('chequeItens', CHEQUES_POR_FORN, 'id', d.chequeItensDeleted);
          if(!d._shallowKeys || !d._shallowKeys.includes('bancos') || d.bancos!=null){
            _bancosPrepararTombstonesCloud();
            _syncBancos.carregarDeRemoto(_normalizarBancosRemotos(d.bancos), !!d._ts);
            _syncBancos.aplicarTombstonesRemotos(d.bancosDeleted);
            window.__ERP_BANKS_CLOUD_READY__=true;
            try{const aba=document.getElementById('tab-contas_banco');if(aba&&aba.classList.contains('active')&&typeof renderBancos==='function')renderBancos();}catch(e){}
          } else console.warn('Bancos: atualização parcial, não substituir cache por dados incompletos.');
          _syncLancBanco.carregarDeRemoto(d.lancBanco, !!d._ts);
          _syncLancBanco.aplicarTombstonesRemotos(d.lancBancoDeleted);
          _syncDespGrupo.carregarDeRemoto(d.despGrupo, !!d._ts);
          _syncDespGrupo.aplicarTombstonesRemotos(d.despGrupoDeleted);
          _syncAlxNotas.carregarDeRemoto(d.coordNotas, !!d._ts);
          _syncAlxNotas.aplicarTombstonesRemotos(d.coordNotasDeleted);
          _syncEpi.carregarDeRemoto(d.epi, !!d._ts);
          _syncEpi.aplicarTombstonesRemotos(d.epiDeleted);
          _syncReunioes.carregarDeRemoto(d.reunioes, !!d._ts);
          _syncReunioes.aplicarTombstonesRemotos(d.reunioesDeleted);
          _syncAgenda.carregarDeRemoto(d.agendaEntregas, !!d._ts);
          _syncAgenda.aplicarTombstonesRemotos(d.agendaEntregasDeleted);
          try{ localStorage.setItem('mm_agenda', JSON.stringify(AGENDA_DB)); }catch(_e){}
          _syncAdvertencias.carregarDeRemoto(d.advertencias, !!d._ts);
          _syncAdvertencias.aplicarTombstonesRemotos(d.advertenciasDeleted);
          _syncBagsMov.carregarDeRemoto(('bagsMov' in d) ? d.bagsMov : (d.bags && d.bags.mov), !!d._ts);
          _syncBagsMov.aplicarTombstonesRemotos(d.bagsMovDeleted);
          _bagsRecalcularTotais();
          if(d.coordFuncObs && typeof d.coordFuncObs==='object'){ Object.assign(COORD_FUNC_OBS, d.coordFuncObs); }
          _syncPonto.carregarDeRemoto(d.ponto, !!d._ts);
          _syncPonto.aplicarTombstonesRemotos(d.pontoDeleted);
          _syncPontoBatidas.carregarDeRemoto(d.pontoBatidas, !!d._ts);
          _syncPontoBatidas.aplicarTombstonesRemotos(d.pontoBatidasDeleted);
          if(d.folha && typeof d.folha==='object' && !Array.isArray(d.folha)){ Object.assign(FOLHA_DB, d.folha); }
          _syncFornDespesa.carregarDeRemoto(d.fornDespesa, !!d._ts);
          _syncFornDespesa.aplicarTombstonesRemotos(d.fornDespesaDeleted);
          _syncViagem.carregarDeRemoto(d.viagem, !!d._ts);
          _syncViagem.aplicarTombstonesRemotos(d.viagemDeleted);
          _syncCombustivel.carregarDeRemoto(d.combustivel, !!d._ts);
          _syncCombustivel.aplicarTombstonesRemotos(d.combustivelDeleted);
          
          
          
          
          
          
          {
            var _mrgFE2 = _mesclarFuncEdit(d.funcEdit, d.funcEditDel);
            if(_mrgFE2 && _mrgFE2.length && typeof FUNCIONARIOS!=='undefined'){
              FUNCIONARIOS.length=0; _mrgFE2.forEach(f=>FUNCIONARIOS.push(f));
              try{ localStorage.setItem('mm_funcionarios_edit', JSON.stringify(_mrgFE2)); }catch(e){}
              try{ document.dispatchEvent(new CustomEvent('erp:alert-source-changed',{detail:{source:'funcionarios'}})); }catch(e){}
              var _remLen2 = Array.isArray(d.funcEdit)?d.funcEdit.length:0;
              if(_mrgFE2.length > _remLen2){
                try{ _funcEditSnapJSON=null; }catch(e){}
                try{ if(typeof fbSalvar==='function') fbSalvar(); }catch(e){}
              } else {
                try{ _funcEditAtualizarSnapshot(); }catch(e){}
              }
            } else {
              try{ _funcEditAtualizarSnapshot(); }catch(e){}
            }
          }
          _syncFrota.carregarDeRemoto(d.frota, !!d._ts);
          _syncFrota.aplicarTombstonesRemotos(d.frotaDeleted);
          _syncManutencao.carregarDeRemoto(d.manutencao, !!d._ts);
          _syncManutencao.aplicarTombstonesRemotos(d.manutencaoDeleted);
          _syncAlxItens.carregarDeRemoto(d.almoxa, !!d._ts);
          _syncAlxItens.aplicarTombstonesRemotos(d.almoxaDeleted);
          _syncAlxMov.carregarDeRemoto(d.almoxaMov, !!d._ts);
          _syncAlxMov.aplicarTombstonesRemotos(d.almoxaMovDeleted);
          if(d.metais && Array.isArray(d.metais) && d.metais.length){
            _mergeMetaisRemoto(d.metais, d.estoqueDeleted);
            try{ _recuperarMateriaisComMovimento(true); }catch(e){}
            
            
            
            try{ refreshMetaisGlobals(); }catch(e){}
          }
          _syncFornecedores.carregarDeRemoto(d.fornecedores, !!d._ts);
          _syncFornecedores.aplicarTombstonesRemotos(d.fornecedoresDeleted);
          _fornDeletedCarregarDeRemoto(d.fornDeleted);
          _syncClientes.carregarDeRemoto(d.clientes, !!d._ts);
          _syncClientes.aplicarTombstonesRemotos(d.clientesDeleted);
          try{ if(typeof rodPopularPessoaSelect==='function') rodPopularPessoaSelect(); }catch(e){}
          
          
          
          try{ populateFornSelects(); }catch(e){}
          _syncContratos.carregarDeRemoto(d.contratos, !!d._ts);
          _syncContratos.aplicarTombstonesRemotos(d.contratosDeleted);
          _syncDocsEmpresas.carregarDeRemoto(d.docsEmpresas, !!d._ts);
          _syncDocsEmpresas.aplicarTombstonesRemotos(d.docsEmpresasDeleted);
          try{ document.dispatchEvent(new CustomEvent('erp:alert-source-changed',{detail:{source:'documentos_empresas'}})); }catch(e){}
          if(d.fiscal && typeof d.fiscal==='object' && typeof FISCAL_DB!=='undefined'){
            Object.keys(FISCAL_DB).forEach(k=>delete FISCAL_DB[k]);
            Object.assign(FISCAL_DB, d.fiscal);
            try{ localStorage.setItem('mm_fiscal',JSON.stringify(FISCAL_DB)); }catch(_){}
          }
          if(d.fiscalApur && typeof d.fiscalApur==='object' && typeof FISCAL_APUR!=='undefined'){
            Object.keys(FISCAL_APUR).forEach(k=>delete FISCAL_APUR[k]);
            Object.assign(FISCAL_APUR, d.fiscalApur);
            try{ localStorage.setItem('mm_fiscal_apur',JSON.stringify(FISCAL_APUR)); }catch(_){}
          }
        } catch(e){}
        _fbAtualizando = false;
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        const _modalAbertoAgora = document.querySelector('.modal-ov.open');
        const _campoAtivo = document.activeElement;
        const _digitandoAgora = _campoAtivo && ['INPUT','SELECT','TEXTAREA'].includes(_campoAtivo.tagName) && _campoAtivo.offsetParent!==null;
        if(!_modalAbertoAgora && !_digitandoAgora){
          try { const a=document.querySelector('.tab-panel.active'); if(a) switchTab(a.id.replace('tab-','')); } catch(e){}
          showToast('🔄 Dados atualizados por outro usuário','success',3000);
        }
      });
      }); 
    }, function(errCancel){
      
      
      
      _fbListenerAtivo = false;
      if(window.__ERP_LOGOUT_IN_PROGRESS__) return;
      console.warn('Listener erp/_ts cancelado:', errCancel && errCancel.code);
      _fbSetStatus('error');
      _fbRestaurarAuthEExecutar(fbIniciarListener,3000);
    });

    
    
    let _ticketsListenerAtivo = false;
    if(!_ticketsListenerAtivo){
      _ticketsListenerAtivo = true;
      window._fbDB.ref('erp/tickets').on('value', snap => {
        const td=snap.val()||{};
        if(typeof TICKETS_DB==='undefined') return;
        let mudou=false;
        Object.keys(td).forEach(function(tid){
          if(typeof TICKETS_DELETED!=='undefined' && TICKETS_DELETED.has && TICKETS_DELETED.has(tid)) return;
          const antes=JSON.stringify(TICKETS_DB[tid]||null);
          const depois=JSON.stringify(td[tid]||null);
          if(antes!==depois){ TICKETS_DB[tid]=Object.assign({},TICKETS_DB[tid]||{},td[tid]||{}); mudou=true; }
        });
        if(!mudou) return;
            try{
          const painel=document.getElementById('tab-balanceiro');
          const ativo=painel&&painel.classList.contains('active');
          const campo=document.activeElement;
          const digitando=campo&&['INPUT','SELECT','TEXTAREA'].includes(campo.tagName)&&campo.offsetParent!==null;
          if(ativo&&!digitando){ renderBalanceiro(); try{balRenderHistorico();}catch(e){} }
        }catch(e){}
        try{
          const rod=document.getElementById('tab-rod_balanca');
          const ativo=rod&&rod.classList.contains('active');
          const campo=document.activeElement;
          const digitando=campo&&['INPUT','SELECT','TEXTAREA'].includes(campo.tagName)&&campo.offsetParent!==null;
          if(ativo&&!digitando) renderRodBalanca();
        }catch(e){}
      });
    }

    
    
    let _fiscalListenerAtivo = false;
    if(!_fiscalListenerAtivo){
      _fiscalListenerAtivo = true;
      window._fbDB.ref('erp/fiscal').on('value', snap => {
        if(_fbAtualizando) return;
        const fd = snap.val();
        if(!fd || typeof fd!=='object') return;
        if(typeof FISCAL_DB==='undefined') return;
        
        const localStr=JSON.stringify(FISCAL_DB);
        const remoteStr=JSON.stringify(fd);
        if(localStr===remoteStr) return;
        Object.keys(FISCAL_DB).forEach(k=>delete FISCAL_DB[k]);
        Object.assign(FISCAL_DB, fd);
        try{ localStorage.setItem('mm_fiscal',JSON.stringify(FISCAL_DB)); }catch(_){}
        
        try{
          const fiscalPainel=document.getElementById('tab-fiscal');
          if(fiscalPainel&&fiscalPainel.classList.contains('active')){ fiscalCarregarMes(); }
        }catch(_){}
      });
    }

    
    
    
    
    
    
    
    let _chatListenerAtivo = false;
    let _chatPermitido = false;
    try{
      _chatPermitido = typeof window.erpCanAccessTab==='function' ? !!window.erpCanAccessTab('chat') : !!(typeof cu!=='undefined' && cu && Array.isArray(cu.tabs) && cu.tabs.includes('chat'));
    }catch(e){ _chatPermitido=false; }
    if(!_chatListenerAtivo && _chatPermitido){
      _chatListenerAtivo = true;
      window._fbDB.ref('erp/chat').on('value', snap => {
        const d = snap.val();
        if(typeof CHAT_MSGS==='undefined') return;
        const msgs = _chatMsgsFromRemote(d);
        
        if(JSON.stringify(CHAT_MSGS)===JSON.stringify(msgs)) return;
        CHAT_MSGS.length=0;
        msgs.forEach(m=>CHAT_MSGS.push(m));
        try{ localStorage.setItem('mm_chat', JSON.stringify(CHAT_MSGS)); }catch(e){}
        try{ if(typeof window.__chatReadOnMessagesChanged==='function') window.__chatReadOnMessagesChanged(); else hdrAtualizarBadge(); }catch(e){}
        try{
          const chatPainel=document.getElementById('tab-chat');
          if(chatPainel && chatPainel.classList.contains('active')) chatRenderMsgs();
        }catch(e){}
      });
    }
  }

  
  
  window.addEventListener('beforeunload', function(e){
    try{ clearTimeout(_fbTimer); _fbSalvarAgora(); }catch(e2){}
    try{
      var pend = _fbPendente || localStorage.getItem('mm_fb_pendente')==='1';
      if(pend){
        var msg='Há alterações que ainda não foram salvas na nuvem. Se sair agora, elas podem se perder.';
        e.preventDefault(); e.returnValue=msg; return msg;
      }
    }catch(e2){}
  });
