/* ERP Manuela Metais | Origem do estoque fiscal + exclusão confirmada de adiantamentos.
   Sem alteração de regras do Firebase nem gravações fiscais automáticas. */
(function (global) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const doc = () => typeof document !== 'undefined' ? document : null;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const kg = (v) => Number(v || 0).toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3}) + ' kg';
  const displayPeriod = (value) => {const m=String(value).match(/(\d{4})-(\d{2})$/);return m?m[2]+'/'+m[1]:String(value)};
  const alertUser = (message, type = 'error') => {
    if (typeof global.showToast === 'function') global.showToast(message, type, 6500);
    else global.alert(message);
  };

  function stockOrigins(material) {
    const rows = [];
    if (typeof FISCAL_DB === 'undefined' || typeof _fiscalKeyMatchesCompany !== 'function') return rows;
    for (const [period, bucket] of Object.entries(FISCAL_DB || {})) {
      if (!_fiscalKeyMatchesCompany(period, _fiscalEmpresa)) continue;
      for (const [source, sign] of [['entradas', 'e'], ['saidas', 's']]) {
        (bucket?.[source] || []).forEach((nf, index) => {
          const items = Array.isArray(nf.itens) ? nf.itens : [{produto: nf.produto || 'Sem produto', kg: Number(nf.kg) || 0, valor: nf.valor}];
          items.forEach(item => {
            const category = typeof _categoriaProdutoNF === 'function'
              ? _categoriaProdutoNF(item, period, sign, nf.num)
              : String(item.produto || '').trim();
            if (category !== material) return;
            rows.push({period, source, index, number: String(nf.num || 'Sem número'), date: String(nf.data || ''),
              rawProduct: String(item.produto || 'Não informado'), classification: category,
              amount: typeof _kgDoItem === 'function' ? _kgDoItem(item) : Number(item.kg || 0),
              party: String(nf.fornecedor || nf.cliente || 'Não informado')});
          });
        });
      }
    }
    return rows.sort((a,b) => a.period.localeCompare(b.period) || a.number.localeCompare(b.number));
  }

  let modalOrigins = [];
  function closeOriginDialog() { $('#erp-fiscal-origin-dialog')?.remove(); }
  function openOriginDialog(material) {
    closeOriginDialog();
    modalOrigins = stockOrigins(material);
    const shell = document.createElement('div');
    shell.id = 'erp-fiscal-origin-dialog';
    shell.className = 'erp-fix-overlay';
    shell.innerHTML = `<section class="erp-fix-dialog" role="dialog" aria-modal="true" aria-label="Origem do material fiscal">
      <div class="erp-fix-heading"><div><h3>Origem do estoque: ${esc(material)}</h3><p>Saldo calculado pelas notas fiscais. Excluir o saldo isoladamente deixaria as notas inconsistentes.</p></div>
        <button type="button" data-origin-close aria-label="Fechar">✕</button></div>
      <div class="erp-fix-scroll">
        ${modalOrigins.length ? `<table class="erp-fix-table"><thead><tr><th>Competência</th><th>Movimento / NF</th><th>Material original</th><th>Quantidade</th><th>Ação</th></tr></thead><tbody>
          ${modalOrigins.map((r,i)=>`<tr><td>${esc(displayPeriod(r.period))}</td><td>${r.source==='entradas'?'Entrada':'Saída'} nº ${esc(r.number)}<br><small>${esc(r.date)} · ${esc(r.party)}</small></td>
            <td>${esc(r.rawProduct)}</td><td class="${r.source==='entradas'?'erp-fix-positive':'erp-fix-negative'}">${r.source==='entradas'?'+':'−'} ${kg(r.amount)}</td>
            <td><button type="button" data-origin-edit="${i}">Abrir nota</button></td></tr>`).join('')}
          </tbody></table>` : '<p>Não há notas deste material na empresa selecionada. Verifique se há saldo inicial/ajuste histórico.</p>'}
      </div><p class="erp-fix-hint">Para corrigir um lançamento, abra a nota correspondente no período de origem. Não é realizado nenhum apagamento automático.</p>
      <div class="erp-fix-actions"><button type="button" data-origin-close>Fechar</button></div></section>`;
    document.body.appendChild(shell);
    shell.addEventListener('click', event => {
      if (event.target === shell || event.target.closest('[data-origin-close]')) { closeOriginDialog(); return; }
      const edit = event.target.closest('[data-origin-edit]');
      if (edit) openFiscalNote(modalOrigins[Number(edit.dataset.originEdit)]);
    });
  }
  function openFiscalNote(record) {
    if (!record) return;
    const match = String(record.period).match(/(\d{4})-(\d{2})$/);
    if (!match) { alertUser('Competência fiscal inválida para esta nota.'); return; }
    const year = $('#fiscal-sel-ano'), month = $('#fiscal-sel-mes');
    if (!year || !month) { alertUser('Não localizei os filtros de competência fiscal.'); return; }
    year.value = match[1]; month.value = match[2];
    try {
      if (typeof global.fiscalCarregarMes === 'function') global.fiscalCarregarMes();
      if (typeof global.fiscalMenSubTab === 'function') global.fiscalMenSubTab(record.source);
      if (typeof global.fiscalAbrirEditar !== 'function') throw new Error('Editor de nota fiscal não disponível.');
      closeOriginDialog();
      global.fiscalAbrirEditar(record.source, record.index);
    } catch (error) { alertUser('Não foi possível abrir a nota: ' + error.message); }
  }

  function enhanceStockTable() {
    const tbody = $('#tb-fiscal-estoque');
    const panel = $('#fmtab-estoque');
    if (!tbody || !panel) return;
    if (!$('#erp-fiscal-stock-notice', panel)) {
      const notice = document.createElement('p');
      notice.id = 'erp-fiscal-stock-notice'; notice.className = 'erp-fix-notice';
      notice.textContent = 'Estoque calculado a partir das NFs de entrada e saída de todos os meses, mais saldos iniciais quando aplicáveis. Use “Ver origem” para conferir ou corrigir a nota que gerou o saldo.';
      panel.prepend(notice);
    }
    for (const row of tbody.querySelectorAll('tr')) {
      const cell = row.cells?.[0];
      if (!cell || row.cells.length !== 4 || cell.querySelector('.erp-fix-source-btn')) continue;
      const material = String(cell.textContent || '').trim();
      if (!material || /nenhum produto|atualizar/i.test(material)) continue;
      const btn = document.createElement('button');
      btn.className = 'erp-fix-source-btn'; btn.type = 'button'; btn.textContent = 'Ver origem';
      btn.addEventListener('click', () => openOriginDialog(material));
      cell.appendChild(btn);
    }
  }
  const stockRender = global.fiscalRenderEstoque;
  if (typeof stockRender === 'function') global.fiscalRenderEstoque = function (...args) {
    const result = stockRender.apply(this, args);
    enhanceStockTable();
    return result;
  };
  if (doc()) {
    document.addEventListener('erp:ready', enhanceStockTable);
    setTimeout(enhanceStockTable, 50);
  }

  // Exclusão dos adiantamentos: procurar por código do cadastro, nunca por nome ambíguo.
  const deleting = new Set();
  function candidatesForAdvance(advanceCode, supplierName) {
    if (typeof ADT_POR_FORN === 'undefined') return [];
    const result = [];
    for (const [supplierCode, advances] of Object.entries(ADT_POR_FORN || {})) {
      const advance = (advances || []).find(a => String(a?.cod) === String(advanceCode));
      if (advance) {
        const supplier = (typeof FORNECEDORES !== 'undefined' ? FORNECEDORES : []).find(f => String(f.cod) === supplierCode);
        result.push({supplierCode, advance, supplierName: String(supplier?.nome || supplierCode)});
      }
    }
    if (!supplierName) return result;
    const normalized = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const named = result.filter(x => normalized(x.supplierName) === normalized(supplierName));
    return named.length ? named : result;
  }

  // A transação DEVE ocorrer no filho exato, nunca no array inteiro do fornecedor.
  // Uma transação do pai pode ser cancelada por operações de sincronização de outros adiantamentos.
  const stable = value => {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    return JSON.stringify(value);
  };
  const entries = value => value && typeof value === 'object'
    ? Object.entries(value).filter(([,record]) => record && typeof record === 'object') : [];

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

  global.ERPFiscalAdvanceFix = {stockOrigins, deleteAdvance, candidatesForAdvance, enhanceStockTable};
})(window);
