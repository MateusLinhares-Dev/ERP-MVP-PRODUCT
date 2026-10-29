/* Leitor de cartões de ponto RH iD; interpreta as posições do texto do PDF,
   sem depender de cabeçalhos de um layout específico (NORMAL/NORMAIS/etc.). */
(function (global) {
  'use strict';
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function field(lines, label) {
    const rx = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.*)', 'i');
    for (const line of lines) {
      const items = line.itens || [];
      for (let i = 0; i < items.length; i++) {
        const match = clean(items[i].str).match(rx);
        if (!match) continue;
        let value = match[1];
        if (!value && items[i + 1] && items[i + 1].x < items[i].x + 245) value = items[i + 1].str;
        // As colunas de Nome e CPF aparecem na mesma linha do cartão.
        return clean(value.split(/\s+(?:CPF DO FUNCIONÁRIO|PIS DO FUNCIONÁRIO|DATA DE ADMISSÃO DO FUNCIONÁRIO|NOME DO DEPARTAMENTO)\s*:/i)[0]);
      }
    }
    return '';
  }
  function parsePage(lines, text) {
    const headerIndex = lines.findIndex(line => {
      const a = (line.itens || []).map(i => clean(i.str).toUpperCase());
      return a.some(s => s === 'DIA') && a.some(s => s === 'PREVISTO');
    });
    const basic = {
      nome: field(lines, 'NOME DO FUNCIONÁRIO'),
      cpf: field(lines, 'CPF DO FUNCIONÁRIO'),
      pis: field(lines, 'PIS DO FUNCIONÁRIO'),
      cargo: field(lines, 'NOME DO CARGO'),
      dias: [], extraColunas: {}, alteracoes: []
    };
    const periodo = String(text || '').match(/DE\s+(\d{2}\/\d{2}\/\d{4})\s+ATÉ\s+(\d{2}\/\d{2}\/\d{4})/i);
    basic.periodoInicio = periodo ? periodo[1] : null;
    basic.periodoFim = periodo ? periodo[2] : null;
    if (headerIndex < 0) return { ...basic, erro: 'cabecalho_nao_encontrado' };
    // Cabeçalhos divididos em duas linhas: TOTAL / NORMAIS, FALTA E / ATRASO,
    // EXTRA / 75%D, etc. Considerar as linhas adjacentes para localizar colunas.
    const header = lines.slice(Math.max(0, headerIndex - 2), headerIndex + 2)
      .flatMap(l => l.itens || []).map(it => ({ x: it.x, s: clean(it.str).toUpperCase() }));
    function xFor(rx) { const it = header.find(i => rx.test(i.s)); return it ? it.x : null; }
    const columns = {
      previsto: xFor(/^PREVISTO$/), ent1: xFor(/^ENT\.?\s*1$/), sai1: xFor(/^SA[IÍ]\.?\s*1$/),
      ent2: xFor(/^ENT\.?\s*2$/), sai2: xFor(/^SA[IÍ]\.?\s*2$/),
      ent3: xFor(/^ENT\.?\s*3$/), sai3: xFor(/^SA[IÍ]\.?\s*3$/),
      total: xFor(/^(?:TRABALHADO|NORMAIS|NORMAISN|TOTAL NORMAIS)$/),
      totalNoturno: xFor(/^NOTURNO$/), diaFalta: xFor(/^FALTA$/),
      faltaAtraso: xFor(/^ATRASO$/), abono: xFor(/^ABONO$/),
      extraDiurna: xFor(/^DIURNA$/), extraNoturna: xFor(/^NOTURNA$/),
      bancoTotal: null, bancoSaldo: null
    };
    const bankPositions = header.filter(it => it.s === 'BANCO').sort((a, b) => a.x - b.x);
    if (bankPositions[0]) columns.bancoTotal = bankPositions[0].x;
    if (bankPositions[1]) columns.bancoSaldo = bankPositions[1].x;
    for (const item of header) {
      const match = item.s.match(/^(\d{1,3})%([DN])N?$/);
      if (!match) continue;
      const name = 'extra_' + match[1] + '_' + match[2];
      columns[name] = item.x;
      basic.extraColunas[name] = { pct: match[1], periodo: match[2] };
    }
    // Não considerar o cabeçalho "DIA FALTA" como data, nem juntar colunas.
    const sorted = Object.entries(columns).filter(([, x]) => Number.isFinite(x))
      .sort((a, b) => a[1] - b[1]);
    if (!sorted.some(([key]) => key === 'ent1')) return { ...basic, erro: 'colunas_nao_encontradas' };
    let alterations = false;
    for (const line of lines.slice(headerIndex + 1)) {
      const items = line.itens || [];
      if (!items.length) continue;
      const first = clean(items[0].str);
      if (/^Altera[cç][oõ]es/i.test(first)) { alterations = true; continue; }
      if (alterations) { basic.alteracoes.push(items.map(i => i.str).join(' ')); continue; }
      const match = first.match(/^(\d{2}\/\d{2}\/\d{4})\s*-\s*([A-ZÀ-Ü]{3})/i);
      if (!match) continue;
      const cols = {};
      for (const item of items.slice(1)) {
        let key = null;
        for (const [name, x] of sorted) {
          if (item.x >= x - 2.5) key = name;
          else break;
        }
        if (key) (cols[key] ||= []).push(clean(item.str));
      }
      const val = k => (cols[k] || []).join(' ').trim();
      const extras = {};
      for (const [k, def] of Object.entries(basic.extraColunas)) if (val(k)) extras[k] = { ...def, valor: val(k) };
      basic.dias.push({
        data: match[1], diaSemana: match[2].toUpperCase(), previsto: val('previsto'),
        ent1: val('ent1'), sai1: val('sai1'), ent2: val('ent2'), sai2: val('sai2'),
        ent3: val('ent3'), sai3: val('sai3'), total: val('total'),
        faltaAtraso: val('faltaAtraso'), extras
      });
    }
    if (!basic.dias.length) basic.erro = 'dias_nao_encontrados';
    return basic;
  }
  global.RHiDCardReader = { parsePage };
  if (typeof module === 'object' && module.exports) module.exports = global.RHiDCardReader;
})(typeof globalThis !== 'undefined' ? globalThis : this);
