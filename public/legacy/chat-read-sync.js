(function(){
  'use strict';

  var readState={};
  var listenerRef=null;
  var listenerUid='';
  var migratedForUid={};

  function currentUid(){
    try{ return firebase.auth().currentUser && firebase.auth().currentUser.uid || ''; }catch(e){ return ''; }
  }
  function currentLogin(){ try{ return typeof cuKey!=='undefined' ? String(cuKey||'') : ''; }catch(e){ return ''; } }
  function currentName(){ try{ return (typeof cu!=='undefined'&&cu&&cu.name) ? String(cu.name) : ''; }catch(e){ return ''; } }

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
  function convKey(conv){ return keyPart(conv||'geral'); }
  function normConv(msg){ return msg && msg.conv ? String(msg.conv) : 'geral'; }

  function convForUser(name){
    return 'dm_'+[currentName(),String(name||'')].sort().join('__');
  }
  function visibleConvs(){
    var out=new Set(['geral']);
    try{
      Object.entries(USERS||{}).forEach(function(entry){
        var u=entry[1]; if(!u||!u.name||String(u.name)===currentName()) return;
        out.add(convForUser(u.name));
      });
    }catch(e){}
    return out;
  }
  function messageSource(){
    try{
      if(Array.isArray(window.__CHAT_RECENT_MESSAGES__) && window.__CHAT_RECENT_MESSAGES__.length) return window.__CHAT_RECENT_MESSAGES__;
    }catch(e){}
    try{ return CHAT_MSGS||[]; }catch(e){ return []; }
  }

  function readTs(conv){
    var v=readState[convKey(conv)];
    var ts=v && typeof v==='object' ? v.ts : v;
    return ts ? Date.parse(ts)||0 : 0;
  }
  function unreadCount(conv){
    var last=readTs(conv), me=currentName();
    try{
      return messageSource().filter(function(m){
        if(!m || normConv(m)!==conv || !m.ts) return false;
        if(me && String(m.autor||'')===me) return false;
        return (Date.parse(m.ts)||0)>last;
      }).length;
    }catch(e){ return 0; }
  }
  function totalUnread(){
    var total=0, vis=visibleConvs();
    vis.forEach(function(c){ total+=unreadCount(c); });
    return total;
  }
  function latestConversationTs(conv){
    var max=0;
    try{ messageSource().forEach(function(m){ if(m&&normConv(m)===conv&&m.ts) max=Math.max(max,Date.parse(m.ts)||0); }); }catch(e){}
    return max;
  }

  function updateHeader(){
    ensureListener();
    var badge=document.getElementById('hdr-chat-badge');
    if(!badge) return;
    var n=totalUnread();
    if(n>0){ badge.textContent=n>99?'99+':String(n); badge.style.display='block'; }
    else badge.style.display='none';
  }

  function badgeHtml(n){
    return n>0 ? '<span style="margin-left:auto;background:#c0392b;color:#fff;min-width:19px;height:19px;border-radius:10px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;font-size:.67rem;font-weight:900">'+(n>99?'99+':n)+'</span>' : '';
  }

  function renderConversations(){
    ensureListener();
    var el=document.getElementById('chat-conv-list'); if(!el) return;
    var active=(typeof _chatConvAtiva!=='undefined' ? _chatConvAtiva : null);
    var html='<div onclick="chatAbrirConv(\'geral\')" style="padding:11px 14px;cursor:pointer;border-bottom:1px solid #eee;background:'+(active==='geral'?'#e8f5e9':'#fff')+';font-size:.83rem;display:flex;gap:8px;align-items:center">'
      +'<span style="font-size:1.1rem">💬</span><div><div style="font-weight:700;color:#1a3a2a">Geral</div><div style="font-size:.7rem;color:#888">Todos os usuários</div></div>'+badgeHtml(unreadCount('geral'))+'</div>';
    try{
      Object.entries(USERS||{}).forEach(function(entry){
        var u=entry[1]; if(!u||!u.name||String(u.name)===currentName()) return;
        var conv=convForUser(u.name), ativo=active===conv, ini=String(u.name||'?')[0].toUpperCase();
        html+='<div onclick="chatAbrirConv(\''+String(conv).replace(/'/g,"\\'")+'\',\''+String(u.name).replace(/'/g,"\\'")+'\')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #eee;background:'+(ativo?'#e8f5e9':'#fff')+';font-size:.83rem;display:flex;gap:8px;align-items:center">'
          +'<div style="width:30px;height:30px;border-radius:50%;background:#1a3a2a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.78rem;flex-shrink:0">'+ini+'</div>'
          +'<div style="overflow:hidden"><div style="font-weight:700;color:#1a3a2a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(u.name)+'</div><div style="font-size:.68rem;color:#888">'+esc(u.role||'')+'</div></div>'
          +badgeHtml(unreadCount(conv))+'</div>';
      });
    }catch(e){}
    el.innerHTML=html;
    if(!active){ chatAbrirConv('geral','Geral'); }
  }

  function markRead(conv){
    conv=conv||'geral';
    ensureListener();
    var uid=currentUid(); if(!uid||!window._fbDB) return Promise.resolve(false);
    var nowIso=new Date().toISOString();
    var latest=latestConversationTs(conv);
    var ts=latest ? new Date(Math.max(latest,Date.now())).toISOString() : nowIso;
    var k=convKey(conv);
    if(readTs(conv)>=Date.parse(ts)) return Promise.resolve(true);
    readState[k]={conv:conv,ts:ts};
    updateHeader();
    try{ if(document.getElementById('chat-conv-list')) renderConversations(); }catch(e){}
    return window._fbDB.ref('erp/chatRead/'+uid+'/'+k).set({conv:conv,ts:ts,login:currentLogin()})
      .then(function(){ return true; }).catch(function(e){ console.warn('chat read RTDB:',e); return false; });
  }

  function migrateLegacy(uid, ref){
    if(migratedForUid[uid]) return;
    migratedForUid[uid]=true;
    var old='';
    try{ old=localStorage.getItem('mm_chat_lido_'+currentLogin())||''; }catch(e){}
    if(!old || Object.keys(readState).length) return;
    var patch={}; visibleConvs().forEach(function(conv){ patch[convKey(conv)]={conv:conv,ts:old,login:currentLogin()}; });
    if(!Object.keys(patch).length) return;
    ref.update(patch).then(function(){ try{ localStorage.removeItem('mm_chat_lido_'+currentLogin()); }catch(e){} }).catch(function(){});
  }

  function ensureListener(){
    var uid=currentUid();
    if(!uid||!window._fbDB) return false;
    if(listenerRef && listenerUid===uid) return true;
    if(listenerRef){ try{ listenerRef.off('value'); }catch(e){} }
    listenerUid=uid; readState={};
    listenerRef=window._fbDB.ref('erp/chatRead/'+uid);
    listenerRef.on('value',function(snap){
      readState=(snap&&snap.val&&snap.val())||{};
      migrateLegacy(uid,listenerRef);
      try{ updateHeader(); }catch(e){}
      try{ if(document.getElementById('chat-conv-list')) renderConversations(); }catch(e){}
    });
    return true;
  }

  window.hdrAtualizarBadge=updateHeader;
  window.chatRenderConvs=renderConversations;

  window.hdrAbrirChat=function(){
    try{ switchTab('chat'); }catch(e){}
    setTimeout(function(){
      try{ _chatAjustarAltura(); }catch(e){}
      try{ renderConversations(); }catch(e){}

      try{ if(!_chatConvAtiva) chatAbrirConv('geral','Geral'); else markRead(_chatConvAtiva); }catch(e){}
    },100);
  };

  var legacyOpen=window.chatAbrirConv;
  window.chatAbrirConv=function(conv,nome){
    if(typeof legacyOpen==='function') legacyOpen(conv,nome);
    markRead(conv||'geral');
  };

  window.chatInit=function(){
    ensureListener();
    try{ _chatAjustarAltura(); }catch(e){}
    try{ renderConversations(); }catch(e){}
    try{
      if(_chatConvAtiva && typeof window.__chatOpenConversationRealtime==='function') window.__chatOpenConversationRealtime(_chatConvAtiva,60);
      else chatRenderMsgs();
    }catch(e){}
    try{ if(_chatConvAtiva) markRead(_chatConvAtiva); }catch(e){}
  };
  window.chatDestroy=function(){
    try{ if(typeof window.__chatCloseConversationRealtime==='function') window.__chatCloseConversationRealtime(); }catch(e){}
  };

  window.__chatReadOnMessagesChanged=function(){
    try{
      updateHeader();
      var panel=document.getElementById('tab-chat');
      if(panel&&panel.classList.contains('active')&&_chatConvAtiva) markRead(_chatConvAtiva);
      else if(document.getElementById('chat-conv-list')) renderConversations();
    }catch(e){}
  };
  window.__chatReadDebug=function(){ return {uid:listenerUid,state:JSON.parse(JSON.stringify(readState)),total:totalUnread()}; };
})();
