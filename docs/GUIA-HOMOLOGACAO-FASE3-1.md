# Guia de homologação — Fase 3.1

Faça os testes na HML e dê `Ctrl+F5` depois do deploy.

## 1. Compra Sucata — ticket e campos transitórios

1. Abra `Compra Sucata > Histórico`.
2. Clique no lápis de um ticket, por exemplo `T827734`.
3. O editor deve abrir sem “Ticket não encontrado”.
4. Feche e abra outro ticket.
5. Digite um valor no bloco verde `Valor (R$)` e um motivo, sem salvar.
6. Feche e abra outro ticket.
7. Os dois campos precisam estar vazios.
8. Digite uma observação de material e role a tabela para baixo/lado.
9. A coluna Observação precisa continuar visível.
10. Feche, abra novamente e confirme que a observação persistiu.

## 2. Bancos múltiplos

1. Abra Fornecedor e depois Cliente.
2. Abra `Bancos`.
3. Passe o mouse sobre `+ Adicionar conta`, `X`, `Cancelar` e `Salvar contas`.
4. O cursor deve indicar ação clicável.
5. Adicione duas contas, salve, dê F5 e confirme persistência.

## 3. Calendário novo

1. Abra `Calendário`.
2. Não deve existir a seção “Registros antigos do antigo Afazeres”.
3. Em `Por datas`, informe por exemplo `01/10/2026` até `30/11/2026`.
4. O painel `Agendas encontradas` deve mostrar todos os compromissos do intervalo, independentemente do dia selecionado no calendário.
5. Troque para `Por meses` e filtre `10/2026` até `12/2026`.
6. Teste `Responsável` e busca por texto.
7. Limpe os filtros e confirme que a agenda volta a mostrar todos os registros.
8. Crie um compromisso para outro usuário e confirme o responsável no card.

### Avisos por usuário

1. Como Elaine/admin, crie compromissos para um usuário teste em +1, +3 e +5 dias.
2. Saia e entre com esse usuário.
3. Em `Avisos`, devem aparecer apenas os compromissos dele dentro da janela.
4. O popup deve disparar nos marcos de 5, 3 e 1 dia, uma vez por dia/evento.

## 4. Preços Fornecedor / Cliente

1. Abra `Preços Forn.`.
2. Não deve existir barra separada “Procurar fornecedor” criada pela Fase 2.
3. Clique na própria lista pesquisável e digite parte do nome, por exemplo `TESTE`.
4. A lista deve mostrar somente fornecedores correspondentes.
5. Pressione Enter ou clique no resultado e confirme o carregamento dos preços.
6. Repita em `Preços Clientes`.
7. A pesquisa de material da tabela continua separada e deve funcionar normalmente.

## 5. Cheques

1. Abra `Cheques (Controle)` em `Todos`.
2. Se o KPI disser `1` cheque, a linha desse cheque deve estar visível. A tabela não pode desaparecer.
3. Caso seja o cheque antigo `198`, exclua pela interface e confirme.
4. Dê F5. KPIs e lista precisam permanecer zerados se não existir mais cheque.
5. Clique em `+ Novo Cheque`.
6. `Data de Saída`, `Vencimento` e `Caiu em` precisam abrir calendário do navegador.
7. Cadastre `198` e depois `200` no mesmo banco: o sistema deve apontar `199` faltando.

## 6. Contas da Dona

1. Clique em `Contas da Dona`.
2. O módulo precisa abrir imediatamente.
3. Troque o mês, filtre por status e abra uma conta.
4. Salve uma conta e dê F5 para confirmar persistência.

## 7. Adiantamento vinculado à compra

Use um ticket com snapshot financeiro conhecido.

### Caso A — valor adicional

1. Abra o ticket e anote o adiantamento atual, por exemplo `R$ 120,00`.
2. Em `Adiantamentos`, lance `R$ 10,00` para o mesmo fornecedor e selecione esse ticket em `Compra relacionada`.
3. Volte ao Histórico da Compra.
4. O adiantamento deve ficar `R$ 130,00`.
5. O saldo da compra e a Conta a Pagar precisam diminuir R$ 10,00.
6. Dê F5 e confirme os mesmos valores.

### Caso B — T827734

Se o snapshot original era R$ 234,00 e existe um novo adiantamento externo de R$ 375,00, o esperado é R$ 609,00, sem duplicar os R$ 234,00 já usados no fechamento.

## 8. Viagem Motorista

1. Abra uma viagem existente e clique em editar.
2. Deve existir `Gastos extras / supérfluos aprovados R$`.
3. Informe `125,50` e salve.
4. Abra novamente: deve continuar `125,50`.
5. Confirme que o histórico/resumo reflete o gasto.

## 9. Coordenação

1. Abra `Coordenação > Reuniões / DDS`.
2. Participantes devem aparecer em cards separados, não grudados.
3. Confirme todos os funcionários ativos e nenhum inativo.
4. Faça a mesma conferência em `Advertências`.

## Console

Durante os testes deixe o F12 aberto. Não devem aparecer erros novos como:

- `ReferenceError`
- `TypeError`
- `PERMISSION_DENIED`
- `permission_denied`

Erros de regra/claim devem ser tratados separadamente do comportamento visual.
