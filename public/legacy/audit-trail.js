(function(){
  'use strict';

  function clean(value,max){
    return String(value==null?'':value).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max||160);
  }

  function actor(){
    try{
      var raw=window.__fbRaw||{};
      var user=raw.auth&&raw.auth.currentUser;
      if(!user) return null;
      var login='';
      try{ login=sessionStorage.getItem('mm_sessao')||''; }catch(_e){}
      return {uid:clean(user.uid,128),login:clean(login,80)};
    }catch(_){ return null; }
  }

  function serverTimestamp(){
    try{
      if(window.firebase&&window.firebase.database&&window.firebase.database.ServerValue){
        return window.firebase.database.ServerValue.TIMESTAMP;
      }
    }catch(_e){}
    return Date.now();
  }

  window.erpAudit=function(action,module,details){
    try{
      var a=actor();
      var raw=window.__fbRaw||{};
      if(!a||!raw.db) return Promise.resolve(false);
      details=details||{};
      var event={
        actorUid:a.uid,
        actorLogin:a.login,
        action:clean(action,64),
        module:clean(module,64),
        entityType:clean(details.entityType||'',64),
        entityId:clean(details.entityId||'',128),
        scope:clean(details.scope||'',240),
        source:'browser',
        ts:serverTimestamp()
      };
      return raw.db.ref('erpAudit').push(event).then(function(){return true;}).catch(function(err){
        console.warn('audit trail:',err&&err.code?err.code:'write failed');
        return false;
      });
    }catch(_e){ return Promise.resolve(false); }
  };
})();
