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

## Desfazer pagamento e excluir compra paga

Ordem: **🕒 Excluir o pagamento → excluir a compra no Histórico de compras → excluir o adiantamento** (se for o caso).

- O 🕒 desfaz pagamentos no banco e com adiantamento (desde a v236). Com adiantamento, o valor volta para o adiantamento do fornecedor: volta a "Pendente", sem vínculo com a compra; uso parcial devolve o valor ao adiantamento de origem e apaga a parte dividida.
- Pagamentos novos guardam quais adiantamentos usaram (`adtUsos`). Nos antigos, o servidor acha os adiantamentos pela marca "Compensado em CP <data>" ou pela parte dividida (`compensacao_cp`) da mesma compra e data, e só desfaz se a soma bater exatamente. Se não bater, ou se o adiantamento foi usado de novo depois, recusa sem alterar nada (`ADVANCE_REVERSAL_UNSAFE`): desfaça antes o pagamento mais recente.
- A exclusão de compra não considera mais "paga" uma conta só porque tem banco gravado (`bancoCod`), e o registro histórico de pagamentos só bloqueia se sobrar pagamento sem estorno.
- Compra com adiantamento marcado na hora do lançamento (sem pagamento depois) se exclui direto, e o adiantamento volta.
- Ainda não se desfazem pela tela: compra paga com cheque ou com crédito do fornecedor no lançamento.

## O que ainda grava pelo navegador

A sincronização do navegador continua mandando `contasPagar` criadas por outras telas, até cada uma passar para o servidor:

- Folha de pagamento (`fecharFolha`), Despesas do grupo (`salvarDespesa`), Combustível (posto e tanque), Contratos (`salvarContrato`), Contas fixas (`phase1FixedGenerate`);
- detalhe da compra antiga (`adicionarItemTicket`, `lancarValorCompra`, `salvarCompra`) e a parte local de `csConfirmarEntrada`.

Por isso as regras ainda não fecham `contasPagar` para o navegador. A sincronização só reenvia o que mudou (`_fbFiltrarJaEnviado`), e é assim que o pagamento pelo servidor já convivia com ela.

## Tela (React)

`web/modules/payables/`, ligada em `web/erp/payables.tsx` e montada em `#contas-pagar-app`.

- **Topo:** "Vencem hoje" (recolhível) e os cartões: a pagar no mês, vence hoje, atrasadas e pagas no mês. O valor pago conta o que saiu do banco mais o adiantamento compensado.
- **Calendário** (abre e fecha): dias com contas em aberto, com quantidade e total. Clicar num dia limpa os outros filtros e mostra só aquele dia.
- **Filtros:**
  - tipo: Todos, Fornecedores (compra), Despesas;
  - mês (‹ ›, ou todos os meses) e empresa;
  - em "Mais filtros": situação, categoria, forma de pagamento e valor mínimo/máximo;
  - busca sem acento e período de vencimento (o período solta o mês);
  - dias como atalho.
- **Tabela:** agrupada por dia com o total do dia; em Despesas, também por empresa, na ordem da configuração. Paginada.
- **Ações por linha:**
  - ✏️ editar;
  - ✅ pagar e 🕒 histórico de pagamentos: ainda abrem as janelas antigas (`pagarContaRapido`, `verHistoricoPagamentosCP`);
  - 🗑 excluir: em parcela de grupo, pergunta "só esta / esta + pendentes / todas"; parcelas com pagamento ficam.
- **Seleção e exclusão em lote:** conta de pedido de compra ou com pagamento é barrada na tela antes de ir ao servidor.
- **Lançar/editar:** lançar pode ser avulsa ou parcelada, com prévia das datas. O credor tem lista de sugestões (fornecedores de compra ou de despesa) e aceita texto livre. Ao escolher o banco, a empresa é preenchida. A edição não muda a situação e não reenvia o valor de conta paga.
- **Regras puras** em `web/modules/payables/domain/payables.ts`, testadas em `test/payables-web.test.js`. As datas das parcelas vêm da mesma regra do servidor (`server/modules/payables/domain/payable-rules.ts`).
- **Do código antigo ficou** o que a ilha usa por `window`:
  - `erpPayablesList` e `erpPayablesRequest`;
  - `erpPayablesCompanyOf` (`_cpEmpresa`) e `erpPayablesFromPurchase`;
  - `erpPayablesHygiene` (limpeza de duplicadas, que rodava a cada desenho);
  - `erpPayablesSuppliers`, `erpPayablesPay` e `erpPayablesOnlyPurchases` (perfil que só vê compras);
  - `erpFinanceCompanies` e `erpFinanceCompanyColor`.
- Saíram os remendos da phase3 (calendário, período, vencimentos de hoje), e a phase2 não mexe mais na aba.

Próximo passo: pagar e histórico de pagamentos em React; depois, levar para o servidor quem ainda cria conta a pagar pelo navegador.
