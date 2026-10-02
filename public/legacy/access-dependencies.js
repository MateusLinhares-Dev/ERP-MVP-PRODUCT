(function(){
  'use strict';
  var MAP={
    dashboard:{related:['compra_sucata','vendas','contas_pagar','contas_receber','estoque'],note:'Consolida indicadores de compras, vendas, financeiro e estoque.'},
    compra_sucata:{requires:['fornecedores'],related:['estoque','precos_fornecedores','adiantamentos','contas_pagar','canhoto_compra','balanceiro'],note:'A compra precisa identificar fornecedor; preços, estoque, financeiro e pesagem complementam o fluxo.'},
    agenda_entregas:{related:['fornecedores','clientes','rod_balanca'],note:'Agenda pode referenciar entregas/retiradas de fornecedores e clientes.'},
    rod_balanca:{related:['fornecedores','clientes','balanceiro','estoque','agenda_entregas'],note:'A Rodoviária usa cadastros e tickets compartilhados, mas operadores podem trabalhar sem enxergar essas telas.'},
    balanceiro:{related:['rod_balanca','compra_sucata','estoque','fornecedores'],note:'O Balanceiro trabalha sobre tickets e materiais originados de outros fluxos.'},
    estoque:{related:['compra_sucata','vendas','precos_fornecedores','precos_clientes'],note:'Saldo e catálogo de materiais alimentam compras, vendas e tabelas de preços.'},
    fornecedores:{related:['compra_sucata','precos_fornecedores','adiantamentos','contas_pagar','canhoto_compra','documentos_empresas'],note:'Cadastro-base usado por compras e rotinas financeiras.'},
    precos_fornecedores:{related:['fornecedores','estoque','compra_sucata'],note:'Usa fornecedores e materiais; compras atualizam os últimos preços.'},

    vendas:{requires:['clientes'],related:['estoque','precos_clientes','contas_receber','fluxo_caixa'],note:'Venda exige cliente; estoque, preços e contas a receber completam o ciclo comercial.'},
    clientes:{related:['vendas','precos_clientes','contas_receber','fin_clientes','documentos_empresas'],note:'Cadastro-base do comercial e financeiro de clientes.'},
    precos_clientes:{related:['clientes','estoque','vendas'],note:'Usa clientes e materiais; serve como referência para vendas.'},

    contas_pagar:{related:['fornecedores','despesas_grupo','contas_banco','fluxo_caixa','compra_sucata'],note:'Recebe obrigações de compras/despesas e alimenta caixa.'},
    contas_receber:{requires:['clientes'],related:['vendas','contas_banco','fluxo_caixa','fin_clientes'],note:'Contas a receber são vinculadas a clientes e normalmente nascem de vendas.'},
    adiantamentos:{related:['fornecedores','contas_banco','fin_clientes','fluxo_caixa'],note:'Adiantamentos usam cadastros de terceiros e afetam caixa/fichas.'},
    cheques:{related:['fornecedores','clientes','contas_banco','fin_clientes','cheques_compensar'],note:'Base de cheques usada por fornecedores/clientes e controle financeiro.'},
    cheques_compensar:{related:['cheques','contas_banco','fornecedores'],note:'Controle de compensação trabalha sobre cheques e contas bancárias.'},
    fin_clientes:{requires:['clientes','adiantamentos','cheques'],related:['contas_receber','vendas'],note:'Ficha do Cliente reúne cadastro, adiantamentos, cheques e movimentações.'},
    contas_banco:{related:['contas_pagar','contas_receber','adiantamentos','cheques','fluxo_caixa','combustivel_rudnick'],note:'Contas bancárias são referência para lançamentos financeiros.'},
    fluxo_caixa:{requires:['contas_pagar','contas_receber','adiantamentos'],related:['vendas','contas_banco','folha_pagamento'],note:'Fluxo consolida entradas e saídas vindas dos módulos financeiros.'},

    funcionarios:{related:['ponto','folha_pagamento','vales','epi','coordenacao','viagem_motorista','almoxarifado'],note:'Cadastro de funcionários é consumido por RH, coordenação e frota.'},
    ponto:{related:['funcionarios','folha_pagamento'],note:'Ponto usa funcionários e pode apoiar o fechamento da folha.'},
    folha_pagamento:{requires:['funcionarios','vales'],related:['ponto','contas_pagar','fluxo_caixa','viagem_motorista'],note:'Folha usa funcionários e vales; ponto complementa o fechamento e o financeiro recebe os totais.'},
    vales:{related:['funcionarios','folha_pagamento'],note:'Vales são lançados por funcionário e descontados/consultados na folha.'},
    epi:{related:['funcionarios','almoxarifado','coordenacao'],note:'EPI identifica funcionário e se relaciona ao controle de itens/coordenação.'},

    caminhoes:{related:['combustivel_rudnick','viagem_motorista','rod_balanca'],note:'Cadastro de frota é referência para combustível e viagens.'},
    combustivel_rudnick:{requires:['caminhoes'],related:['contas_banco','contas_pagar','viagem_motorista'],note:'Abastecimentos precisam de veículo; custos podem refletir no financeiro.'},
    viagem_motorista:{requires:['caminhoes','funcionarios'],related:['combustivel_rudnick','contas_pagar','folha_pagamento'],note:'Viagem precisa de motorista e veículo e consolida despesas relacionadas.'},

    fiscal:{related:['compra_sucata','vendas','contas_pagar','contas_receber'],note:'Fiscal consolida documentos e operações, mas o perfil fiscal pode ser isolado das telas operacionais.'},

    despesas_grupo:{related:['contas_pagar','contas_banco','fluxo_caixa'],note:'Despesas do grupo podem gerar/explicar saídas financeiras.'},
    contratos:{related:['documentos_empresas','fornecedores','clientes'],note:'Contratos se relacionam a empresas/terceiros e seus documentos.'},
    custo_casa:{related:['contas_banco','contas_pagar'],note:'Custos pessoais podem compartilhar referências financeiras, sem dependência obrigatória.'},
    lista_compras:{related:['almoxarifado'],note:'Lista de compras pode apoiar reposição, mas funciona de forma independente.'},
    documentos_empresas:{related:['fornecedores','clientes','contratos'],note:'Centraliza documentos de empresas/terceiros e vencimentos.'},
    config:{related:['estoque'],note:'Configuração exibe dados institucionais e catálogo de materiais.'},
    usuarios:{ownerOnly:true,note:'Gestão de usuários é exclusiva da Elaine/administradora principal.'},
    suporte_tecnico:{ownerOnly:true,note:'Ferramentas de reparo/backup são exclusivas da Elaine.'},
    senhas:{ownerOnly:true,note:'Cofre de senhas exige claim administrativa; somente Elaine.'},

    almoxarifado:{related:['funcionarios','epi','coordenacao','lista_compras'],note:'Movimentações podem ser atribuídas a funcionários e consultadas pela Coordenação.'},
    coordenacao:{requires:['almoxarifado'],related:['funcionarios','epi'],note:'Coordenação integra reuniões/advertências com histórico de retiradas do Almoxarifado.'},

    chat:{note:'Módulo independente; mensagens e leitura têm controle próprio por usuário/conversa.'},
    afazeres:{related:['avisos'],note:'Afazeres vencidos/pendentes alimentam Avisos quando o usuário tem acesso.'},
    avisos:{automatic:true,note:'Aba automática. Consolida somente alertas de módulos aos quais o usuário tem acesso.'},
    canhoto_compra:{requires:['compra_sucata','fornecedores'],note:'Canhoto trabalha com fornecedores e tickets de compra.'}
  };

  var OWNER_ONLY=new Set(Object.keys(MAP).filter(function(k){return MAP[k].ownerOnly;}));
  var _editLogin='';

  function cfg(tab){
    try{ return (typeof TABS_CFG!=='undefined'&&TABS_CFG[tab])||null; }catch(e){ return null; }
  }
  function label(tab){ var c=cfg(tab); return c?((c.icon||'')+' '+(c.label||tab)).trim():tab; }
  function currentIsOwner(){
    try{ return typeof window.erpIsElaineOwner==='function' ? window.erpIsElaineOwner() : (String(cuKey||'').toLowerCase()==='elaine'&&!!(cu&&cu.admin)); }catch(e){ return false; }
  }
  function targetIsOwner(login){
    login=String(login||'').trim().toLowerCase();
    try{ return login==='elaine' && !!(USERS&&USERS[login]&&USERS[login].admin===true); }catch(e){ return false; }
  }
  function selectedChecks(){ return Array.prototype.slice.call(document.querySelectorAll('#modal-body input[type=checkbox][value]')); }
  function selectedTabs(){ return selectedChecks().filter(function(c){return c.checked&&!c.disabled;}).map(function(c){return c.value;}); }
  function allCheckedTabs(){ return selectedChecks().filter(function(c){return c.checked;}).map(function(c){return c.value;}); }

  function evaluate(tabs,opt){
    opt=opt||{};
    var set=new Set((tabs||[]).map(String));
    var missing=[]; var related=[]; var ownerInvalid=[];
    set.forEach(function(tab){
      var m=MAP[tab]||{};
      (m.requires||[]).forEach(function(dep){ if(!set.has(dep)) missing.push({tab:tab,dep:dep}); });
      (m.related||[]).forEach(function(dep){ if(!set.has(dep)) related.push({tab:tab,dep:dep}); });
      if(m.ownerOnly && !opt.targetOwner) ownerInvalid.push(tab);
    });
    return {missing:missing,related:related,ownerInvalid:ownerInvalid};
  }

  function depText(pair){ return label(pair.tab)+' → '+label(pair.dep); }

  function ensurePanel(){
    var body=document.getElementById('modal-body'); if(!body) return null;
    var panel=document.getElementById('erp-access-deps');
    if(panel) return panel;
    var boxes=body.querySelectorAll('input[type=checkbox][value]');
    if(!boxes.length) return null;
    var grid=boxes[0].closest('div[style*="grid-template-columns"]') || boxes[0].parentElement?.parentElement;
    if(!grid) return null;
    panel=document.createElement('div'); panel.id='erp-access-deps';
    panel.style.cssText='margin:0 0 12px;padding:10px 12px;border:1.5px solid #90caf9;border-radius:8px;background:#f5faff;font-size:.78rem;color:#244;';
    panel.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">'+
      '<b>🔗 Dependências dos módulos</b><button type="button" id="erp-deps-fix" style="display:none;background:#1565c0;color:#fff;border:none;border-radius:6px;padding:5px 9px;font-size:.72rem;font-weight:700;cursor:pointer">Adicionar necessárias</button></div>'+
      '<div id="erp-deps-content" style="margin-top:6px"></div>';
    grid.parentNode.insertBefore(panel,grid);
    panel.querySelector('#erp-deps-fix').onclick=function(){
      var tabs=new Set(allCheckedTabs());
      var ev=evaluate(Array.from(tabs),{targetOwner:targetIsOwner(_editLogin)});
      ev.missing.forEach(function(x){
        var c=body.querySelector('input[type=checkbox][value="'+CSS.escape(x.dep)+'"]');
        if(c&&!c.disabled){ c.checked=true; try{c.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){} }
      });
      renderPanel();
    };
    return panel;
  }

  function decorateCheckboxes(){
    var owner=targetIsOwner(_editLogin);
    selectedChecks().forEach(function(c){
      var tab=c.value; var m=MAP[tab]||{}; var l=c.closest('label');
      if(l){
        l.dataset.erpTab=tab;
        var old=l.querySelector('.erp-dep-badge'); if(old) old.remove();
        if(m.ownerOnly){
          var sp=document.createElement('span'); sp.className='erp-dep-badge'; sp.textContent='🔒 Elaine'; sp.style.cssText='margin-left:auto;font-size:.65rem;color:#8a6d00;background:#fff3cd;border-radius:9px;padding:1px 6px'; l.appendChild(sp);
        }else if((m.requires||[]).length){
          var sr=document.createElement('span'); sr.className='erp-dep-badge'; sr.textContent='🔗 depende'; sr.style.cssText='margin-left:auto;font-size:.65rem;color:#0d47a1;background:#e3f2fd;border-radius:9px;padding:1px 6px'; l.appendChild(sr);
        }
        if(m.note) l.title=m.note;
      }
      if(m.automatic){ c.checked=false; c.disabled=true; if(l) l.style.opacity='.65'; }
      if(m.ownerOnly){
        if(owner){ c.checked=true; c.disabled=true; }
        else { c.checked=false; c.disabled=true; if(l) l.style.opacity='.6'; }
      }
      if(!c.dataset.erpDepsBound){ c.dataset.erpDepsBound='1'; c.addEventListener('change',renderPanel); }
    });
  }

  function renderPanel(){
    var panel=ensurePanel(); if(!panel) return;
    var content=panel.querySelector('#erp-deps-content'); var fix=panel.querySelector('#erp-deps-fix');
    var tabs=allCheckedTabs(); var owner=targetIsOwner(_editLogin); var ev=evaluate(tabs,{targetOwner:owner});
    var html=[];
    if(ev.ownerInvalid.length){
      html.push('<div style="color:#b71c1c;font-weight:700;margin-bottom:4px">🔒 Exclusivo Elaine: '+ev.ownerInvalid.map(label).join(', ')+'</div>');
    }
    if(ev.missing.length){
      html.push('<div style="color:#b71c1c;font-weight:700">⚠️ Faltam dependências obrigatórias:</div><ul style="margin:3px 0 5px 18px;padding:0">'+ev.missing.map(function(x){return '<li>'+depText(x)+'</li>';}).join('')+'</ul>');
      if(fix) fix.style.display='inline-block';
    }else{
      html.push('<div style="color:#2e7d32;font-weight:700">✅ Dependências obrigatórias atendidas.</div>');
      if(fix) fix.style.display='none';
    }
    var uniq=[]; var seen=new Set();
    ev.related.forEach(function(x){ var k=x.tab+'>'+x.dep; if(!seen.has(k)){seen.add(k);uniq.push(x);} });
    if(uniq.length){
      html.push('<details style="margin-top:5px"><summary style="cursor:pointer;color:#8a6d00;font-weight:700">ℹ️ Relações recomendadas ('+uniq.length+')</summary><div style="margin-top:4px;color:#665">'+uniq.slice(0,30).map(function(x){return '<div>• '+depText(x)+'</div>';}).join('')+(uniq.length>30?'<div>… e mais '+(uniq.length-30)+'</div>':'')+'</div></details>');
    }
    html.push('<div style="margin-top:6px;color:#667;font-size:.7rem">Obrigatória = sem a tela relacionada o fluxo fica incompleto. Recomendada = compartilha dados, mas não amplia acesso automaticamente.</div>');
    content.innerHTML=html.join('');
  }

  function validateSelection(targetOwner){
    var tabs=allCheckedTabs(); var ev=evaluate(tabs,{targetOwner:targetOwner});
    if(ev.ownerInvalid.length){
      alert('Acesso exclusivo da Elaine: '+ev.ownerInvalid.map(label).join(', ')+'.\n\nEssas áreas não podem ser concedidas a outro usuário.'); return false;
    }
    if(ev.missing.length){
      var lines=ev.missing.map(function(x){return '• '+depText(x);}).join('\n');
      alert('Existem módulos com dependências obrigatórias faltando:\n\n'+lines+'\n\nMarque também os módulos indicados ou use “Adicionar necessárias”.'); return false;
    }
    return true;
  }

  function afterOpen(login){
    _editLogin=String(login||'').toLowerCase();
    setTimeout(function(){ decorateCheckboxes(); ensurePanel(); renderPanel(); },0);
  }

  var originalNovo=window.novoUsuario;
  if(typeof originalNovo==='function') window.novoUsuario=function(){ var r=originalNovo.apply(this,arguments); afterOpen(''); return r; };

  var originalEdit=window.editUsuario;
  if(typeof originalEdit==='function') window.editUsuario=function(un){ var r=originalEdit.apply(this,arguments); afterOpen(un); return r; };

  var originalSaveNew=window.salvarNovoUsuario;
  if(typeof originalSaveNew==='function') window.salvarNovoUsuario=async function(){
    if(!currentIsOwner()){ alert('Apenas a Elaine pode criar usuários.'); return; }
    if(!validateSelection(false)) return;
    return originalSaveNew.apply(this,arguments);
  };

  var originalSaveEdit=window.salvarEditUsuario;
  if(typeof originalSaveEdit==='function') window.salvarEditUsuario=async function(un){
    if(!currentIsOwner()){ alert('Apenas a Elaine pode alterar acessos de usuários.'); return; }
    if(!validateSelection(targetIsOwner(un))) return;
    return originalSaveEdit.apply(this,arguments);
  };

  var originalDelete=window.excluirUsuario;
  if(typeof originalDelete==='function') window.excluirUsuario=async function(un){
    if(!currentIsOwner()){ alert('Apenas a Elaine pode excluir usuários.'); return; }
    return originalDelete.apply(this,arguments);
  };

  var originalPassword=window.mudarSenha;
  if(typeof originalPassword==='function') window.mudarSenha=function(un){
    if(!currentIsOwner()){ alert('Apenas a Elaine pode redefinir senhas de outros usuários.'); return; }
    return originalPassword.apply(this,arguments);
  };

  window.ERP_MODULE_ACCESS_MAP=MAP;
  window.erpEvaluateModuleAccess=evaluate;
  window.erpValidateModuleAccess=function(tabs,targetLogin){ return evaluate(tabs,{targetOwner:targetIsOwner(targetLogin)}); };
})();
