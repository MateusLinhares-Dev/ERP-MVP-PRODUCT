(function(){
  'use strict';

  function currentProfile(){
    try{ return (typeof cu!=='undefined' && cu) ? cu : null; }catch(e){ return null; }
  }

  var OWNER_ONLY_TABS=new Set(['usuarios','suporte_tecnico','senhas']);

  function isElaineOwner(){
    try{
      var profile=currentProfile();
      return String(typeof cuKey!=='undefined'?cuKey:'').trim().toLowerCase()==='elaine' && !!(profile&&profile.admin===true);
    }catch(e){ return false; }
  }

  function canAccessTab(tab){
    tab=String(tab||'').trim();
    if(!tab) return false;
    
    if(tab==='avisos') return true;

    if(OWNER_ONLY_TABS.has(tab) && !isElaineOwner()) return false;
    var profile=currentProfile();
    if(!profile || !Array.isArray(profile.tabs)) return false;
    return profile.tabs.includes(tab);
  }

  function tabExists(tab){
    return !!document.getElementById('tab-'+String(tab||''));
  }

  var legacySwitch = (typeof switchTab==='function') ? switchTab : window.switchTab;

  window.erpCanAccessTab=canAccessTab;
  window.erpTabExists=tabExists;
  window.erpIsElaineOwner=isElaineOwner;
  window.ERP_OWNER_ONLY_TABS=OWNER_ONLY_TABS;

  window.switchTab=function(tid){
    tid=String(tid||'').trim();
   
    if(!tabExists(tid)){
      console.warn('[ERP] Módulo inexistente ignorado:',tid);
      try{ showToast('Módulo não encontrado.','error'); }catch(e){}
      return false;
    }
    if(!canAccessTab(tid)){
      console.warn('[ERP] Acesso negado ao módulo:',tid);
      try{ showToast('Você não tem acesso a este módulo.','error'); }catch(e){}
      return false;
    }

    if(typeof legacySwitch!=='function') return false;
    legacySwitch(tid);
    return true;
  };
})();
