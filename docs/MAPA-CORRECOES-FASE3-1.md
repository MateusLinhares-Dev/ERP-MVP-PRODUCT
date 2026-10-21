# Fase 3.1 — estabilização da homologação

Esta revisão trata somente dos problemas encontrados na homologação após a Fase 3.

| Área | Problema observado | Correção aplicada |
|---|---|---|
| Compra Sucata | Editar podia retornar “Ticket não encontrado” | Resolução por chave interna, número visível, mapeamento da linha e recuperação pontual no Firebase por chave ou `ticket` |
| Compra Sucata | Valor/motivo do bloco verde reaparecia em outro ticket | Campos transitórios são zerados antes e depois de abrir cada detalhe |
| Compra Sucata | Observação desaparecia durante rolagem | Observação salva durante digitação e coluna fica sticky durante rolagem |
| Bancos Cliente/Fornecedor | X e Adicionar conta sem feedback de clique | Cursores de todas as ações do modal passam a `pointer` |
| Calendário | Filtro confuso e registros antigos misturados | Agenda única, filtros por intervalo de datas ou meses, responsável e busca; resultados completos em painel lateral |
| Calendário | Antigo Afazeres continuava aparecendo | Registros antigos são migrados uma vez para a nova agenda e toda interface antiga fica oculta inclusive após rerender legado |
| Calendário/Avisos | Difícil validar por usuário | Cada compromisso tem responsável; Avisos/popups usam apenas compromissos do usuário logado e mantêm gatilhos de 5, 3 e 1 dia |
| Preços | Busca de fornecedor/cliente em input separado | Select legado vira combobox pesquisável: digita na própria lista, filtra e seleciona; barra duplicada da Fase 2 é removida |
| Cheques | KPI indicava cheque mas tabela sumia | Corrigida limpeza da Fase 2 que removia acidentalmente o container da tabela |
| Cheques | Datas pareciam texto | Data de saída, vencimento e caiu em passam a usar calendário (`type=date`) mantendo formato legado ao salvar |
| Contas da Dona | Módulo não abria | Corrigido ID real `tab-contas_dona` e ativação do menu/painel |
| Adiantamentos | Lançamento vinculado ao ticket não refletia na compra | Reconciliação determinística por snapshot financeiro + adiantamentos externos vinculados; saldo e Conta a Pagar atualizados juntos |
| Adiantamentos | Risco de contar duas vezes adiantamento já usado no fechamento | Códigos presentes em `reciboFinanceiro.adiantamentos` e `compra_inline` são excluídos da soma externa |
| Viagem Motorista | Gastos extras não apareciam na edição | Campo é injetado no local correto do modal legado e persistido após o save legado reconstruir o objeto |
| Coordenação | Participantes grudados | Participantes viram cards em grid, com nome, matrícula e cargo; somente ativos |

## Segurança

Esta revisão não altera `database.rules.json` nem `storage.rules`. Ela é compatível com o pacote de segurança já aplicado na HML.
