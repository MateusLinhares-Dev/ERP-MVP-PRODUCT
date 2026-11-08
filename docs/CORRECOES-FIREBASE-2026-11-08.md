# Correções Firebase — 08/11/2026

Sintoma em produção: "o primeiro salvamento funciona, o segundo dá erro" em compras, adiantamentos,
pagamentos e repasses. Na Compra de Sucata: `POST /api/finance/purchase-order-create` → **500**
("Erro interno do servidor") e, na nova tentativa, **409** ("Esta compra está sendo alterada").

## Causas encontradas (todas reproduzidas com o SDK oficial)

| # | Causa | Efeito |
|---|-------|--------|
| 1 | `db.ref('')` é caminho inválido no SDK Admin (introduzido no commit `ff3e572`, 07/11). | Criar, editar (com mudança de valor) e excluir compra **sempre** lançavam exceção no commit final → 500. |
| 2 | Transação do RTDB recebe primeiro o cache local; sem listener ele é `null`. A liberação de trava `cur => cur?.owner===owner ? null : undefined` era **abortada sem ir ao servidor**. | Após qualquer falha a trava ficava presa 90–120 s → 409 em compras, adiantamentos, pagamentos; repasses travavam **até em sucesso**. |
| 3 | Na Vercel a instância é reaproveitada e o WebSocket do RTDB fica "meio morto". A transação em voo é rejeitada com `Error('disconnect')`. | 500 intermitente nas requisições seguintes, deixando a trava presa (causa 2). |
| 4 | Adiantamento pago em **cheque** era oferecido na tela de compra, mas o servidor recusava qualquer adiantamento com forma "cheque". | "Associar adiantamento" falhava com "já foi utilizado ou alterado". |
| 5 | Mesmas transações com cache frio no navegador (editar/excluir vale, conciliação "Desfazer", exclusão de serviço da agenda, índice da Matriz). | Editar vale sempre falhava; "Desfazer conciliação" falhava; não era possível recadastrar o mesmo curso após excluir. |
| 6 | Sincronizador legado gravava nós inteiros (`precosForn`, `precosCli`, `saldoDevedor`, `fiscal`...) no 1º salvamento da sessão; `fiscalSalvar()` fazia `set` do nó fiscal. | Uma sessão aberta apagava preços, saldos e dados fiscais salvos por outro usuário. |
| 7 | `_ts` exigido a ±10 min do servidor, mas o cliente usava o relógio do PC. | PC com relógio errado tinha **todos** os salvamentos recusados. |

## Correções

- `server/infrastructure/rtdb-transaction.js` (novo): `runTransaction` com listener ativo (cache aquecido) e
  repetição em `disconnect`/`set`/`maxretry`; `acquireLease` reentrante; `releaseLease` correto.
- `server/infrastructure/firebase-session.js` (novo) + `firebase-admin.js`: WebSocket novo a cada rajada de
  requisições e encerrado quando não há requisição ativa.
- `server/http/http.js`: erros do Firebase viram 503 `DATABASE_UNAVAILABLE` (repetível) ou 401 `SESSION_EXPIRED`,
  com mensagem clara, em vez de 500 genérico.
- Compras (`purchase-order-create/edit/delete`): `db.ref()` na raiz; travas liberadas corretamente; criação lê
  somente os registros necessários (não baixa mais todos os tickets/contas); adiantamento em cheque e adiantamento
  vinculado ao próprio pedido aceitos; `saldos` e `saldoDevedor` mantidos iguais ao consumir crédito residual.
- Adiantamentos, Contas a Pagar, Repasses (trava liberada no mesmo commit), Conferência de órfãos, Conciliação,
  Integração bancária, Agenda, Empresas, Matriz, Telemetria e limite de login: helpers acima.
- Navegador: `window.__erpRunTransaction` (vales, desmarcar compra paga, edição de pedido); repetição segura com o
  **mesmo** `operationId` (servidor idempotente) em instabilidade; mensagem real do servidor exibida; número de
  pedido renovado após `TICKET_EXISTS`; preços publicados após a compra; gravações por registro em vez de nó
  inteiro; `fiscalSalvar` por mês alterado; `_ts` com horário do servidor (`.info/serverTimeOffset`); bloqueio de
  exclusão de conta bancária com lançamentos/adiantamentos pendentes.
- Cache: `assetRevision`/`_APP_BUILD` atualizados (abas antigas recebem o aviso "Atualizar agora").

## Verificação

- `npm test`: 844 testes, 0 falhas (inclui os 6 que já falhavam antes por deriva de caminho).
- `test/firebase-sdk-integration.test.js` e `test/client-transactions-sdk.test.js`: SDK oficial contra servidor RTDB
  simulado (`test/support/fake-rtdb-server.mjs`) com cache frio, `datastale` e queda de conexão. Contra o código
  anterior, 10 de 12 cenários falham (reproduz os sintomas de produção); com as correções, todos passam.
- `npm run build`, `scripts/release-security-check.mjs`, `scripts/verify-deployment-artifacts.mjs`: OK.

## Publicação

1. Publicar HML (branch `hml`) e homologar: duas compras seguidas; compra com adiantamento PIX e em cheque;
   editar/excluir compra sem baixa; criar/excluir adiantamento duas vezes seguidas; baixa de conta a pagar;
   dois repasses seguidos; editar e excluir vale.
2. Publicar produção. Travas antigas deixadas pela versão anterior expiram sozinhas em até 2 minutos.
3. Cada usuário deve recarregar a página (o aviso de versão nova aparece automaticamente).

## Pendências que dependem de dados/configuração de produção

- "Contas da Dona" exige `admin` + `canOwnerBills` no token. Conferir se a usuária Elaine está marcada como
  administradora em Usuários e fazer novo login. Se o erro persistir, publicar as regras do repositório
  (`npm run deploy:rules:prod`, que já valida regras × política).
- Lápides `*DeletedV2` existem nas regras, mas não na política do cliente (exclusões funcionam pela remoção do
  registro). Avaliar habilitar em versão futura.
