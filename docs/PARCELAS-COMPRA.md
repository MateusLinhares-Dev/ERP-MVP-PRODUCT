# Parcelas do pedido de compra

Pedido da cliente (novembro de 2026): dividir o saldo de uma compra em parcelas, como no Bling. Exemplo: a NF de R$ 20.000 e duas TEDs. Cada parcela vira uma conta separada em **Contas a Pagar**, e a Elaine paga uma de cada vez.

## Na tela de compra

O quadro **Parcelas** fica no cartão **Pagamento**, abaixo dos adiantamentos.

- **Sem mexer em nada:** a compra tem uma parcela só, com o saldo inteiro, como antes.
- **Condição de pagamento + Gerar parcelas:**
  - `3x` (ou `3 parcelas`) cria 3 parcelas **todas no mesmo dia** (a data da 1ª parcela). Depois é só mudar a data de cada uma, se precisar;
  - `0 30 60` ou `0/30/60` cria parcelas com esses dias, contados da data da compra;
  - `à vista` ou `0` cria uma parcela na data da compra.

  O saldo é dividido igualmente entre as parcelas, e **+ Adicionar outra parcela** usa a mesma data da última.
- **Em cada linha:** Dias, Data, Valor, Forma (PIX, TED, Boleto, Dinheiro, Cheque, Depósito, Transferência) e Observação (ex.: "NF 4521"). Ao mudar os dias, a data muda junto, e o contrário também.
- **A última parcela é calculada pelo sistema:** saldo a pagar menos as outras. Ela fica cinza e não aceita edição. Se a soma das outras passar do saldo, aparece o aviso em vermelho e o pedido não salva.
- **+ Adicionar outra parcela** divide a última em duas. O **×** remove uma linha, e o valor dela volta para a última.
- Se o total da compra ou os adiantamentos mudarem, a última parcela se ajusta sozinha.

## Em Contas a Pagar

| Parcelas | Contas criadas |
|---|---|
| 1 | `CPPO_<pedido>` (igual a antes) |
| 2 ou mais | `CPPO_<pedido>-1`, `CPPO_<pedido>-2`, … com a descrição "… — parcela 2/3" |

- Cada conta tem o vencimento e o valor da parcela.
- Também guarda a **forma prevista**, que aparece na lista e na janela de baixa, e a observação da parcela.
- Ao pagar uma parcela, o saldo do pedido diminui e a situação fica **Parcial**. Ao pagar a última, fica **Pago**.
- No Histórico de compras, o botão de baixa abre a **próxima parcela em aberto**.

## Notinha que fecha depois (pagamento parcial)

Caso comum: a notinha é lançada, mas só fecha no dia seguinte (o material ainda vai ser classificado). Enquanto isso, a Elaine manda um valor ao fornecedor.

1. Lance a notinha normalmente. Não precisa criar parcela para o valor que vai ser mandado.
2. Quando o dinheiro sair, abra **Financeiro → Contas a Pagar**, ache a conta da notinha e use **Pagar** só com o valor enviado. A conta continua em aberto com o restante, e a notinha fica **Parcial**.
3. No dia seguinte, **edite a notinha** com os pesos e preços finais. O restante em Contas a Pagar é recalculado sozinho, descontando o que já foi pago:
   - com uma parcela, a própria conta muda;
   - com várias, muda a última parcela em aberto.
4. Pague o restante em Contas a Pagar.

- **Adiantamento** é para dinheiro mandado **antes** de existir a notinha. Ele é aplicado quando a notinha é lançada.
- Se um adiantamento foi lançado **depois** da notinha, ele não é puxado ao editar a notinha. Use-o em Contas a Pagar, na baixa da conta, com **Compensar adiantamento**.
- Não registre o mesmo dinheiro das duas formas (pagamento **e** adiantamento): o abatimento dobra.
- Teste do fluxo completo: `test/purchase-installments.test.js` ("fluxo do cliente").

## Editar e excluir

- **Trocar o fornecedor de um pedido salvo:** na edição, escolha outro fornecedor e salve. O número do pedido continua o mesmo, e as contas a pagar passam para o novo fornecedor. Isso só é bloqueado quando a compra já usou adiantamento, cheque ou crédito do fornecedor atual, ou já tem pagamento. Nesse caso o dinheiro está ligado ao fornecedor antigo: exclua o pedido (o valor volta para o adiantamento) e lance de novo.

- **Sem nenhuma parcela paga:** dá para mudar valores, datas, formas e a quantidade de parcelas. O servidor refaz as contas a pagar numa gravação única:
  - recria as que mudaram;
  - apaga as que sobraram;
  - nunca duplica.
