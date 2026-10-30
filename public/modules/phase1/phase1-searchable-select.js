/* Seletor pesquisável para cadastros extensos. Mantém o <select> original como fonte
   de verdade e preserva todos os onchange, valores e regras dos módulos legados. */
(function (global) {
  'use strict';

  const instances = new WeakMap();
  const PAGE_SIZE = 8;
  let sequence = 0;

  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  }
  function labelFor(select) {
    return select.selectedOptions[0]?.value ? select.selectedOptions[0].textContent.trim() : '';
  }
  function enhance(select, options = {}) {
    if (!select || select.tagName !== 'SELECT') return null;
    const previous = instances.get(select);
    if (previous) { previous.refresh(); return previous; }
    if (select.multiple || select.disabled) return null;

    const id = 'erp-select-results-' + (++sequence);
    const host = document.createElement('div');
    host.className = 'erp-search-select phase1-no-arrow-nav';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'erp-search-select-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = options.placeholder || 'Pesquisar e selecionar…';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-controls', id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-label', options.label || 'Pesquisar cadastro');
    const arrow = document.createElement('span');
    arrow.className = 'erp-search-select-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '⌄';
    const list = document.createElement('div');
    list.className = 'erp-search-select-popover';
    const results = document.createElement('div');
    results.className = 'erp-search-select-results';
    results.id = id;
    results.setAttribute('role', 'listbox');
    list.hidden = true;
    host.append(input, arrow, list);
    select.insertAdjacentElement('afterend', host);
    // Não retirar ou substituir o select: o código legado consulta seu ID e valor.
    select.classList.add('erp-search-select-native');

    let opened = false, page = 0, activeIndex = -1, matches = [];
    const values = () => Array.from(select.options).filter(opt => opt.value && !opt.disabled)
      .map(opt => ({ value: opt.value, label: opt.textContent.trim() }));

    function syncLabel() {
      if (!opened) input.value = labelFor(select);
      input.disabled = select.disabled;
      input.setAttribute('aria-invalid', 'false');
    }
    function close() {
      if (!opened) return;
      opened = false;
      host.classList.remove('open');
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      syncLabel();
    }
    function render() {
      const q = normalize(input.value);
      matches = values().filter(item => !q || normalize(item.label).includes(q));
      const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
      page = Math.min(page, pages - 1);
      const chunk = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      results.replaceChildren();
      if (!chunk.length) {
        const empty = document.createElement('p');
        empty.className = 'erp-search-select-empty';
        empty.textContent = 'Nenhum cadastro encontrado.';
        results.appendChild(empty);
      }
      chunk.forEach((item, idx) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'erp-search-select-option';
        button.setAttribute('role', 'option');
        button.id = `${id}-option-${idx}`;
        button.setAttribute('aria-selected', String(item.value === select.value));
        button.textContent = item.label;
        button.dataset.value = item.value;
        button.addEventListener('mousedown', e => e.preventDefault());
        button.addEventListener('click', () => choose(item.value));
        results.appendChild(button);
      });
      const footer = document.createElement('div');
      footer.className = 'erp-search-select-footer';
      const summary = document.createElement('small');
      summary.textContent = matches.length ? `${matches.length} resultado(s) · página ${page + 1} de ${pages}` : 'Tente outro nome';
      footer.appendChild(summary);
      if (pages > 1) {
        const nav = document.createElement('div');
        nav.className = 'erp-search-select-nav';
        [['Anterior', -1], ['Próxima', 1]].forEach(([title, step]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = title;
          btn.disabled = step < 0 ? page === 0 : page === pages - 1;
          btn.addEventListener('mousedown', e => e.preventDefault());
          btn.addEventListener('click', () => { page += step; activeIndex = -1; render(); input.focus(); });
          nav.appendChild(btn);
        });
        footer.appendChild(nav);
      }
      list.replaceChildren(results, footer);
      activeIndex = -1;
    }
    function open(search = false) {
      if (select.disabled) return;
      opened = true;
      host.classList.add('open');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (!search) input.value = '';
      page = 0;
      render();
    }
    function choose(value) {
      if (![...select.options].some(option => option.value === value && !option.disabled)) return;
      select.value = value;
      close();
      input.value = labelFor(select);
      // Dispara handlers existentes, inclusive os inline onchange da Rodoviária.
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input.addEventListener('focus', () => { if (!opened) open(false); });
    input.addEventListener('click', () => { if (!opened) open(false); });
    input.addEventListener('input', () => { page = 0; open(true); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); input.blur(); return; }
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!opened) open(false);
        const buttons = [...results.querySelectorAll('.erp-search-select-option')];
        if (!buttons.length) return;
        activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons.forEach((button, i) => button.classList.toggle('active', i === activeIndex));
        input.setAttribute('aria-activedescendant', buttons[activeIndex].id);
        buttons[activeIndex].scrollIntoView({ block: 'nearest' });
      }
      if (event.key === 'Enter' && opened) {
        event.preventDefault();
        const buttons = [...results.querySelectorAll('.erp-search-select-option')];
        const chosen = buttons[activeIndex >= 0 ? activeIndex : 0];
        if (chosen) choose(chosen.dataset.value);
      }
    });
    input.addEventListener('blur', () => {
      // O clique em opção é processado antes da perda de foco.
      setTimeout(() => { if (!host.contains(document.activeElement)) close(); }, 0);
    });
    select.addEventListener('change', () => { if (opened) close(); syncLabel(); });
    const observer = new MutationObserver(() => {
      if (!host.isConnected) { observer.disconnect(); return; }
      if (opened) render(); else syncLabel();
    });
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'value'] });
    const control = { refresh() { if (opened) render(); else syncLabel(); }, choose, close, focus() { input.focus(); }, input, select };
    instances.set(select, control);
    syncLabel();
    return control;
  }
  document.addEventListener('pointerdown', e => {
    document.querySelectorAll('.erp-search-select.open').forEach(host => {
      if (!host.contains(e.target)) instances.get(host.previousElementSibling)?.close();
    });
  }, true);
  function enhanceDefaults() {
    [
      ['rod-forn-sel', 'Pesquisar cliente ou fornecedor', 'Cliente ou fornecedor'],
      ['adtcli-cli', 'Pesquisar cliente', 'Cliente do adiantamento'],
      ['cheqcli-cli', 'Pesquisar cliente', 'Cliente do cheque']
    ].forEach(([id, placeholder, label]) => {
      const select = document.getElementById(id);
      if (select) enhance(select, { placeholder, label });
    });
  }
  // Os modais de adiantamento e cheques são reconstruídos pelo código legado.
  const modalBody = document.getElementById('modal-body');
  if (modalBody) new MutationObserver(enhanceDefaults).observe(modalBody, { childList: true, subtree: false });
  enhanceDefaults();
  global.ERPEnhanceSearchableSelect = enhance;
  global.ERPRefreshSearchableSelect = function (id) {
    return instances.get(document.getElementById(id))?.refresh();
  };
  global.ERPSelectedSearchableSelect = function (id, value) {
    const select = document.getElementById(id);
    if (!select) return;
    select.value = value;
    instances.get(select)?.refresh();
  };
})(window);
