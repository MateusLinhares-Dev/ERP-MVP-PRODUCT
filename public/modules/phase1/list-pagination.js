/* Paginação de listagens operacionais. Os dados e índices originais permanecem intactos. */
(function (global) {
  'use strict';
  const states = new Map();
  const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const sizes = [25, 50, 100];

  function stateFor(key) {
    if (!states.has(key)) states.set(key, { page: 1, size: 25, query: '' });
    return states.get(key);
  }

  function controls(key, body, render, opts) {
    // Aceita tabelas e listas de cards; paginador fora do conteúdo re-renderizado.
    const table = typeof body.closest === 'function' ? body.closest('table') : null;
    const anchor = table || body;
    const state = stateFor(key);
    const id = 'erp-list-pager-' + key;
    let bar = document.getElementById(id);
    if (!bar) {
      bar = document.createElement('div');
      bar.id = id;
      bar.className = 'erp-list-pager';
      anchor.insertAdjacentElement('afterend', bar);
    }
    if (opts.searchable) {
      let input = document.getElementById(id + '-search');
      if (!input) {
        input = document.createElement('input');
        input.id = id + '-search';
        input.type = 'search';
        input.className = 'erp-list-pager-search';
        input.setAttribute('aria-label', 'Pesquisar na listagem');
        input.placeholder = opts.placeholder || 'Buscar em todos os registros...';
        anchor.insertAdjacentElement('beforebegin', input);
        input.addEventListener('input', () => {
          state.query = input.value;
          state.page = 1;
          render();
        });
      }
    }
    return bar;
  }

  function slice(key, rows, bodyId, render, opts = {}) {
    const source = Array.isArray(rows) ? rows : [];
    const state = stateFor(key);
    const body = document.getElementById(bodyId);
    const bar = body ? controls(key, body, render, opts) : null;
    const query = normalize(state.query);
    const filtered = query && opts.searchable && typeof opts.text === 'function'
      ? source.filter((item) => normalize(opts.text(item)).includes(query)) : source;
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.size));
    state.page = Math.max(1, Math.min(state.page, totalPages));
    const start = (state.page - 1) * state.size;

    if (bar) {
      // DOM nodes em vez de interpolação de registros: nenhum texto do usuário entra em HTML.
      bar.replaceChildren();
      const count = document.createElement('span');
      count.className = 'erp-list-pager-count';
      count.setAttribute('aria-live', 'polite');
      count.textContent = filtered.length ? `${start + 1}–${Math.min(start + state.size, filtered.length)} de ${filtered.length} registros` : '0 registros';
      const nav = document.createElement('div');
      nav.className = 'erp-list-pager-nav';
      const sizeLabel = document.createElement('label');
      sizeLabel.textContent = 'Por página ';
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Registros por página');
      for (const size of sizes) {
        const opt = document.createElement('option');
        opt.value = String(size);
        opt.textContent = String(size);
        opt.selected = state.size === size;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        state.size = sizes.includes(Number(select.value)) ? Number(select.value) : 25;
        state.page = 1;
        render();
      });
      sizeLabel.appendChild(select);
      const previous = document.createElement('button');
      previous.type = 'button'; previous.textContent = 'Anterior';
      previous.disabled = state.page === 1;
      previous.addEventListener('click', () => { state.page -= 1; render(); });
      const current = document.createElement('span');
      current.className = 'erp-list-pager-position';
      current.textContent = `Página ${state.page} de ${totalPages}`;
      const next = document.createElement('button');
      next.type = 'button'; next.textContent = 'Próxima';
      next.disabled = state.page >= totalPages;
      next.addEventListener('click', () => { state.page += 1; render(); });
      nav.append(sizeLabel, previous, current, next);
      bar.append(count, nav);
      bar.hidden = filtered.length <= 25 && !opts.alwaysShow;
    }
    return filtered.slice(start, start + state.size);
  }

  function reset(key) { const state = stateFor(key); state.page = 1; }
  function snapshot(key) { return { ...stateFor(key) }; }
  global.ERPListPager = Object.freeze({ slice, reset, snapshot });
})(window);
