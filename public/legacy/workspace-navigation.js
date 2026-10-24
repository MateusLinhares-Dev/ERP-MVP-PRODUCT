/* Busca global de módulos existentes. Somente abas exibidas pela ACL da aplicação. */
(function () {
  'use strict';
  const $=(selector,root=document)=>root.querySelector(selector);
  let active=false, previousFocus=null, selected=0, results=[];
  const normalize=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function modules(){
    return Array.from(document.querySelectorAll('#nav-bar .nav-tab[data-tab]'))
      .filter(item=>item.getClientRects().length || item.closest('.sb-group'))
      .map(item=>({tab:item.dataset.tab,name:$('.nt-label',item)?.textContent?.trim()||item.dataset.tab}))
      .filter(item=>item.tab);
  }
  function create(){
    if($('#erp-module-dialog'))return;
    const overlay=document.createElement('div');overlay.id='erp-module-dialog';
    overlay.className='erp-command-overlay';overlay.hidden=true;
    overlay.setAttribute('role','presentation');
    overlay.innerHTML='<section role="dialog" aria-modal="true" aria-label="Ir para módulo" class="erp-command-panel">'+
      '<div class="erp-command-search"><input type="search" id="erp-module-search" placeholder="Buscar módulo" aria-label="Buscar módulo" autocomplete="off" spellcheck="false">'+
      '<button type="button" id="erp-module-close" aria-label="Fechar busca de módulos">Fechar</button></div>'+
      '<div id="erp-module-options" class="erp-command-results" role="listbox" aria-label="Módulos disponíveis"></div>'+ 
      '<footer class="erp-command-help">Use as setas para navegar e Enter para abrir.</footer></section>';
    document.body.append(overlay);
    $('#erp-module-close',overlay).addEventListener('click',close);
    overlay.addEventListener('pointerdown',event=>{if(event.target===overlay)close();});
    $('#erp-module-search',overlay).addEventListener('input',()=>{selected=0;render();});
    $('#erp-module-search',overlay).addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();selected=(selected+(event.key==='ArrowDown'?1:-1)+results.length)%Math.max(1,results.length);render();
      }else if(event.key==='Enter'&&results[selected]){event.preventDefault();openTab(results[selected].tab);}
    });
  }
  function render(){
    const parent=$('#erp-module-options');if(!parent)return;
    const query=normalize($('#erp-module-search').value);
    results=modules().filter(item=>!query||normalize(item.name).includes(query));
    selected=Math.max(0,Math.min(selected,results.length-1));
    parent.textContent='';
    if(!results.length){const empty=document.createElement('p');empty.textContent='Nenhum módulo encontrado.';empty.className='erp-command-empty';parent.append(empty);return;}
    results.forEach((item,index)=>{
      const button=document.createElement('button');button.type='button';button.className='erp-command-option';
      button.setAttribute('role','option');button.setAttribute('aria-selected',String(index===selected));
      button.textContent=item.name;
      button.addEventListener('click',()=>openTab(item.tab));
      parent.append(button);
    });
  }
  function openTab(tab){
    const nav=Array.from(document.querySelectorAll('#nav-bar .nav-tab[data-tab]')).find(item=>item.dataset.tab===tab);
    if(!nav)return;
    const group=nav.closest('.sb-group');if(group)group.classList.add('open');
    close();nav.click();
  }
  function open(){
    create();const overlay=$('#erp-module-dialog');
    previousFocus=document.activeElement;active=true;overlay.hidden=false;
    $('#erp-module-search').value='';selected=0;render();$('#erp-module-search').focus();
  }
  function close(){
    const overlay=$('#erp-module-dialog');if(overlay)overlay.hidden=true;
    active=false;if(previousFocus?.isConnected)previousFocus.focus();
  }
  function init(){
    if($('#erp-module-trigger')||!$('#nav-bar'))return;
    const button=document.createElement('button');button.id='erp-module-trigger';button.type='button';
    button.className='erp-module-trigger';button.title='Buscar módulo (Ctrl+K)';
    button.setAttribute('aria-label','Buscar módulo');
    button.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><span>Buscar módulo</span><kbd>Ctrl K</kbd>';
    button.addEventListener('click',open);
    $('#nav-bar').insertBefore(button,$('#nav-bar').firstChild);
  }
  document.addEventListener('erp:user-started',()=>queueMicrotask(init));
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
      if($('#app-screen')?.style.display==='none')return;
      event.preventDefault();active?close():open();
    }else if(active&&event.key==='Escape'){event.preventDefault();close();}
  });
  document.addEventListener('erp:ready',init);
})();
