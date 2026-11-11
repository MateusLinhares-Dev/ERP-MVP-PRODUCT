(function(global){
'use strict';
const alertUser=(message,type='error')=>{if(typeof global.showToast==='function')global.showToast(message,type,6500);else global.alert(message);};
  const deleting = new Set();
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

  function applyOrphanResult(supplierCode,advanceCode,result){
    if(result&&result.action!=='restore-missing-bank-movement'&&typeof ADT_POR_FORN!=='undefined'){
      ADT_POR_FORN[supplierCode]=Array.isArray(result.entries)?result.entries:[];
      try{if(typeof _fbAdiantamentoConfirmado==='function')_fbAdiantamentoConfirmado(supplierCode,ADT_POR_FORN[supplierCode]);}catch(_){}
      try{global.localStorage?.setItem('mm_adt',JSON.stringify(ADT_POR_FORN));}catch(_){}
      try{if(global._ADT_PENDENTES)delete global._ADT_PENDENTES[supplierCode+'::'+advanceCode];}catch(_){}
    }
    try{global.renderAdiantamentos?.();global.onCanhotFornChange?.();}catch(error){console.warn('Atualização da tela após conciliação',error);}
  }
  function reviewOrphanAdvance(supplierCode,advanceCode){
    if(!global.ERPAdvanceReview?.review)return Promise.reject(new Error('Conferência indisponível. Atualize a página e tente de novo.'));
    return global.ERPAdvanceReview.review(supplierCode,advanceCode);
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

global.ERPAdvanceActions={deleteAdvance:queueAdvanceDeletion,candidatesForAdvance,reviewOrphanAdvance,applyOrphanResult};
})(window);
