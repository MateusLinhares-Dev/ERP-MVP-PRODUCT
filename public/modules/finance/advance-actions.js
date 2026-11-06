(function(global){
'use strict';
const alertUser=(message,type='error')=>{if(typeof global.showToast==='function')global.showToast(message,type,6500);else global.alert(message);};
  const deleting = new Set();
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
      alertUser('Não foi possível excluir: ' + (error?.message || 'erro desconhecido'));
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
    return deleteAdvance(possibilities[0].supplierCode, code, button);
  };
  global.excluirAdiantamento = (supplierCode, advanceCode) => deleteAdvance(String(supplierCode), String(advanceCode));

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

global.ERPAdvanceActions={deleteAdvance,candidatesForAdvance};
})(window);
