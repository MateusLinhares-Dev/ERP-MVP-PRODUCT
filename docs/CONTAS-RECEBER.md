# Contas a Receber

Gravadas só pelo servidor: `POST /api/finance/receivables` (`server/modules/receivables`). Permissão `canReceivables` ou `canFinance`; o pagamento avulso da Ficha do cliente também aceita `canCustomers`.

| Ação | O que faz |
|---|---|
| `create` | Lança uma conta pendente. Com `received` (data, conta, forma), já nasce recebida: é o "Pagamento recebido" da Ficha do cliente. |
| `update` | Muda cliente, NF, valor, vencimento, observação, forma e vínculo fiscal. Conta de **venda** não muda valor nem cliente (isso é pela venda); conta **recebida** não muda valor (estorne antes). |
| `receive` | Dá baixa. Com conta bancária, cria o lançamento `LB-CR-…` no extrato (respeitando a data de corte) e guarda o vínculo em `movBancoId`. Com cheques, eles entram na lista de cheques do cliente como pendentes e a conta guarda `chequesRecebimento`. |
| `reopen` | **Estorna a baixa**: volta para pendente, desfaz o lançamento do banco (e limpa a conta bancária da linha) e tira os cheques da baixa. Se algum cheque já foi depositado ou devolvido, recusa. Abatimento de venda (adiantamento/cheque) se desfaz pela venda. |
| `delete` | Exclui (com `contasReceberDeletedV2`), desfazendo banco e cheques se estava recebida. Conta de venda se exclui pela venda. |

- Trava por conta (`erpReceivableLocks`) e por cliente (a mesma das vendas, porque baixa em cheque mexe na lista de cheques do cliente).
- `operationId` evita gravar duas vezes (`receivableOperations`).
- Regras do Firebase: `contasReceber`, `contasReceberDeleted(V2)` só pelo servidor. A sincronização do navegador não grava mais contas a receber e ignora os lançamentos `LB-CR-`.
- Também gravam contas a receber, pelo servidor: Vendas, Conciliação bancária ("Criar título financeiro") e Lançamento rápido.

## Tela (React)

`web/modules/receivables/`, ligada em `web/erp/receivables.tsx` e montada em `#contas-receber-app`.

- **Lista:** indicadores (em aberto, atrasados, pendentes, recebidos), situação em abas (Em aberto, Atrasados, Recebidos, Todos), busca sem acento (cliente, NF, observação, forma), faixa de vencimento e paginação. Linha vencida fica vermelha.
- **Ações por linha:** ✅ Receber, ↩ Estornar (recebida), ✏️ Editar, 🔗 Venda (conta de venda), 🧾 Fiscal (vínculo com o Cliente Fiscal, ✓ quando ligado) e 🗑️ Excluir (não aparece em conta de venda).
- **Lançar/editar:** cliente com lista dos cadastrados e "＋ Cadastrar" para cliente novo (pela API de clientes). Em conta de venda, cliente e valor ficam travados; em conta recebida, o valor fica travado e não é reenviado.
- **Baixa:** data, forma e conta bancária (vazio = dinheiro em caixa). Com cheques, a conta bancária trava, a forma vira Cheque e a tela mostra a soma e a diferença para o valor da conta.
- **Regras puras** em `web/modules/receivables/domain/receivables.ts` (linhas, indicadores, filtros, pedido de lançar/editar e de baixa), testadas em `test/receivables-web.test.js`.
- **Atalhos antigos continuam:** `om('conta_receber')`, `erpReceivablesOpen(cliente)`, `editContaReceber(i)` e `receberContaRapido(i)` abrem a tela nova. `excluirContaReceber(i)` e `estornarContaReceber(i)` perguntam e gravam sem trocar de aba (a Ficha do cliente usa) e devolvem uma Promise.
- Do código antigo ficaram só `_crApi` / `window.erpReceivablesRequest` (chamada à API e aplicação do resultado), `window.erpReceivablesList` e `window.erpBanks` (contas bancárias para a baixa). O injetor de botões da phase3 (`decorateReceivables`) saiu; o vínculo fiscal continua em `phase3ReceivableFiscal`.
