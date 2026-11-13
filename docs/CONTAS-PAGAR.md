# Contas a Pagar

## O que grava pelo servidor

| Rota | Ação | O que faz |
|---|---|---|
| `POST /api/finance/payables` | `create` | Lança uma conta pendente. Com `installments` (`count`, `day`, `firstMonth` no formato `AAAA-MM`), lança as parcelas do mesmo grupo (`grupoId`, `totalParcelas`). Dia maior que o fim do mês cai no último dia (31 → 28/02). |
| | `update` | Muda descrição, credor, categoria, empresa, conta bancária, vencimento, valor, observação e forma prevista. **Não muda a situação**: pagar é pelo ✅ Pagar e desfazer é pelo histórico (🕒). Conta paga não muda o valor. Recusa se outra tela mudou a conta (`expectedUpdate` = `_upd`). |
| | `delete` | Exclui uma ou várias (`ids`, até 200), com marca em `contasPagarDeleted`. Recusa o lote inteiro se tiver conta de pedido de compra, e recusa conta que tem pagamento (exclua o pagamento no histórico antes). |
| `POST /api/finance/payables-payment` | pagar / `reverse` | Pagamento (banco e/ou adiantamento) e exclusão de pagamento. Já existia. |
| `GET /api/finance/payables-status` | | Confere se um pagamento enviado foi gravado. |

- Permissão: `canPayables` ou `canFinance`.
- Trava por conta em `erpFinancePayableLocks/<id>`, a mesma do pagamento: editar ou excluir enquanto um pagamento está em andamento devolve "em uso".
- `operationId` evita gravar duas vezes (`erp/payableOperations`, fechado nas regras).
- Conta de pedido de compra (`CPPO_…`, ou ticket com `_purchaseOperationId`) só muda pelo Histórico de compras.
- Conta gravada no formato antigo (lista com índice) é achada pelo `id`.

## O que ainda grava pelo navegador

A sincronização do navegador continua mandando `contasPagar` criadas por outras telas, até cada uma passar para o servidor:

- Folha de pagamento (`fecharFolha`), Despesas do grupo (`salvarDespesa`), Combustível (posto e tanque), Contratos (`salvarContrato`), Contas fixas (`phase1FixedGenerate`);
- detalhe da compra antiga (`adicionarItemTicket`, `lancarValorCompra`, `salvarCompra`) e a parte local de `csConfirmarEntrada`.

Por isso as regras ainda não fecham `contasPagar` para o navegador. A sincronização só reenvia o que mudou (`_fbFiltrarJaEnviado`), e é assim que o pagamento pelo servidor já convivia com ela.

## Tela

Ainda é a tela antiga (`renderContasPagar`), chamando a API por `_cpApi` / `window.erpPayablesRequest`:

- o formulário de nova conta não tem mais "Status": toda conta nasce pendente;
- a edição mostra a situação, mas não a muda, e trava o valor de conta paga;
- excluir (uma, parcelas do grupo, selecionadas) passa pela API.

Próximo passo: a tela em React.
