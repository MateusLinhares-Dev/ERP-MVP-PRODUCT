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

## Adiantamentos e cheques de clientes só pelo servidor (18/11/2026, v249)

Antes, a tela gravava `adtCli` e `chequesCli` e o servidor (vendas e recebimentos) também. Um computador com a lista desatualizada podia desfazer o que uma venda marcou. Agora só a API `POST /api/finance/client-credits` (`server/modules/receivables/application/client-credits.ts`) grava. Ela usa a mesma trava por cliente das vendas e dos recebimentos (`customerLockPath`), e as regras fecham os dois nós para o navegador.

| Ação | Tela |
|---|---|
| `create-advance`, `delete-advance` | Adiantamentos → Adiantamento de Cliente (+ e 🗑) |
| `create-cheques` | + Lançar Cheque (vários de uma vez, inclusive da planilha) |
| `update-cheque` | ✏️ do cheque |
| `cycle-cheque-status` | 🔄 do cheque (Pendente → Compensado → Devolvido → Pago após devolução), com motivo na devolução |
| `delete-cheque` | 🗑 do cheque |

Problemas corrigidos:
- **🔄 em cheque usado em venda:** antes ele voltava para "Pendente" e ficava livre para outra venda, enquanto a primeira ainda contava com ele (uso em dobro). Agora o servidor recusa e diz para desfazer pela venda.
- **Excluir ou mudar número, banco ou valor** de cheque usado em venda, ou vindo de recebimento de conta a receber: recusado com o caminho certo (desfazer a venda ou estornar o recebimento). Emitente, observação e datas continuam editáveis, e o vínculo com a venda ou a NF é preservado.
- **Cheque localizado por número e banco** (e posição na lista), e não só pelo número. Dois cheques "850" de bancos diferentes não se confundem mais.
- **Vendas com cheques de mesmo número:** a referência do cheque passa a ser `número@banco` quando o número se repete no cliente (`chequeRefs`/`findChequeByRef` em `server/modules/sales/domain/sales.ts`). Antes, a venda somava os dois cheques e marcava só um como usado.
- Adiantamento de cliente exige cliente cadastrado. O código continua `ADTC…` (as vendas reconhecem esse formato).

Ordem de implantação: como as outras, só rodar `deploy:rules:prod` depois que todos estiverem na v249.