- **Com alguma parcela paga (ou abatida em parte)** (desde 10/11/2026):
  - as parcelas ficam travadas na tela: não dá para mudar datas, formas ou quantidade;
  - **o valor da compra pode mudar**: a diferença vai para a **última parcela em aberto**, e as parcelas pagas não mudam;
  - se a redução for maior que essa parcela, a edição é recusada (`INSTALLMENT_ADJUST_EXCEEDS_OPEN`). Ajuste em Contas a Pagar ou estorne um pagamento antes;
  - regra pura em `shiftOpenInstallment` (`server/modules/purchases/domain/purchase-edit.ts`).
- **Compra já quitada** que teve o total aumentado: a diferença vira uma conta única de ajuste, como antes. Não dá para parcelar essa diferença.
- **Reduzir uma compra paga com adiantamento** abaixo do valor do adiantamento: a diferença volta para o adiantamento e as parcelas são apagadas.
- **Excluir a compra:** remove todas as parcelas, desde que nenhuma tenha sido paga.

## Proteções na tela (correção de 09/11/2026)

O servidor é a única fonte das contas de um pedido (`CPPO_…`). Rotinas antigas da tela mexiam nelas sozinhas, e isso foi corrigido:

- **Reconciliação automática de adiantamentos** (`phase3-homologation.js`): ignorava as parcelas e gravava o saldo inteiro do pedido na 1ª conta. Também podia mostrar uma compra já paga como "Pendente". Agora não mexe em compras confirmadas pelo servidor (`_purchaseOperationId`).
- **Limpeza de "duplicatas"** (`_cpAutoLimparDuplicatas`): apagava parcelas de mesmo valor (ex.: duas de R$ 18,94). Agora ignora contas `CPPO_…` e parcelas.
- **Marcas de excluída** (`contasPagarDeleted`):
  - a tela não envia nem aceita do Firebase marcas para contas `CPPO_…`, porque quem apaga essas contas é só o servidor, ao excluir ou editar o pedido;
  - a tela só guarda a marca, sem enviar, depois de uma exclusão de pedido confirmada pelo servidor;
  - uma parcela escondida por marca antiga volta a aparecer.
- **Lixeira de Contas a Pagar e detalhe antigo da compra** (corrigir adiantamento, adicionar item, valor extra): para pedidos do servidor, mostram aviso para usar o Histórico de compras.

Testes: `test/purchase-installments-client-guards.test.js`.

## Notinha (impressão do pedido)

- **Adiantamentos e abatimentos:** colunas Data, Origem, **Forma**, **Valor do adiantamento** (o valor cheio que o fornecedor recebeu) e **Valor aplicado** (o que foi abatido nesta compra). A coluna "Referência / forma" virou **Forma**. Os códigos internos (`ADT…`) não aparecem mais. Cheque aparece como "Cheque nº 000123".
- **Parcelas:** colunas Dias, Data Vencimento, Valor, **Forma** e Observações. Uma parcela já paga mostra "Paga" na observação. Uma parcela abatida em parte (pagamento ou compensação de adiantamento) mostra "Abatido R$ X · resta R$ Y".

## Técnico

- **Regra pura:** `server/modules/purchases/domain/installments.ts`.
  - `normalizeInstallments`: valida as parcelas e calcula a última;
  - `installmentPayableIds`, `installmentPayables`, `installmentSignature`.
- **Criação** (`create-purchase-order.js`): lê `ticket.parcelas` e grava `ticket.parcelas`, `vencimentoSaldo` = 1ª parcela, e uma conta por parcela. A resposta traz `payables` (todas) e `payable` (a primeira).
- **Edição** (`edit-purchase-order.js`):
  - trava o pedido e cada conta envolvida (`erpFinancePayableLocks/<id>`), e o pagamento usa as mesmas travas;
  - a resposta traz `payables` e `removedPayableIds`.
- **Exclusão** (`delete-purchase-order.js`): aceita as N contas do pedido conforme `ticket.parcelas`.
- **Baixa** (`payables.js`): a conferência de uma parcela paga não exige o pedido inteiro pago.
- **Tela:** `public/modules/purchase-order/purchase-order.js`, funções `phase4PurchaseGenerateInstallments`, `phase4PurchaseInstallment`, `phase4PurchaseAddInstallment` e `phase4PurchaseRemoveInstallment`. O campo oculto `cs-lanc-venc` continua com o vencimento da 1ª parcela para o código antigo.
- **Compatibilidade:** pedidos antigos sem `parcelas` funcionam como uma parcela única. Uma tela antiga ainda aberta durante a publicação também continua funcionando, porque o servidor recalcula a última parcela.
- **Testes:**
  - `test/purchase-installments.test.js`: regra, SDK real contra o banco simulado (criar, pagar parcela por parcela, editar 3→2→1→3, excluir, devolução ao adiantamento), tela e notinha;
  - `test/purchase-order-print.test.js`: sem códigos ADT na notinha.
