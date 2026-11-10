# Regras de cheques e de vendas (10/11/2026)

## Cheque repetido (adiantamentos)

Regra combinada com a cliente: **só não pode repetir o mesmo banco com o mesmo número de cheque.**

| Situação | Resultado |
|---|---|
| Sicredi nº 150 e Itaú nº 150 | Permitido (bancos diferentes) |
| Sicredi nº 150 duas vezes na mesma lista | Bloqueado: "Cheque repetido na lista … (linhas X e Y)" |
| Sicredi nº 150 já cadastrado em outro adiantamento | Bloqueado: "Cheque … já está cadastrado (adiantamento …)" |
| Banco "terceiro" / "Cheque de Terceiro" com o mesmo número | Permitido. O banco real não é conhecido, então a regra não se aplica |
| `0150` e `150` no mesmo banco | Considerados o mesmo cheque |
| Cheque cancelado ou excluído | Não impede cadastrar o mesmo banco e número de novo |

- Banco genérico é qualquer nome que contenha "terceiro", sem diferenciar acento ou maiúscula.
- Regra pura: `chequeIdentity` em `server/modules/advances/domain/advance-rules.ts`.
- Testes: `test/advance-banks-atomicity.test.js`.
- A confirmação "cheques de terceiro repetidos, confirme para continuar" deixou de existir. Agora o cheque é bloqueado (mesmo banco e número) ou permitido.

## Listas de cheques paginadas

- As três listas de cheques mostram 25 por página, com opção de 50 ou 100 e navegação "Anterior/Próxima": Cheques a compensar, Cheques de fornecedor e Cheques de cliente.
- A busca em "Cheques a compensar" procura em todos os cheques, e não só na página visível:
  - não diferencia acento nem maiúscula;
  - procura em número, cliente e banco;
  - volta para a página 1;
  - mantém o foco e o texto digitado.
- O filtro antigo do `phase2-feedback.js` só escondia linhas da tela e foi removido.

## Vendas: abatimento de adiantamento e cheque do cliente

- **Cheque** não pode ser usado em parte. Se for maior que o saldo da venda, a venda não é salva e a tela explica o motivo.
- **Adiantamento** pode ser usado em parte: usa só o que falta, e o restante continua disponível para o cliente (`valorOriginal` e histórico em `usos`). Antes, o adiantamento entrava pelo valor inteiro e o restante se perdia.
- Ordem: primeiro os pagamentos digitados, depois os cheques, depois os adiantamentos.
- A venda guarda os abatimentos usados em `abatimentos`.
- **Excluir a venda** devolve esses valores ao cliente. Em vendas antigas, sem esse registro, a devolução é deduzida pelas contas a receber da própria venda.
- Excluir usa o **código** da venda, e não a posição na lista. A reserva por cliente, valor e data só vale para contas a receber antigas sem `vendaId`.
- **Editar o valor** de uma venda agora grava a conta a receber ajustada. Antes, a mudança ficava só na memória e voltava ao valor antigo.
- Item sem material não é aceito, nem ao salvar nem ao editar.
- O aviso de estoque insuficiente só aparece depois que a venda foi realmente salva.
- Funções: `_vendaPlanejarAbatimentos`, `_vendaAplicarAbatimentos` e `_vendaRestaurarAbatimentos`, em `public/legacy/app-core.js`.
- Testes: `test/sales-abatements.test.js`.

## Pontos para combinar com a cliente

- **Cheque de cliente usado numa venda "Pago":**
  - hoje o movimento no banco é lançado na hora da venda, com o banco do cheque;
  - a compensação do cheque não lança nada no banco;
  - o mais correto seria lançar a entrada no banco quando o cheque compensa, na conta da empresa onde foi depositado;
  - mudar isso exige combinar o que fazer com as vendas antigas, para não contar em dobro.
- **Venda salva como "Pago" sem forma de pagamento:** não gera conta a receber. Se depois o valor aumentar na edição, a diferença não vira cobrança.
