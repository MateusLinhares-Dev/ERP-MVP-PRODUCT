(function(global){
  'use strict';
  function formatBusinessText(message){
    return String(message==null?'':message)
      .normalize('NFC')
      .replace(/\r\n?/g,'\n')
      .replace(/[\uFE0E\uFE0F\u200D\u20E3]/g,'')
      .replace(/\p{Extended_Pictographic}/gu,'')
      .replace(/[━═]{4,}/g,'--------------------------------')
      .replace(/^[ \t]*[▸•][ \t]*/gm,'- ')
      .replace(/[ \t]+\n/g,'\n')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  }
  global.erpWhatsFormat=formatBusinessText;

  const MODE_KEY='erp_whatsapp_modo';
  function whatsappMode(){
    try{ return global.localStorage.getItem(MODE_KEY)==='web'?'web':'app'; }catch(error){ return 'app'; }
  }
  function setWhatsappMode(mode){
    try{ global.localStorage.setItem(MODE_KEY,mode==='web'?'web':'app'); }catch(error){}
    try{ global.document.dispatchEvent(new CustomEvent('erp:whatsapp-mode',{detail:{mode:whatsappMode()}})); }catch(error){}
    return whatsappMode();
  }
  function webUrlFor(url){
    let parsed;
    try{ parsed=new URL(String(url)); }catch(error){ return ''; }
    const host=parsed.hostname.toLowerCase();
    let phone='';
    if(host==='wa.me') phone=parsed.pathname.replace(/\D/g,'');
    else if(host==='api.whatsapp.com'&&/^\/send/.test(parsed.pathname)) phone=String(parsed.searchParams.get('phone')||'').replace(/\D/g,'');
    else return '';
    const text=parsed.searchParams.get('text')||'';
    const params=[];
    if(phone) params.push('phone='+phone);
    if(text) params.push('text='+encodeURIComponent(text));
    return 'https://web.whatsapp.com/send'+(params.length?'?'+params.join('&'):'');
  }
  const nativeOpen=global.open;
  global.open=function(url){
    if(typeof url==='string'&&whatsappMode()==='web'){
      const web=webUrlFor(url);
      if(web) return nativeOpen.call(global,web,'erp_whatsapp_web');
    }
    return nativeOpen.apply(global,arguments);
  };
  global.erpWhatsappMode=whatsappMode;
  global.erpSetWhatsappMode=setWhatsappMode;
  global.erpWhatsappWebUrl=webUrlFor;
})(window);
