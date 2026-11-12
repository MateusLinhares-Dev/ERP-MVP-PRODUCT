(function(){
  'use strict';

  function _safe(value){
    try{ return typeof esc==='function' ? esc(String(value ?? '')) : String(value ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
    catch(e){ return ''; }
  }

  function _supplier(cod){
    try{ return (FORNECEDORES||[]).find(function(f){ return f && String(f.cod)===String(cod); }) || null; }
    catch(e){ return null; }
  }

  function _accountList(f){
    if(!f)return [];
    const api=window.ERPPartyBanks;
    const hasOfficial=!!(api&&typeof api.hasCanonical==='function'&&api.hasCanonical('fornecedor',String(f.cod||'')));
    const out=[];
    const sources=hasOfficial?[api.list('fornecedor',String(f.cod||''))]:[f.contas,f.contasBancarias,f.contas_bancarias,f.contasPix,f.dadosBancarios];
    sources.forEach(src=>{
      if(!src)return;
      const candidates=Array.isArray(src)?src:typeof src==='object'&&Object.keys(src).some(k=>['banco','bank','agencia','agency','conta','account','pix'].includes(k))?[src]:typeof src==='object'?Object.values(src):[];
      candidates.forEach(a=>{if(!a||typeof a!=='object')return;
        out.push({
          banco:String(a.bank||a.banco||'').trim(),agencia:String(a.agency||a.agencia||a.ag||'').trim(),
          conta:String(a.account||a.conta||a.numeroConta||'').trim(),pix:String(a.pix||a.chavePix||a.chave_pix||'').trim(),
          pais:String(a.country||a.pais||'BR').trim(),tipoConta:String(a.accountType||a.tipoConta||'').trim(),
          titular:String(a.holderName||a.titular||a.nomeTitular||(!hasOfficial?f.nome:'')||'').trim(),
          cpfcnpj:String(a.holderDocument||a.cpfcnpj||a.cpfCnpj||(!hasOfficial?(f.cnpj||f.cpf):'')||'').trim()
        });
      });
    });
    if(!hasOfficial&&(f.bank||f.banco||f.agencia||f.conta||f.pix))out.push({
      banco:f.banco||'',agencia:f.agencia||'',conta:f.conta||'',pix:f.pix||'',
      pais:'BR',tipoConta:'',titular:f.nome||'',cpfcnpj:f.cnpj||f.cpf||''
    });
    const seen=new Set();return out.filter(a=>{
      const key=[a.banco,a.agencia,a.conta,a.pix].map(x=>{let v=String(x||'').toLowerCase().trim().replace(/\s+/g,' ');if(v===String(a.pix||'').toLowerCase().trim()&&/^\+?[\d\s().-]+$/.test(v))v=v.replace(/\D/g,'');return v;}).join('|');
      if(seen.has(key)||!key.replace(/\|/g,''))return false;seen.add(key);return true;
    });
  }

  function _activeSuppliers(){
    try{
      var lista=(typeof getFornAtivos==='function' ? getFornAtivos() : (FORNECEDORES||[])).slice();
      return lista.filter(function(f){ return f && String(f.nome||'').trim(); })
        .sort(function(a,b){ return String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR',{sensitivity:'base'}); });
    }catch(e){ return []; }
  }

  function _populatePriceSupplierSelect(){
    var sel=document.getElementById('pf-forn-sel');
    if(!sel) return;
    var atual=sel.value;
    var lista=_activeSuppliers();
    var signature=lista.map(function(f){return String(f.cod||'')+'|'+String(f.nome||'');}).join('\u0001');
    if(sel.__fornOptionsSignature===signature && sel.options && sel.options.length===lista.length+1) return;
    sel.__fornOptionsSignature=signature;
    sel.innerHTML='<option value="">— Selecione —</option>'+lista.map(function(f){
      return '<option value="'+_safe(f.cod)+'">'+_safe(f.nome)+'</option>';
    }).join('');
    if(atual && lista.some(function(f){return String(f.cod)===String(atual);})){ sel.value=atual; }
  }
  window.populatePrecosFornSel = _populatePriceSupplierSelect;

  function _accountText(f,a,index){
    var parts=[];
    parts.push('Fornecedor: '+(f.nome||''));
    parts.push('Conta '+(index+1));
    if(a.titular) parts.push('Titular da conta: '+a.titular);
    if(a.cpfcnpj) parts.push('CPF/CNPJ do titular: '+a.cpfcnpj);
    if(a.banco) parts.push('Banco: '+a.banco);
    if(a.pais) parts.push('País: '+(a.pais==='BR'?'Brasil':a.pais==='OUTRO'?'Outro país':a.pais));
    if(a.tipoConta) parts.push('Tipo de conta: '+a.tipoConta);
    if(a.agencia) parts.push('Agência: '+a.agencia);
    if(a.conta) parts.push('Conta: '+a.conta);
    if(a.pix) parts.push('PIX: '+a.pix);
    return parts.join('\n');
  }

  function _copyText(txt){
    if(navigator.clipboard && window.isSecureContext){ return navigator.clipboard.writeText(txt); }
    return new Promise(function(resolve,reject){
      try{
        var t=document.createElement('textarea'); t.value=txt; t.style.position='fixed'; t.style.left='-9999px';
        document.body.appendChild(t); t.focus(); t.select(); document.execCommand('copy'); t.remove(); resolve();
      }catch(e){ reject(e); }
    });
  }

  window.fornPixCopiar = function(cod,index){
    var f=_supplier(cod), contas=_accountList(f), a=contas[Number(index)||0];
    if(!f||!a) return;
    _copyText(_accountText(f,a,Number(index)||0)).then(function(){
      try{ showToast('Dados bancários copiados!','success',2500); }catch(e){}
    }).catch(function(){ try{ alert('Não foi possível copiar automaticamente.'); }catch(e){} });
  };

  window.fornPixWhatsapp = function(cod,index){
    var f=_supplier(cod), contas=_accountList(f), a=contas[Number(index)||0];
    if(!f||!a) return;
    window.open('https://wa.me/?text='+encodeURIComponent(_accountText(f,a,Number(index)||0)),'_blank','noopener');
  };

  window.fornAbrirPix = function(cod){
    var f=_supplier(cod); if(!f) return;
    var contas=_accountList(f);
    var old=document.getElementById('forn-pix-ov'); if(old) old.remove();
    var ov=document.createElement('div'); ov.id='forn-pix-ov'; ov.className='modal-ov open';
    ov.style.zIndex='9600';
    var box=document.createElement('div'); box.className='modal'; box.style.maxWidth='600px';
    var cards=contas.length ? contas.map(function(a,i){
      var rotulo=a.banco ? ('Conta '+(i+1)+' — '+_safe(a.banco)) : ('Conta '+(i+1));
      return '<div style="border:1px solid #cfe3d6;background:#f6fbf8;border-radius:10px;padding:12px 14px;margin-top:10px">'+
        '<div style="font-weight:900;color:#176b35;font-size:.95rem;margin-bottom:6px">'+rotulo+'</div>'+
        '<div style="font-size:.82rem;line-height:1.65;color:#333">'+
          (a.titular?'<b>Titular:</b> '+_safe(a.titular)+'<br>':'')+
          (a.cpfcnpj?'<b>CPF/CNPJ do titular:</b> '+_safe(a.cpfcnpj)+' &nbsp;·&nbsp; ':'')+
          (a.banco?'<b>Banco:</b> '+_safe(a.banco)+' &nbsp;·&nbsp; ':'')+
          (a.pais?'<b>País:</b> '+_safe(a.pais==='BR'?'Brasil':a.pais==='OUTRO'?'Outro país':a.pais)+' &nbsp;·&nbsp; ':'')+
          (a.tipoConta?'<b>Tipo:</b> '+_safe(a.tipoConta)+' &nbsp;·&nbsp; ':'')+
          (a.agencia?'<b>Ag:</b> '+_safe(a.agencia)+' &nbsp;·&nbsp; ':'')+
          (a.conta?'<b>Conta:</b> '+_safe(a.conta):'')+
          (a.pix?'<br><b>PIX:</b> <span style="color:#159447;font-weight:800">'+_safe(a.pix)+'</span>':'')+
        '</div><div style="display:flex;gap:8px;margin-top:9px">'+
          '<button type="button" onclick="fornPixCopiar(\''+_safe(cod)+'\','+i+')" style="background:#198754;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-weight:800;cursor:pointer">📋 Copiar</button>'+
          '<button type="button" onclick="fornPixWhatsapp(\''+_safe(cod)+'\','+i+')" style="background:#25d366;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-weight:800;cursor:pointer">🟢 WhatsApp</button>'+
        '</div></div>';
    }).join('') : '<div style="padding:18px 4px;color:#777">Nenhuma conta bancária ou chave PIX cadastrada para este fornecedor.</div>';
    box.innerHTML='<h3 style="margin-bottom:8px">💳 Contas / PIX — '+_safe(f.nome||'')+'</h3>'+ 
      '<div style="font-size:.82rem;color:#6b7280">'+contas.length+' conta(s) cadastrada(s). Use Copiar ou WhatsApp para enviar os dados de pagamento.</div>'+cards+
      '<div class="modal-ft"><button class="btn-cancel" type="button" id="forn-pix-close">Fechar</button></div>';
    ov.appendChild(box); document.body.appendChild(ov);
    document.getElementById('forn-pix-close').onclick=function(){ ov.remove(); };
    ov.addEventListener('click',function(ev){ if(ev.target===ov) ov.remove(); });
  };

  window.fornContas=function(cod){ return _accountList(_supplier(cod)); };
  window.fornAtualizarSeletorPrecos=function(){ _populatePriceSupplierSelect(); };

  var _populateOriginal=window.populateFornSelects;
  if(typeof _populateOriginal==='function'){
    window.populateFornSelects=function(){
      var result=_populateOriginal.apply(this,arguments);
      _populatePriceSupplierSelect();
      return result;
    };
  }

  var _priceRenderOriginal=window.renderPrecosFornTab;
  if(typeof _priceRenderOriginal==='function'){
    window.renderPrecosFornTab=function(){
      _populatePriceSupplierSelect();
      return _priceRenderOriginal.apply(this,arguments);
    };
  }

  document.addEventListener('erp:ready',function(){
    try{ _populatePriceSupplierSelect(); }catch(e){}
    setTimeout(function(){ try{ _populatePriceSupplierSelect(); }catch(e){} },750);
  });
})();
