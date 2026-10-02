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
    if(!f) return [];
    var out=[];
    var candidates=[f.contas, f.contasBancarias, f.contas_bancarias, f.contasPix, f.dadosBancarios];
    candidates.forEach(function(src){
      if(!src) return;
      var arr=[];
      if(Array.isArray(src)) arr=src;
      else if(typeof src==='object'){
        var looksLikeAccount=['banco','bank','agencia','agency','conta','account','pix','chavePix','chave_pix'].some(function(k){ return src[k]!=null; });
        arr=looksLikeAccount?[src]:Object.values(src);
      }
      arr.forEach(function(a){
        if(!a || typeof a!=='object') return;
        out.push({
          banco:a.banco||a.bank||a.codigoBanco||a.codigo_banco||'',
          agencia:a.agencia||a.ag||a.agency||'',
          conta:a.conta||a.numeroConta||a.numero_conta||a.account||'',
          pix:a.pix||a.chavePix||a.chave_pix||a.chave||'',
          cpfcnpj:a.cpfcnpj||a.cpfCnpj||a.documento||a.cpf||a.cnpj||f.cnpj||f.cpf||'',
          titular:a.titular||a.nomeTitular||a.nome_titular||f.nome||''
        });
      });
    });

    if(f.pix || f.banco || f.agencia || f.conta){
      out.push({
        banco:f.banco||'', agencia:f.agencia||'', conta:f.conta||'', pix:f.pix||'',
        cpfcnpj:f.cnpj||f.cpf||'', titular:f.nome||''
      });
    }

    var seen=new Set();
    return out.filter(function(a){
      var key=[a.banco,a.agencia,a.conta,a.pix,a.cpfcnpj].map(function(v){return String(v||'').trim().toLowerCase();}).join('|');
      if(key==='||||' || seen.has(key)) return false;
      seen.add(key); return true;
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
    if(a.cpfcnpj) parts.push('CPF/CNPJ: '+a.cpfcnpj);
    if(a.banco) parts.push('Banco: '+a.banco);
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
          (a.cpfcnpj?'<b>CPF/CNPJ:</b> '+_safe(a.cpfcnpj)+' &nbsp;·&nbsp; ':'')+
          (a.banco?'<b>Banco:</b> '+_safe(a.banco)+' &nbsp;·&nbsp; ':'')+
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

  window.renderTabelaFornecedores = function(){
    try{ if(typeof _syncFornecedores!=='undefined' && _syncFornecedores.limparDuplicatasExatas()){ try{fbSalvar();}catch(e){} } }catch(e){}
    var tb=document.getElementById('tb-fornecedores'); if(!tb) return;
    var isElaine=(typeof cu!=='undefined' && cu && cu.admin===true);
    var lista=(typeof _getFornFiltrados==='function')?_getFornFiltrados():_activeSuppliers();
    tb.innerHTML=lista.map(function(f){
      var c=_safe(f.cod), contas=_accountList(f), pixLabel='💳 PIX'+(contas.length>1?' ('+contas.length+')':'');
      var r='<tr onclick="fornSelLinha(this)" style="cursor:pointer" title="Clique pra marcar esta linha">';
      r+='<td style="text-align:center">'+(isElaine?'<input type="checkbox" class="forn-chk" value="'+c+'" onchange="atualizarBtnExcluir()">':'')+'</td>';
      r+='<td>'+c+'</td>';
      r+='<td><b>'+_safe(f.nome||'')+'</b></td>';
      r+='<td>'+_safe(f.cnpj||f.cpf||'—')+'</td>';
      r+='<td>'+_safe(f.cidade||'—')+'</td>';
      r+='<td style="white-space:nowrap">';
      r+='<button data-ficha-cod="'+c+'" onclick="event.stopPropagation()" style="padding:4px 10px;font-size:.78rem;background:#2980b9;color:#fff;border:none;border-radius:5px;cursor:pointer;margin-right:4px">📋 Ficha</button>';
      if(contas.length){ r+='<button type="button" onclick="event.stopPropagation();fornAbrirPix(\''+c+'\')" style="padding:4px 10px;font-size:.78rem;background:#159447;color:#fff;border:none;border-radius:5px;cursor:pointer;margin-right:4px;font-weight:800">'+pixLabel+'</button>'; }
      r+='<button class="btn-edit" onclick="event.stopPropagation();editFornecedor(\''+c+'\')">✏️</button>';
      r+=' <button class="btn-edit" onclick="event.stopPropagation();fornDocsModal(\''+c+'\')" title="Documentos" style="background:#0277bd;color:#fff">📄 Docs</button>';
      if(isElaine) r+=' <button class="btn-edit-danger" onclick="event.stopPropagation();excluirFornecedor(\''+c+'\')" title="Excluir">🗑️</button>';
      r+='</td></tr>'; return r;
    }).join('');
    _populatePriceSupplierSelect();
  };

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
    try{ window.renderTabelaFornecedores(); }catch(e){}
    try{ _populatePriceSupplierSelect(); }catch(e){}
    setTimeout(function(){ try{ _populatePriceSupplierSelect(); }catch(e){} },750);
  });
})();
