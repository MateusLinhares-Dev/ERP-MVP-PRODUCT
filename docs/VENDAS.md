# Vendas (saídas)

Tela React em `web/modules/sales/`, montada na aba **Vendas** por `web/erp/sales.tsx`. Usa o mesmo layout do Pedido de compra (`phase4-po-*`).

## Abas

| Aba | O que mostra |
|---|---|
| Pesagens a fechar | Pesagens de **venda** da Balança Rodoviária já finalizadas (`tipo: 'venda'`, `_balFinalizado`, status `Aguard. Preço`) que ainda não viraram pedido. "Abrir pedido" traz cliente, materiais e pesos. As com mais de 15 dias ficam atrás do botão "Mostrar N pesagens" (antes desta tela nenhuma pesagem de venda virava pedido, então as antigas já foram lançadas à mão). "✓ Já lançada" tira a pesagem da fila (`vendaArquivada` no ticket). |
| Lançamento | Pedido de venda na própria aba: cliente, itens, observações, totais, detalhes e recebimento. |
| Histórico | Todas as vendas com filtros (situação, cliente, período, busca), totais do período, impressão da lista e ações por linha. |

## Regras do pedido

- **Itens:** linha com quantidade precisa de material e preço. O preço vem da tabela de preços do cliente quando estiver vazio. Itens vindos de pesagem têm a quantidade travada; para tirar, remova a pesagem do pedido.
- **Estoque:** se a quantidade passar do disponível, a tela avisa e pede confirmação ao salvar (a venda pode deixar o estoque negativo, como antes).
- **Total:** soma das linhas (em centavos) − desconto + frete/acréscimos.
- **Número:** se ficar vazio, a venda recebe o próximo `V0001`, `V0002`...
- **Abatimentos:** adiantamentos e cheques pendentes do cliente. Cheques entram primeiro e só inteiros; adiantamento pode ser usado em parte (o resto continua disponível). Ao gravar, a tela confere de novo se o adiantamento/cheque ainda está disponível.
- **Parcelas:** cobrem o saldo depois dos abatimentos. Condição "0 30 60" ou "3x" gera as parcelas; a última é sempre calculada. A soma precisa bater com o saldo.
  - "Recebido" marcado = conta a receber já recebida. Com conta bancária escolhida, o valor entra no saldo do banco (respeitando a data de corte de movimentação bancária).
  - "A prazo" não pode estar recebido; "Permuta" já entra como recebida e sem banco.
- **Situação da venda:** `Pago` (nada pendente), `Permuta` (tudo recebido em permuta), `A prazo` (todas as parcelas abertas vencem depois da data da venda) ou `Pendente`.

## Editar

- Recebimentos já lançados (inclusive abatimentos) aparecem travados; estorno é em Contas a Receber.
- Com recebimento ou abatimento, o cliente não pode ser trocado.
- As parcelas pendentes viram linhas editáveis e mantêm o mesmo lançamento em Contas a Receber; parcela removida apaga a conta pendente correspondente.
- O total não pode ficar menor do que já foi recebido.

## Excluir

Usa a regra antiga (`excluirVenda`): devolve adiantamentos e cheques ao cliente, apaga as contas a receber da venda e, agora, devolve a pesagem para "Pesagens a fechar".

## Gravação (servidor)

Tudo passa por `POST /api/finance/sales` (`server/modules/sales`), com permissão `canSales`:

| Ação | O que faz |
|---|---|
| `save` | Recebe o **pedido** (cliente, itens, parcelas, abatimentos escolhidos, pesagens). O servidor relê do banco o que já foi recebido, os adiantamentos e cheques do cliente, as contas bancárias e as pesagens; valida com a mesma regra da tela (`server/modules/sales/domain`) e grava numa operação só: venda, contas a receber (novas, alteradas e removidas), adiantamentos/cheques usados, lançamentos de banco (`LB-VD-…`, ligados à conta a receber por `movBancoId`) e o vínculo com a pesagem. Número `V0001`… vem de `salesNumberSeq`. |
| `delete` | Devolve adiantamentos e cheques, apaga as contas a receber e os lançamentos de banco que a venda criou e solta a pesagem. |
| `mark-paid` / `reopen` | Baixa ou reabre as parcelas (não mexe em adiantamento/cheque). Reabrir desfaz o lançamento de banco ligado. |
| `archive-weighing` | "✓ Já lançada": tira a pesagem da fila. |

- **Trava:** cada operação segura a venda e o cliente (`erpSalesLocks`) por até 2 minutos; uma segunda tela recebe "Outra operação desta venda ou deste cliente está em andamento".
- **Conflito:** editar uma venda que mudou em outra tela (`atualizadoEm` diferente) é recusado.
- **Repetição:** cada chamada leva um `operationId`; repetir a mesma devolve o resultado guardado (`salesOperations`), sem gravar de novo.
- **Exclusões** gravam `vendasDeletedV2`, `contasReceberDeletedV2` e `lancBancoDeletedV2`, para uma tela aberta não trazer de volta o que foi apagado.
- **Regras do Firebase:** `vendas`, `vendasDeleted` e `vendasDeletedV2` só pelo servidor; `contasReceber` ganhou índice por `vendaId` e `cli`. A sincronização do navegador não grava mais vendas e ignora os lançamentos `LB-VD-`.
- O vínculo com a pesagem agora funciona também para quem tem Vendas e não tem Compras (antes o navegador não tinha permissão de gravar na pesagem).

## Impressão

"🖨️" no histórico abre o **Pedido de venda Nº ...** no padrão da notinha de compra (`web/shared/print/order-print.ts`): empresa, cliente, itens, totais, situação financeira, parcelas e observações.

## Testes

- `test/sales-web.test.js`: regras do pedido (totais, parcelas, abatimentos, edição, histórico, pesagens, estoque).
- `test/sales-abatements.test.js`: devolução de abatimentos na exclusão e conferência na gravação.
