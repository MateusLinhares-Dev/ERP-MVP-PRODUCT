(function(){
  'use strict';
  var state={seen:{},stopped:{}};
  var listenerRef=null;
  var listenerUid='';
  var readyPromise=null;
  var recheckTimer=null;

  function currentUid(){
    try{ return firebase.auth().currentUser && firebase.auth().currentUser.uid || ''; }catch(e){ return ''; }
  }
  function currentLogin(){
    try{ return typeof cuKey!=='undefined' ? String(cuKey||'') : ''; }catch(e){ return ''; }
  }
  function hasTab(tab){
    try{
      if(typeof window.erpCanAccessTab==='function') return !!window.erpCanAccessTab(tab);
      if(typeof cu==='undefined' || !cu) return false;
      return Array.isArray(cu.tabs) && cu.tabs.includes(tab);
    }catch(e){ return false; }
  }
  function allowedAlert(a){
    if(!a) return false;
    if(a.sourceTab) return hasTab(String(a.sourceTab));
    if(a.mat) return hasTab('funcionarios');
    if(String(a.key||'').startsWith('doc|')) return hasTab('documentos_empresas');
    return false;
  }
  function keyPart(value){
    var s=String(value||'');
    try{
      var bytes=new TextEncoder().encode(s), out='';
      bytes.forEach(function(b){ out+=b.toString(16).padStart(2,'0'); });
      return out||'00';
    }catch(e){
      var out2=''; for(var i=0;i<s.length;i++) out2+=s.charCodeAt(i).toString(16).padStart(4,'0');
      return out2||'00';
    }
  }
  function seenDate(key){
    var v=state.seen && state.seen[keyPart(key)];
    return v && typeof v==='object' ? String(v.date||'') : String(v||'');
  }
  function stopped(key){
    return !!(state.stopped && state.stopped[keyPart(key)]);
  }
  function ensureState(){
    var uid=currentUid();
    if(!uid || !window._fbDB) return Promise.resolve(false);
    if(listenerRef && listenerUid===uid && readyPromise) return readyPromise;
    if(listenerRef){ try{ listenerRef.off('value'); }catch(e){} }
    listenerUid=uid;
    state={seen:{},stopped:{}};
    listenerRef=window._fbDB.ref('erp/alertState/'+uid);
    readyPromise=new Promise(function(resolve){
      var first=true;
      listenerRef.on('value',function(snap){
        var v=(snap&&snap.val&&snap.val())||{};
        state={seen:v.seen||{},stopped:v.stopped||{}};
        if(first){ first=false; resolve(true); }
      },function(err){
        console.warn('alertState RTDB:',err);
        if(first){ first=false; resolve(false); }
      });
    });

    try{ localStorage.removeItem('mm_alertas_vistos'); localStorage.removeItem('mm_alertas_parados'); }catch(e){}
    return readyPromise;
  }

  function filteredAlerts(){
    var all=[];
    try{ all=typeof _coletarAlertas==='function' ? _coletarAlertas() : []; }catch(e){ all=[]; }
    return (all||[]).filter(allowedAlert);
  }

  function stopUi(key,btn){
    ensureState().then(function(){
      var uid=currentUid(), k=keyPart(key), rec={key:String(key||''),date:(typeof _hojeISO==='function'?_hojeISO():new Date().toISOString().slice(0,10)),login:currentLogin(),updatedAt:new Date().toISOString()};
      state.stopped[k]=rec;
      if(uid&&window._fbDB){
        window._fbDB.ref('erp/alertState/'+uid+'/stopped/'+k).set(rec).catch(function(e){ console.warn('alert stop RTDB:',e); });
      }
    });
    try{ if(window._alertasAtuais) window._alertasAtuais=window._alertasAtuais.filter(function(a){return a.key!==key;}); }catch(e){}
    try{
      var card=btn&&btn.closest?btn.closest('.alerta-card'):null;
      if(card&&card.parentNode) card.parentNode.removeChild(card);
      var host=document.querySelector('.alerta-ov .alerta-lista');
      if(host&&!host.querySelector('.alerta-card')) document.querySelectorAll('.alerta-ov').forEach(function(e){e.remove();});
    }catch(e){}
    try{ showToast('Não vou mais avisar sobre esse item para este usuário.','info'); }catch(e){}
  }

  function markSeen(){
    return ensureState().then(function(){
      var uid=currentUid(); if(!uid||!window._fbDB) return false;
      var hoje=typeof _hojeISO==='function'?_hojeISO():new Date().toISOString().slice(0,10);
      var patch={};
      (window._alertasAtuais||[]).forEach(function(a){
        if(!allowedAlert(a)) return;
        var k=keyPart(a.key), rec={key:String(a.key||''),date:hoje,login:currentLogin(),updatedAt:new Date().toISOString()};
        state.seen[k]=rec; patch[k]=rec;
      });
      if(!Object.keys(patch).length) return true;
      return window._fbDB.ref('erp/alertState/'+uid+'/seen').update(patch).then(function(){return true;}).catch(function(e){ console.warn('alert seen RTDB:',e); return false; });
    });
  }

  function renderAlerts(forcar){
    if(!forcar && document.querySelector('.alerta-ov.open')) return;
    var todos=filteredAlerts(), mostrar, hoje=typeof _hojeISO==='function'?_hojeISO():new Date().toISOString().slice(0,10);
    if(forcar){
      mostrar=todos.filter(function(a){return a.dias!=null&&a.dias<=60;}).filter(function(a){return !stopped(a.key);}).sort(function(x,y){return x.dias-y.dias;});
    }else{
      mostrar=todos.filter(function(a){return typeof _alertaVencendo==='function'&&_alertaVencendo(a);}).filter(function(a){return seenDate(a.key)!==hoje;}).filter(function(a){return !stopped(a.key);}).sort(function(x,y){return x.dias-y.dias;});
    }
    if(!mostrar.length){ if(forcar) try{showToast('Nenhum alerta permitido para este usuário nos próximos 60 dias. 👍','info');}catch(e){} return; }
    document.querySelectorAll('.alerta-ov').forEach(function(e){e.remove();});
    var ov=document.createElement('div'); ov.className='modal-ov alerta-ov open'; ov.dataset.dynamic='1'; ov.style.zIndex='100000';
    var body=document.createElement('div'); body.className='modal'; body.style.maxWidth='560px';
    var linhas=mostrar.map(function(a){
      var cor,txt;
      if(a.dias<0){ cor='#c0392b'; txt='venceu há '+Math.abs(a.dias)+' dia(s)'; }
      else if(a.dias===0){ cor='#c0392b'; txt='é HOJE'; }
      else { cor=a.dias<=3?'#e67e22':'#1a5e2a'; txt='em '+a.dias+' dia(s)'; }
      var dataBR=String(a.data||'').split('-').reverse().join('/');
      return '<div class="alerta-card" style="border-left:5px solid '+cor+';background:#fafafa;border-radius:8px;padding:10px 12px;margin-bottom:8px">'+
        '<div style="font-weight:800">'+esc(a.nome)+'</div>'+
        '<div style="font-size:.88rem;color:#333">'+esc(a.tipo)+' — <b>'+dataBR+'</b> <span style="color:'+cor+';font-weight:800">('+txt+')</span></div>'+
        '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">'+
        (a.mat&&hasTab('funcionarios')?'<button onclick="cm();editFuncionario(&#39;'+a.mat+'&#39;)" style="background:#eef4f0;color:#1a5e2a;border:1.5px solid #cfe3d6;border-radius:7px;padding:5px 10px;font-weight:700;cursor:pointer;font-size:.8rem">✏️ Abrir funcionário</button>':'')+
        '<button onclick="_alertaPararUi(&#39;'+esc(a.key).replace(/&#39;/g,"\\&#39;")+'&#39;, this)" title="Não avisar mais sobre este item para este usuário" style="background:#fff3f3;color:#c0392b;border:1.5px solid #f0c4c0;border-radius:7px;padding:5px 10px;font-weight:700;cursor:pointer;font-size:.8rem">🔕 Parar de avisar</button>'+
        '</div></div>';
    }).join('');
    body.innerHTML='<h3 style="color:#b45309">🔔 Alertas'+(forcar?' (próximos 60 dias)':' de hoje')+'</h3>'+
      '<div class="alerta-lista" style="max-height:52vh;overflow:auto;margin:10px 0">'+linhas+'</div>'+
      '<div class="modal-ft">'+(forcar?'':'<button class="btn-cancel" onclick="_alertasMarcarVistos();cm()">Ok, já vi (não mostrar hoje)</button>')+
      '<button class="btn-save" onclick="cm()">Fechar</button></div>';
    ov.appendChild(body); document.body.appendChild(ov); window._alertasAtuais=mostrar;
  }

  function scheduleRecheck(delay){
    if(recheckTimer) clearTimeout(recheckTimer);
    recheckTimer=setTimeout(function(){
      recheckTimer=null;
      if(!currentUid() || !currentLogin()) return;
      ensureState().then(function(){ renderAlerts(false); });
    }, delay==null?450:delay);
  }

  document.addEventListener('erp:alert-source-changed',function(){ scheduleRecheck(350); });
  document.addEventListener('erp:user-started',function(){ scheduleRecheck(900); });

  function resetForLogout(){
    if(recheckTimer){ clearTimeout(recheckTimer); recheckTimer=null; }
    if(listenerRef){ try{ listenerRef.off('value'); }catch(e){} }
    listenerRef=null; listenerUid=''; readyPromise=null; state={seen:{},stopped:{}};
    try{ window._alertasAtuais=[]; }catch(e){}
    try{ document.querySelectorAll('.alerta-ov').forEach(function(el){ el.remove(); }); }catch(e){}
  }
  window.__alertStateResetForLogout=resetForLogout;

  try{
    firebase.auth().onAuthStateChanged(function(user){
      if(!user){ resetForLogout(); return; }
      if(listenerUid && listenerUid!==user.uid) resetForLogout();
    });
  }catch(e){}

  window._alertasVistos=function(){
    var out={}; Object.values(state.seen||{}).forEach(function(v){ if(v&&v.key) out[v.key]=v.date||''; }); return out;
  };
  window._alertasParados=function(){
    var out={}; Object.values(state.stopped||{}).forEach(function(v){ if(v&&v.key) out[v.key]=v.date||true; }); return out;
  };
  window._alertaPararUi=stopUi;
  window._alertasMarcarVistos=markSeen;
  window.checarAlertas=function(forcar){ ensureState().then(function(){ renderAlerts(!!forcar); }); };
  window.__alertStateDebug=function(){ return {uid:listenerUid,login:currentLogin(),state:JSON.parse(JSON.stringify(state)),allowed:filteredAlerts()}; };
})();
