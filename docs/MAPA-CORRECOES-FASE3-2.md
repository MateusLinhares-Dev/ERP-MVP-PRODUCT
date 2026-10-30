# Mapa de Correções — Fase 3.2

| Problema | Causa encontrada | Correção |
|---|---|---|
| Editar / Impureza dá Ticket não encontrado | `fecharDetalheCompra()` zera `_dcDbKey` antes de `csAbrirImpureza(_dcDbKey)` | Wrapper usa a chave persistida do ticket atual como fallback |
| Marcadores da Agenda desaparecem com filtro | calendário construía `byDay` a partir da lista já filtrada | marcadores do mês usam todos os `calendarEvents` daquele mês |
| Clique no dia da Agenda não filtra lista | seleção só mudava o destaque visual | seleção passa a configurar `De = Até = dia selecionado` |
| Preços não mostra fornecedores/clientes | combobox dependia do select oculto e lista só abria como overlay | lista persistente usa diretamente cadastros ativos e pesquisa filtra a própria lista |
| Botões de Contas da Dona sem cursor | CSS não definia cursor para ações | `cursor:pointer` nos botões do módulo |
| Adiantamento corrigido volta ao valor antigo | reconciliação automática recalculava snapshot + adiantamentos vinculados depois do save manual | correção manual exata com `_phase3AdvanceOverride`, bloqueio dos códigos já conciliados e atualização de saldo/CP |
| Calendário Contas a Pagar mostra quantidade mas tabela vazia | filtro de tipo/mês/empresa continuava ativo após clique no dia | clique no dia limpa filtros conflitantes antes de aplicar o dia |
| Filtro `de/até` de Contas a Pagar não mostra resultados esperados | `_cpMesFiltro` e `_cpFiltroDia` continuavam restringindo o intervalo | alteração do intervalo limpa mês/dia implícitos |
| Vencimentos de hoje abre vazio | legado escondia `cp-hoje-panel` quando quantidade era zero | painel permanece legível e mostra estado vazio explícito |
