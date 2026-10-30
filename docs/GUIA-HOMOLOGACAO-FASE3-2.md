# Guia de Homologação — Fase 3.2

Faça os testes na HML e force `Ctrl + F5` após o deploy.

## 1. Compra de Sucata — Editar / Impureza

1. Abra `Compra Sucata > Histórico`.
2. Abra qualquer ticket pelo fornecedor ou pelo valor total.
3. No modal `Detalhes da Compra`, clique em `Editar / Impureza`.
4. Esperado: o modal de preço/kg e impureza abre para o MESMO ticket e não aparece `Ticket não encontrado`.
5. Altere um campo, salve, feche e abra novamente para validar persistência.

## 2. Agenda

1. Abra a agenda sem filtro de período e navegue entre meses.
2. Esperado: todo mês mostra os indicadores nos dias que possuem compromissos.
3. Defina um período que não inclua o próximo mês e navegue o calendário para esse próximo mês.
4. Esperado: os marcadores do calendário continuam aparecendo, porque a visualização mensal não depende do filtro da listagem.
5. Clique em um dia que possui compromisso.
6. Esperado: o filtro `De` e `Até` passa a representar aquele dia e `Agendas encontradas` exibe os compromissos daquele dia, respeitando também responsável/busca se usados depois.
7. Teste `Por meses` normalmente.

## 3. Preços Fornecedor e Cliente

1. Abra `Preços Forn.`.
2. Esperado: os fornecedores cadastrados já ficam visíveis na lista abaixo da única barra de pesquisa.
3. Digite parte do nome; a MESMA lista deve ser filtrada.
4. Clique no fornecedor; ele fica marcado como selecionado e a tabela de materiais aparece.
5. Repita em `Preços Clientes`.
6. Não deve existir segundo campo de pesquisa de fornecedor/cliente.

## 4. Contas da Dona

Passe o mouse em `Nova conta`, `Pagar`, `Editar`, `Pausar` e demais botões. Esperado: cursor de ponteiro em todos os controles clicáveis.

## 5. Compra de Sucata — corrigir adiantamento

Use um ticket conhecido, por exemplo `T827734`.

1. Abra os detalhes e clique em `Corrigir` no adiantamento.
2. Troque o valor para `120,00` e confirme.
3. Esperado imediatamente: adiantamento `R$ 120,00` e saldo recalculado.
4. Feche o modal e abra o mesmo ticket novamente.
5. Esperado: continua `R$ 120,00`.
6. Dê `F5`/`Ctrl + F5` e abra novamente.
7. Esperado: continua `R$ 120,00`.
8. Confira a linha do ticket no Histórico e a Conta a Pagar relacionada; ambos devem refletir o novo saldo.

A correção feita dentro da compra passa a ser considerada uma correção manual exata. Adiantamentos que já estavam ligados ao ticket no momento da correção não podem restaurar automaticamente o valor anterior.

## 6. Contas a Pagar — calendário

1. Deixe propositalmente `Despesas` selecionado.
2. Clique em um dia vermelho do calendário que informa que existem contas.
3. Esperado: o sistema muda para uma visão coerente do dia, limpando filtros conflitantes, e as contas daquele dia aparecem na tabela.
4. Teste os campos `de` e `até`; o intervalo não pode continuar preso ao mês selecionado anteriormente.
5. Abra `Vencimentos de hoje`.
6. Se houver contas hoje, elas aparecem e a tabela pode ser filtrada para hoje.
7. Se não houver, deve aparecer claramente `Nenhuma conta vencendo hoje.` — nunca um painel vazio.

## Critério de aceite

Não considerar a rodada homologada se houver erro no Console, toast contraditório ou valor que muda novamente após reabrir/recarregar a página.
