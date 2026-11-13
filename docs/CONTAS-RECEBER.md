# Contas a Receber

Gravadas só pelo servidor: `POST /api/finance/receivables` (`server/modules/receivables`). Permissão `canReceivables` ou `canFinance`; o pagamento avulso da Ficha do cliente também aceita `canCustomers`.

| Ação | O que faz |
|---|---|
| `create` | Lança uma conta pendente. Com `received` (data, conta, forma), já nasce recebida: é o "Pagamento recebido" da Ficha do cliente. |
| `update` | Muda cliente, NF, valor, vencimento, observação, forma e vínculo fiscal. Conta de **venda** não muda valor nem cliente (isso é pela venda); conta **recebida** não muda valor (estorne antes). |
| `receive` | Dá baixa. Com conta bancária, cria o lançamento `LB-CR-…` no extrato (respeitando a data de corte) e guarda o vínculo em `movBancoId`. Com cheques, eles entram na lista de cheques do cliente como pendentes e a conta guarda `chequesRecebimento`. |
| `reopen` | **Estorna a baixa** (novo): volta para pendente, desfaz o lançamento do banco e tira os cheques da baixa. Se algum cheque já foi depositado ou devolvido, recusa. Abatimento de venda (adiantamento/cheque) se desfaz pela venda. |
| `delete` | Exclui (com `contasReceberDeletedV2`), desfazendo banco e cheques se estava recebida. Conta de venda se exclui pela venda. |

- Trava por conta (`erpReceivableLocks`) e por cliente (a mesma das vendas, porque baixa em cheque mexe na lista de cheques do cliente).
- `operationId` evita gravar duas vezes (`receivableOperations`).
- Regras do Firebase: `contasReceber`, `contasReceberDeleted(V2)` só pelo servidor. A sincronização do navegador não grava mais contas a receber e ignora os lançamentos `LB-CR-`.
- Também gravam contas a receber, pelo servidor: Vendas, Conciliação bancária ("Criar título financeiro") e Lançamento rápido.

## Tela

Ainda é a tela antiga, chamando a API (`_crApi` / `window.erpReceivablesRequest`). Na lista, conta recebida ganhou o botão **↩ Estornar**. O modal de edição não muda mais situação, banco nem data de recebimento: isso é pela baixa e pelo estorno.
