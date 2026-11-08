(function(global){
'use strict';
const alertUser=(message,type='error')=>{if(typeof global.showToast==='function')global.showToast(message,type,6500);else global.alert(message);};
  const deleting = new Set();
  // O backend serializa a coleção financeira por fornecedor. O navegador
  // precisa respeitar a mesma ordem: duas exclusões clicadas em sequência
  // não devem disputar o lock e disparar 409 desnecessariamente.
  const deletionQueues = new Map();
  const scheduledDeletes = new Set();
  function queueAdvanceDeletion(supplierCode,advanceCode,button){
    const supplier=String(supplierCode),key=supplier+'::'+String(advanceCode);
    if(scheduledDeletes.has(key))return Promise.resolve(false);
    scheduledDeletes.add(key);
    const previous=deletionQueues.get(supplier)||Promise.resolve(true);
    const operation=previous.catch(()=>false).then(ok=>ok===false?false:deleteAdvance(supplier,advanceCode,button));
    deletionQueues.set(supplier,operation);
    operation.finally(()=>{
      scheduledDeletes.delete(key);
      if(deletionQueues.get(supplier)===operation)deletionQueues.delete(supplier);
    }).catch(()=>{});
    return operation;
  }
  function candidatesForAdvance(advanceCode, supplierName) {
    if (typeof ADT_POR_FORN === 'undefined') return [];
    const result = [];
    for (const [supplierCode, advances] of Object.entries(ADT_POR_FORN || {})) {
      const advance = (advances || []).find(a => String(a?.cod) === String(advanceCode));
      if (advance) {
        const supplier = (typeof FORNECEDORES !== 'undefined' ? FORNECEDORES : []).find(f => String(f.cod) === supplierCode) || (global.__ERP_ADVANCE_SUPPLIER_OPTIONS__ || []).find(f => String(f.cod) === supplierCode);
        result.push({supplierCode, advance, supplierName: String(supplier?.nome || supplierCode)});
      }
    }
    if (!supplierName) return result;
    const normalized = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const named = result.filter(x => normalized(x.supplierName) === normalized(supplierName));
    return named.length ? named : result;
  }

  // Conferência do negócio: o usuário financeiro decide com base no extrato
  // REAL. O ERP não presume se houve PIX e jamais cria transferência externa.
  function el(parent,tag,text,css){
    const node=global.document.createElement(tag);
    if(text!=null)node.textContent=text;
    if(css)node.style.cssText=css;
    parent.appendChild(node);
    return node;
  }
  const brl=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  function businessReviewDialog(preview,request,supplierCode,advanceCode){
    return new Promise(resolve=>{
      const overlay=el(global.document.body,'div',null,
        'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:18px');
      const modal=el(overlay,'section',null,
        'background:white;color:#1f352b;width:min(100%,550px);max-height:92vh;overflow:auto;border-radius:12px;padding:22px;box-sizing:border-box;box-shadow:0 16px 48px #0005');
      modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
      modal.setAttribute('aria-label','Conferir adiantamento');
      el(modal,'h2','Conferir pagamento do adiantamento','margin:0 0 8px;font-size:20px');
      el(modal,'p','O adiantamento está cadastrado, mas não encontramos o lançamento correspondente no extrato do ERP. Vamos conferir o que aconteceu.','line-height:1.5');
      const box=el(modal,'div',null,'background:#f3f7f4;padding:12px;border-radius:8px;margin-bottom:14px');
      el(box,'strong',brl(preview.amount)+' — '+(preview.supplierName||'Fornecedor'));
      el(box,'p','Conta: '+(preview.bankName||'não identificada')+' | Data: '+(preview.date||'não informada'),
        'margin:6px 0 0;font-size:13px');
      el(modal,'p','1. Abra o extrato real dessa conta (aplicativo do banco ou comprovante). Confira a data, o valor e o favorecido. Não use apenas o extrato do ERP.','line-height:1.5');
      const label=el(modal,'label','2. O que aconteceu com esse pagamento?','display:block;font-weight:650;margin-bottom:6px');
      const choice=el(label,'select',null,'display:block;width:100%;padding:10px;margin-top:8px;border:1px solid #9eafa5;border-radius:7px');
      for(const [v,t] of [['','Selecione uma situação'],['no-transfer','O dinheiro NÃO saiu da conta'],['paid','O dinheiro SAIU da conta'],['uncertain','Ainda não consegui conferir']]){
        const option=el(choice,'option',t);option.value=v;
      }
      const guidance=el(modal,'p','','font-size:13px;line-height:1.45;margin:12px 0');
      const reference=el(modal,'input',null,'display:none;width:100%;padding:10px;box-sizing:border-box;border:1px solid #9eafa5;border-radius:6px');
      reference.placeholder='Número do comprovante ou referência do extrato';
      reference.maxLength=120;
      const confirmLabel=el(modal,'label',null,'display:flex;gap:10px;align-items:flex-start;margin:12px 0;font-size:13px');
      const confirmation=el(confirmLabel,'input');confirmation.type='checkbox';
      const confirmationText=el(confirmLabel,'span','');
      const noteLabel=el(modal,'label','3. Descreva o que conferiu','display:block;font-weight:650;font-size:13px;margin-top:12px');
      const note=el(noteLabel,'textarea',null,'display:block;width:100%;min-height:75px;padding:10px;box-sizing:border-box;margin-top:6px;border:1px solid #9eafa5;border-radius:6px');
      note.maxLength=500;note.placeholder='Ex.: Conferi o extrato da conta e o comprovante da data ...';
      const feedback=el(modal,'p','','font-size:13px;color:#a12b22;min-height:18px');
      const buttons=el(modal,'div',null,'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap');
      const cancel=el(buttons,'button','Voltar','padding:10px 14px;border:1px solid #a8b7ae;background:white;border-radius:7px;cursor:pointer');
      const submit=el(buttons,'button','Confirmar conferência','padding:10px 14px;background:#17563e;color:white;border:0;border-radius:7px;cursor:pointer');
      let busy=false;
      let pendingPayload=null; // Reenvio idempotente da MESMA decisão se a resposta se perder.
      function update(){
        const v=choice.value;
        reference.style.display=v==='paid'?'block':'none';
        confirmation.style.display=v==='uncertain'||!v?'none':'inline';
        if(v==='no-transfer'){
          guidance.textContent='Se realmente não houve pagamento, o ERP poderá cancelar esse adiantamento incorreto, mantendo o histórico da conferência.';
          confirmationText.textContent='Conferi o extrato real da conta e confirmo que não houve saída de dinheiro.';
          submit.textContent='Cancelar adiantamento incorreto';
        }else if(v==='paid'){
          guidance.textContent=preview.canRecordTransfer
            ?'Se houve pagamento, o ERP pode registrar o lançamento ausente usando a mesma conta e o mesmo valor. Isso NÃO faz outro PIX nem cria outro adiantamento.'
            :'Há outro lançamento possível ou a conta não está disponível. Não é seguro registrar automaticamente. Confira com o financeiro.';
          confirmationText.textContent='Conferi o extrato real: o pagamento ocorreu nesta conta e neste valor.';
          submit.textContent='Registrar pagamento já realizado';
        }else{
          guidance.textContent=v==='uncertain'
            ?'Sem confirmação no extrato real, deixe este adiantamento pendente. Nenhum saldo será alterado.'
            :'Escolha uma situação após conferir o extrato bancário real.';
          submit.textContent='Confirmar conferência';
        }
        const eligible=preview.eligible&&v&&v!=='uncertain'&&!(v==='paid'&&!preview.canRecordTransfer);
        submit.disabled=busy||(!pendingPayload&&(!eligible||!confirmation.checked||note.value.trim().length<25||
          (v==='paid'&&reference.value.trim().length<6)));
        if(pendingPayload){
          choice.disabled=true;confirmation.disabled=true;note.disabled=true;reference.disabled=true;
          submit.textContent='Verificar novamente';
        }
        submit.style.opacity=submit.disabled?'0.45':'1';
      }
      function close(result){if(busy)return;overlay.remove();resolve(result);}
      cancel.addEventListener('click',()=>close(false));
      choice.addEventListener('change',()=>{confirmation.checked=false;update();});
      for(const field of [confirmation,note,reference]){field.addEventListener('input',update);field.addEventListener('change',update);}
      submit.addEventListener('click',async()=>{
        if(submit.disabled||busy)return;
        busy=true;update();cancel.disabled=true;feedback.textContent='Conferindo e registrando no servidor…';
        try{
          if(!pendingPayload){
            const operationId=global.crypto?.randomUUID?.();
            if(!operationId)throw new Error('Não foi possível confirmar a operação com segurança.');
            const base={fornCod:supplierCode,adtCod:advanceCode,signature:preview.signature,operationId,reason:note.value.trim()};
            pendingPayload=choice.value==='paid'
              ?{...base,action:'record-bank-transfer',confirmedRealTransfer:true,confirmedBankAmount:true,statementReference:reference.value.trim()}
              :{...base,action:'confirm',confirmCode:advanceCode,confirmedNoRealTransfer:true};
          }
          const result=await request(pendingPayload);
          if(!result.confirmed)throw new Error('O sistema não confirmou a conferência.');
          busy=false;overlay.remove();resolve(result);
        }catch(error){
          console.warn('advance.business.reconciliation.failed',{code:error?.code||'',status:error?.status||0});
          busy=false;cancel.disabled=false;
          feedback.textContent='Ainda não conseguimos confirmar o resultado. Clique em “Verificar novamente” para consultar a mesma operação, sem enviar outro lançamento.';
          update();
        }
      });
      update();choice.focus?.();
    });
  }

  async function reviewOrphanAdvance(supplierCode,advanceCode){
    const user=global.firebase?.auth?.()?.currentUser;
    if(!user)throw new Error('Sessão expirada.');
    const tokenResult=await user.getIdTokenResult();
    if(tokenResult?.claims?.canAdvances!==true||tokenResult?.claims?.canBanking!==true)
      throw new Error('Esta conferência precisa de acesso ao Financeiro e Bancos.');
    const request=async payload=>{
      const response=await global.fetch('/api/finance/advance-orphan-recovery',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},
        body:JSON.stringify(payload)
      });
      const json=await response.json().catch(()=>({}));
      if(!response.ok){const error=new Error('Não foi possível conferir este adiantamento agora.');
        error.status=response.status;error.code=json.code;throw error;}
      return json;
    };
    const review=await request({action:'preview',fornCod:supplierCode,adtCod:advanceCode});
    if(!review.eligible){
      console.warn('advance.business.review.requires_check',review.issues||[]);
      alertUser('Este adiantamento já possui utilização ou outros vínculos. Confira Compra de Sucata → Histórico e Contas a Pagar antes de alterá-lo. Nada foi modificado.');
      return false;
    }
    if(!global.document?.body||!global.document?.createElement)throw new Error('Formulário de conferência indisponível.');
    const result=await businessReviewDialog(review,request,supplierCode,advanceCode);
    if(!result)return false;
    if(result.action!=='restore-missing-bank-movement'){
      if(!result.removedCode||result.removedCode!==advanceCode)throw new Error('Servidor não confirmou o cancelamento.');
      if(typeof ADT_POR_FORN!=='undefined'){
        ADT_POR_FORN[supplierCode]=result.entries||[];
        try{if(typeof _fbAdiantamentoConfirmado==='function')_fbAdiantamentoConfirmado(supplierCode,ADT_POR_FORN[supplierCode]);}catch(_){}
        try{global.localStorage?.setItem('mm_adt',JSON.stringify(ADT_POR_FORN));}catch(_){}
      }
      try{if(global._ADT_PENDENTES)delete global._ADT_PENDENTES[supplierCode+'::'+advanceCode];}catch(_){}
      alertUser('Adiantamento cancelado após conferência. O histórico foi preservado.','success');
    }else{
      alertUser('Pagamento já realizado registrado no extrato do ERP. Nenhum novo pagamento foi enviado.','success');
    }
    try{global.renderAdiantamentos?.();global.onCanhotFornChange?.();}catch(error){console.warn('Atualização da tela após conciliação',error);}
    return true;
  }

  function showReviewAction(button,supplierCode,advanceCode){
    const host=button?.parentElement;
    if(!host||!global.document?.createElement||!host.appendChild)return false;
    if(host.querySelector?.('[data-erp-review-pendency]'))return true;
    const review=global.document.createElement('button');
    review.type='button';review.dataset.erpReviewPendency=advanceCode;
    review.textContent='Conferir pagamento';
    review.title='Confira se o dinheiro saiu da conta, seguindo as instruções na tela.';
    review.style.cssText='display:inline-block;margin-left:6px;padding:6px 9px;border:1px solid #b78727;border-radius:6px;background:#fff8e6;color:#6b470b;cursor:pointer;font-size:12px;font-weight:600';
    review.addEventListener('click',async()=>{
      if(review.disabled)return;review.disabled=true;
      try{const completed=await reviewOrphanAdvance(supplierCode,advanceCode);if(completed)review.remove?.();}
      catch(error){console.warn('advance.business.review.failed',{code:error?.code||'',status:error?.status||0});
        alertUser('Não foi possível abrir a conferência. O adiantamento foi preservado. Peça ajuda ao responsável pelo financeiro.');}
      finally{review.disabled=false;}
    });
    host.appendChild(review);
    return true;
  }

  async function deleteAdvance(supplierCode, advanceCode, button) {
    const key = supplierCode + '::' + advanceCode;
    if (deleting.has(key)) return false;
    const list = typeof ADT_POR_FORN !== 'undefined' ? ADT_POR_FORN[supplierCode] : null;
    const matches = (list || []).filter(a => String(a?.cod) === String(advanceCode));
    if (matches.length !== 1) { alertUser('Adiantamento não encontrado ou duplicado. Atualize a tela.'); return false; }
    const record = matches[0];
    if (!global.confirm(`Excluir o adiantamento ${advanceCode} de ${supplierCode}?\nO adiantamento e o movimento bancário vinculado serão removidos juntos.`)) return false;
    deleting.add(key);
    const previous = button?.textContent;
    if (button) button.textContent = 'Excluindo…';
    try {
      if (typeof global._adtCommitTransacional !== 'function') throw new Error('Serviço financeiro indisponível.');
      const result = await global._adtCommitTransacional({action:'delete',fornCod:supplierCode,adtCod:advanceCode,expected:record},button);
      if (!result || result.action !== 'delete') throw new Error('Exclusão não confirmada.');
      try { if (global._ADT_PENDENTES) delete global._ADT_PENDENTES[key]; } catch (_) {}
      try { if (typeof registrarHistorico === 'function') registrarHistorico('Adiantamento', 'Excluído',
        `${supplierCode} ${advanceCode} — R$ ${Number(record.valor || 0).toFixed(2)} (${record.data || ''})`,
        record, {fornCod:supplierCode}); } catch (error) { console.warn('[Adiantamentos] Histórico:',error); }
      try { if (typeof global.onCanhotFornChange === 'function') global.onCanhotFornChange(); } catch (_) {}
      alertUser('Adiantamento excluído e movimento bancário conciliado no Firebase.', 'success');
      return true;
    } catch (error) {
      const code=String(error?.code||'');
      const message=String(error?.message||'');
      const bankMismatch=code==='BANK_LEDGER_CHANGED'||
        /movimento bancário.*divergente|concilia[cç][aã]o financeira|movimento bancário.*ausente/i.test(message);
      if(bankMismatch){
        // Mensagem pública sem termos de backend, IDs de operação ou instrução para F5.
        let canReview=false;
        try{
          const actor=await global.firebase?.auth?.()?.currentUser?.getIdTokenResult?.();
          canReview=actor?.claims?.canAdvances===true&&actor?.claims?.canBanking===true;
        }catch(checkError){console.warn('advance.review.claims.unavailable',checkError);}
        const actionAvailable=canReview&&showReviewAction(button,supplierCode,advanceCode);
        alertUser(actionAvailable
          ? 'Este adiantamento precisa de conferência com o extrato do banco. Nada foi alterado. Clique em “Conferir pagamento” para ver o que fazer.'
          : 'Este adiantamento precisa de conferência com o extrato bancário. Nenhum dado foi alterado. Peça ao responsável pelo financeiro que faça a conferência.');
      }else if(code==='ADVANCE_IN_PROGRESS'){
        alertUser('Outra operação deste fornecedor ainda está sendo concluída. Nenhum dado foi excluído. Aguarde alguns segundos e tente novamente.');
      }else if(code==='DATABASE_UNAVAILABLE'||code==='SESSION_EXPIRED'||code==='NETWORK_ERROR'){
        alertUser(message||'A conexão oscilou e a exclusão não foi confirmada. Tente novamente em alguns segundos.');
      }else if(code==='ADVANCE_ALREADY_COMPENSATED'){
        alertUser('Este adiantamento já foi utilizado. A exclusão exige uma conciliação financeira autorizada.');
      }else if(error?.status===403||code.toLowerCase()==='permission_denied'||/permission_denied/i.test(message)){
        alertUser('Você não tem permissão para excluir este adiantamento. Solicite autorização ao responsável financeiro.');
      }else{
        // Preserve diagnósticos completos no console para suporte, sem expor o erro bruto.
        console.warn('advance.delete.rejected',{code,status:error?.status,reason:message});
        alertUser('Não foi possível concluir a exclusão. Nenhuma alteração foi confirmada. Solicite suporte ao administrador.');
      }
      return false;
    } finally {
      deleting.delete(key);
      if (button?.isConnected) button.textContent = previous;
    }
  }

  global.excluirAdiantamentoLista = function (button) {
    if (!button) return false;
    const code = String(button.dataset?.cod || '').trim();
    const possibilities = candidatesForAdvance(code, button.dataset?.forn || '');
    if (possibilities.length !== 1) {
      alertUser(possibilities.length ? 'Há fornecedores ambíguos para esse lançamento. Abra a ficha e exclua pelo código do fornecedor.' : 'Adiantamento não localizado. Atualize a lista.');
      return false;
    }
    return queueAdvanceDeletion(possibilities[0].supplierCode, code, button);
  };
  global.excluirAdiantamento = (supplierCode, advanceCode) => queueAdvanceDeletion(String(supplierCode), String(advanceCode));

// Na inclusão sequencial de cheques, o próximo herda o banco escolhido
// na última linha. A escolha explícita de banco (p.ex., gerar sequência)
// continua prevalecendo. Não altera nenhum cheque já preenchido.
const legacyAddCheque=global._adtChqAddRow;
if(typeof legacyAddCheque==='function'){
  global._adtChqAddRow=function(banco,...rest){
    let selected=banco;
    if(!selected){
      const rows=global.document?.querySelectorAll?.('#adt-chq-rows .adt-chq-row .rb');
      const previous=rows?.length?rows[rows.length-1]:null;
      selected=String(previous?.value||'').trim()||undefined;
    }
    return legacyAddCheque.call(this,selected,...rest);
  };
}

global.ERPAdvanceActions={deleteAdvance:queueAdvanceDeletion,candidatesForAdvance,reviewOrphanAdvance};
})(window);
