(function(){
  if(window._avisosInstalado) return; window._avisosInstalado=true;

  function _hasTab(tab){
    try{
      if(typeof window.erpCanAccessTab==='function') return !!window.erpCanAccessTab(tab);
      if(typeof cu==='undefined' || !cu) return false;
      return Array.isArray(cu.tabs) && cu.tabs.includes(tab);
    }catch(e){ return false; }
  }
  function _canAfazeres(){ return _hasTab('afazeres'); }
  function _canRH(){ return _hasTab('funcionarios'); }
  function _canVales(){ return _hasTab('vales') || _canRH(); }

  function _fA(){
    try{ return (typeof FUNCIONARIOS!=='undefined'?FUNCIONARIOS:[]).filter(function(f){ return f && String(f.status||'Ativo').toLowerCase()!=='inativo' && !f.dataRescisao; }); }catch(e){ return []; }
  }
  function _hojeD(){ var d=new Date(); return {y:d.getFullYear(), m:d.getMonth()+1, d:d.getDate()}; }
  function _parseNasc(s){ if(!s) return null; var p=String(s).split('-'); if(p.length!==3) return null; return {y:+p[0], m:+p[1], d:+p[2]}; }
  function _parseVenc(s){ if(!s) return null; var p=String(s).split('/'); if(p.length!==3) return null; return new Date(+p[2], (+p[1])-1, +p[0]); }
  function _fmtBR(v){ try{ return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2}); }catch(e){ return v; } }
  function _diasEntre(a,b){ return Math.round((b - a)/86400000); }

  function _aniversariantes(){
    var h=_hojeD(); var hoje=[], mes=[];
    _fA().forEach(function(f){
      var n=_parseNasc(f.nascimento); if(!n) return;
      if(n.m===h.m){
        var reg={nome:f.nome, dia:n.d, idade:(h.y-n.y)};
        mes.push(reg);
        if(n.d===h.d) hoje.push(reg);
      }
    });
    mes.sort(function(a,b){ return a.dia-b.dia; });
    return {hoje:hoje, mes:mes};
  }

  function _fimExperiencia(){
    var h=_hojeD(); var out=[]; var hojeZero=new Date(h.y,h.m-1,h.d);
    _fA().forEach(function(f){
      [['fimExperiencia1','1º período · 45d'],['fimExperiencia','fim · 90d']].forEach(function(par){
        var val=f[par[0]]; if(!val) return;
        var p=String(val).split('-'); if(p.length!==3) return;
        var fim=new Date(+p[0],(+p[1])-1,+p[2]);
        var dias=_diasEntre(hojeZero, fim);
        if(dias>=-3 && dias<=30) out.push({nome:f.nome, dias:dias, data:(+p[2])+'/'+p[1]+'/'+p[0], etapa:par[1]});
      });
    });
    out.sort(function(a,b){ return a.dias-b.dias; });
    return out;
  }

  function _contasVencendo(){
    var cp = (typeof CONTAS_PAGAR!=='undefined'?CONTAS_PAGAR:[]) || [];
    var h=_hojeD(); var hojeZero=new Date(h.y,h.m-1,h.d);
    var venc=[], atras=[];
    cp.forEach(function(c){
      if(!c || String(c.status||'').toLowerCase()==='pago') return;
      var d=_parseVenc(c.venc); if(!d) return;
      var dias=_diasEntre(hojeZero, d);
      var reg={desc:c.desc||'(sem descrição)', cred:c.cred||'', cat:c.cat||'', valor:Number(c.valor||0), venc:c.venc, dias:dias};
      if(dias<0) atras.push(reg);
      else if(dias<=15) venc.push(reg);
    });
    atras.sort(function(a,b){ return a.dias-b.dias; });
    venc.sort(function(a,b){ return a.dias-b.dias; });
    return {atras:atras, venc:venc};
  }

  function _agHojeISO(){ var d=new Date(),z=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate()); }
  function _agDataISO(a){
    if(a&&a.data) return a.data;
    var c=(a&&a.criadoEm)||''; var m=c.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m?(m[3]+'-'+m[2]+'-'+m[1]):'';
  }
  function _agDiffDias(aISO,bISO){ var pa=aISO.split('-'),pb=bISO.split('-'); var da=new Date(+pa[0],+pa[1]-1,+pa[2]),db=new Date(+pb[0],+pb[1]-1,+pb[2]); return Math.round((db-da)/86400000); }
  function _agBR(iso){ var m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?(m[3]+'/'+m[2]+'/'+m[1]):(iso||''); }
  function _agendaServicos(){
    var arr=(typeof AFAZERES_DB!=='undefined'?AFAZERES_DB:[])||[];
    var hojeISO=_agHojeISO(); var atras=[],hoje=[],prox=[];
    arr.forEach(function(a){
      if(!a||a.feito) return;
      var iso=_agDataISO(a); if(!iso) return;
      if(iso<hojeISO) atras.push({texto:a.texto||'(sem descrição)', data:iso, dias:_agDiffDias(hojeISO,iso)});
      else if(iso===hojeISO) hoje.push({texto:a.texto||'(sem descrição)', data:iso});
      else { var diff=_agDiffDias(hojeISO,iso); if(diff<=7) prox.push({texto:a.texto||'(sem descrição)', data:iso, dias:diff}); }
    });
    atras.sort(function(x,y){ return x.data<y.data?-1:1; });
    prox.sort(function(x,y){ return x.data<y.data?-1:1; });
    return {atras:atras, hoje:hoje, prox:prox};
  }

  function avisosContar(){
    try{
      var a=_aniversariantes(), e=_fimExperiencia(), ag=_agendaServicos(), total=0;
      if(_canRH()) total+=a.hoje.length+e.length;
      if(_canAfazeres()) total+=ag.hoje.length+ag.atras.length;
      return total;
    }catch(err){ return 0; }
  }

  window.avisosAtualizarBadge=function(){
    try{
      var el=document.querySelector('.nav-tab[data-tab="avisos"] .nt-label'); if(!el) return;
      var n=avisosContar();
      el.innerHTML = 'Avisos' + (n>0 ? ' <span style="background:#c0392b;color:#fff;border-radius:10px;padding:0 7px;font-size:.7rem;font-weight:800;margin-left:4px">'+n+'</span>' : '');
    }catch(e){}
  };

  window.renderAvisos=function(){
    var box=document.getElementById('tab-avisos'); if(!box) return;
    var a=_aniversariantes(), exp=_fimExperiencia();
    var vtList=_fA().filter(function(f){ return Number(f.valeTransporte||0)>0; });

    function card(t,c){ return '<div style="background:#fff;border-radius:12px;box-shadow:0 2px 10px #0001;padding:16px 18px;margin-bottom:16px">'+t+c+'</div>'; }
    var html='<div style="max-width:900px;margin:0 auto;padding:6px 2px">';
    html+='<h2 style="margin:6px 0 14px;color:#1f3864">🔔 Avisos</h2>';

    if(_canAfazeres()){
      var ag=_agendaServicos();
      var agBody='';
      if(ag.atras.length){ agBody+='<div style="background:#fdecea;border:1px solid #e6a49a;border-radius:9px;padding:10px 12px;margin-bottom:10px"><div style="font-weight:800;color:#a5281b;margin-bottom:4px">⚠️ Atrasados ('+ag.atras.length+')</div>'+ag.atras.map(function(x){ var d=Math.abs(x.dias); return '<div style="padding:3px 0;font-size:.9rem;color:#7a1d13">• <b>'+esc(x.texto)+'</b> — era pra '+_agBR(x.data)+' (há '+d+' dia'+(d>1?'s':'')+')</div>'; }).join('')+'</div>'; }
      if(ag.hoje.length){ agBody+='<div style="background:#fff8e1;border:1px solid #f0c36d;border-radius:9px;padding:10px 12px;margin-bottom:10px"><div style="font-weight:800;color:#8a6d00;margin-bottom:4px">📌 Hoje ('+ag.hoje.length+')</div>'+ag.hoje.map(function(x){ return '<div style="padding:3px 0;font-size:.9rem;color:#6b5900">• <b>'+esc(x.texto)+'</b></div>'; }).join('')+'</div>'; }
      if(ag.prox.length){ agBody+='<div style="font-size:.9rem">'+ag.prox.map(function(x){ return '<div style="padding:4px 0;border-bottom:1px solid #f0f0f0">🗓️ <b>'+esc(x.texto)+'</b> — '+_agBR(x.data)+' (em '+x.dias+' dia'+(x.dias>1?'s':'')+')</div>'; }).join('')+'</div>'; }
      if(!ag.atras.length && !ag.hoje.length && !ag.prox.length){ agBody+='<div style="color:#888;font-size:.88rem">Nenhum serviço pendente pra hoje nem pros próximos 7 dias. Você lança na aba <b>Meus Afazeres</b>.</div>'; }
      html+=card('<h3 style="margin:0 0 10px;color:#1f6feb">📋 Meus serviços (agenda)</h3>', agBody);
    }

    if(_canRH()){
      var anivBody='';
      if(a.hoje.length){ anivBody+='<div style="background:#fff8e1;border:1px solid #f0c36d;border-radius:9px;padding:10px 12px;margin-bottom:10px;font-weight:700">🎉 Hoje: '+a.hoje.map(function(x){ return x.nome+' ('+x.idade+' anos)'; }).join(', ')+'</div>'; }
      if(a.mes.length){ anivBody+='<div style="font-size:.9rem">'+a.mes.map(function(x){ return '<div style="padding:4px 0;border-bottom:1px solid #f0f0f0">🎂 dia '+String(x.dia).padStart(2,'0')+' — <b>'+x.nome+'</b> ('+x.idade+' anos)</div>'; }).join('')+'</div>'; }
      else { anivBody+='<div style="color:#888;font-size:.88rem">Nenhum aniversário neste mês (ou datas ainda não cadastradas).</div>'; }
      html+=card('<h3 style="margin:0 0 10px;color:#e67e22">🎂 Aniversários do mês</h3>', anivBody);

      var expBody='';
      if(exp.length){ expBody='<div style="font-size:.9rem">'+exp.map(function(x){ var t=x.dias<0?('venceu há '+Math.abs(x.dias)+' dia(s)'):x.dias===0?'vence HOJE':('faltam '+x.dias+' dia(s)'); var et=x.etapa?' <span style="color:#8e44ad;font-size:.78rem;font-weight:700">('+x.etapa+')</span>':''; return '<div style="padding:4px 0;border-bottom:1px solid #f0f0f0">⏳ <b>'+x.nome+'</b>'+et+' — '+x.data+' ('+t+')</div>'; }).join('')+'</div>'; }
      else { expBody='<div style="color:#888;font-size:.88rem">Nenhum fim de experiência nos próximos 30 dias.</div>'; }
      html+=card('<h3 style="margin:0 0 10px;color:#8e44ad">⏳ Fim de experiência</h3>', expBody);
    }

    if(_canVales()){
      var vtBody='';
      if(vtList.length){ vtBody+='<div style="font-size:.9rem">'+vtList.map(function(f){ return '<div style="padding:4px 0;border-bottom:1px solid #f0f0f0">🚌 <b>'+f.nome+'</b> — R$ '+_fmtBR(f.valeTransporte)+'/mês</div>'; }).join('')+'</div>'; }
      else { vtBody+='<div style="color:#888;font-size:.88rem">Nenhum vale-transporte cadastrado.</div>'; }
      html+=card('<h3 style="margin:0 0 10px;color:#1f6b34">🚌 Vale-transporte</h3>', vtBody);
    }

    html+='</div>';
    box.innerHTML=html;
    try{ avisosAtualizarBadge(); }catch(e){}
  };

  window.vtQuickModal=function(){
    var body=document.getElementById('modal-body'); if(!body) return;
    var ativos=(typeof FUNCIONARIOS!=='undefined'?FUNCIONARIOS:[]).map(function(f,i){ return {f:f,i:i}; }).filter(function(o){ return o.f && String(o.f.status||'Ativo').toLowerCase()!=='inativo' && !o.f.dataRescisao; });
    var opts=ativos.map(function(o){ return '<option value="'+o.i+'">'+o.f.nome+(Number(o.f.valeTransporte||0)>0?(' (atual: R$ '+_fmtBR(o.f.valeTransporte)+')'):'')+'</option>'; }).join('');
    var mesAtual=new Date().toISOString().slice(0,7);
    body.innerHTML=''+
      '<h2 style="margin:0 0 14px;color:#1f6b34">🚌 Vale-transporte</h2>'+
      '<div style="font-size:.85rem;color:#666;margin-bottom:12px">Grava o valor mensal no funcionário (RH) e cria as contas no Contas a Pagar. Não mexe em nada que já existe.</div>'+
      '<div class="fg"><label>Funcionário</label><select id="vtq-func">'+opts+'</select></div>'+
      '<div class="fg"><label>Valor mensal R$</label><input id="vtq-valor" type="number" min="0" step="0.01" placeholder="0,00"></div>'+
      '<div class="fg"><label>Dia do vencimento (1 a 31)</label><input id="vtq-dia" type="number" min="1" max="31" value="5"></div>'+
      '<div class="fg"><label>Gerar contas por quantos meses?</label><input id="vtq-meses" type="number" min="1" max="24" value="12"></div>'+
      '<div class="fg"><label>A partir do mês</label><input id="vtq-mes" type="month" value="'+mesAtual+'"></div>'+
      '<div style="display:flex;gap:8px;margin-top:14px">'+
        '<button onclick="cm()" style="flex:1;background:#eee;color:#333;border:none;border-radius:8px;padding:12px;font-weight:700;cursor:pointer">Cancelar</button>'+
        '<button onclick="vtQuickSalvar()" style="flex:2;background:#1f6b34;color:#fff;border:none;border-radius:8px;padding:12px;font-weight:800;cursor:pointer">Salvar</button>'+
      '</div>';
    document.getElementById('modal-ov').classList.add('open');
  };

  window.vtQuickSalvar=function(){
    try{
      var idx=parseInt(document.getElementById('vtq-func').value);
      var f=FUNCIONARIOS[idx]; if(!f){ alert('Selecione o funcionário.'); return; }
      var valor=parseFloat(document.getElementById('vtq-valor').value)||0;
      if(valor<=0){ alert('Coloque o valor do vale.'); return; }
      var dia=parseInt(document.getElementById('vtq-dia').value)||5; if(dia<1)dia=1; if(dia>31)dia=31;
      var meses=parseInt(document.getElementById('vtq-meses').value)||1; if(meses<1)meses=1; if(meses>24)meses=24;
      var mesVal=document.getElementById('vtq-mes').value; var pm=String(mesVal).split('-'); var anoI=+pm[0], mesI=+pm[1];
      if(!anoI||!mesI){ alert('Escolha o mês inicial.'); return; }

      f.valeTransporte=valor; f._upd=Date.now();
      try{ localStorage.setItem('mm_funcionarios_edit', JSON.stringify(FUNCIONARIOS)); }catch(e){}

      var hoje=new Date().toISOString().slice(0,10).split('-').reverse().join('/');
      var grupoId='vt_'+Date.now();
      var criadas=0;
      for(var i=0;i<meses;i++){
        var m=mesI+i; var a=anoI+Math.floor((m-1)/12); m=((m-1)%12)+1;
        var diaVenc=Math.min(dia, new Date(a,m,0).getDate());
        var vencFmt=String(diaVenc).padStart(2,'0')+'/'+String(m).padStart(2,'0')+'/'+a;
        CONTAS_PAGAR.push({ id:_novoIdCP(), lancto:hoje, desc:'Vale-transporte – '+f.nome, cred:f.nome, cat:'Vale Transporte', bancoCod:'', bancoNome:'', tipoForn:'despesa', empresa:f.empresa||'', venc:vencFmt, valor:valor, grupoId:grupoId, totalParcelas:meses, status:'Pendente', dataPgto:'', obs:'Lançado pelo botão de Vale-transporte' });
        criadas++;
      }
      try{ saveContasPagar(); }catch(e){}
      try{ fbSalvar(); }catch(e){}
      try{ renderContasPagar(); }catch(e){}
      try{ renderTbFuncionarios(); }catch(e){}
      try{ renderDashboard(); }catch(e){}
      try{ cm(); }catch(e){}
      try{ renderAvisos(); }catch(e){}
      var msg='✅ Vale-transporte de R$ '+_fmtBR(valor)+' salvo para '+f.nome+' e '+criadas+' conta(s) criada(s) no Contas a Pagar.';
      try{ showToast(msg,'success'); }catch(e){ alert(msg); }
    }catch(err){ alert('Erro: '+(err&&err.message||err)); }
  };
})();
