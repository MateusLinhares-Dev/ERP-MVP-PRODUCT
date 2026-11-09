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

## Revisão adicional — 08/11 (noite)

| # | Problema | Correção |
|---|----------|----------|
| 8 | Datas de "hoje" usavam UTC: entre 21h e 23h59 compras, baixas, pagamentos e vencimentos eram gravados com a data de **amanhã** (88 pontos no navegador + edição de compra no servidor). | Navegador usa `_hojeISO()`/data local; servidor usa `server/domain/business-date.js` (America/Sao_Paulo). |
| 9 | Um adiantamento com "Vinculado ao Ticket" inexistente (digitação ou compra futura) **bloqueava todas as compras** do fornecedor. | O adiantamento deixa de ser oferecido e aparece um aviso explicando como liberar; as demais compras seguem. Adiantamento vinculado ao número da própria compra em criação é oferecido. |
| 10 | Excluir, no Controle de Cheques, um cheque que pertence a um adiantamento deixava o adiantamento sem os cheques e impossível de excluir. | Exclusão bloqueada com orientação: excluir pelo módulo Adiantamentos. |
| 11 | Compensar cheque de adiantamento: a tela perguntava se "já baixou do banco" (nunca baixou: a API não lança saída para cheques); na remessa, cheque próprio de adiantamento nunca saía do saldo. | Decisão automática: cheque próprio baixa o banco na compensação; cheque de terceiro não baixa; adiantamento com movimento bancário não baixa de novo. Cheques legados continuam com a pergunta. |
| 12 | Excluir adiantamento com cheque já compensado dava "cheque vinculado foi alterado". | Mensagem clara: reabrir o cheque em "Cheques a compensar" e então excluir. |
| 13 | Microfone bloqueado no site inteiro (`Permissions-Policy: microphone=()`). | `microphone=(self)`. |
| 14 | Reduzir o valor de uma compra paga com adiantamento era sempre recusado ("exige conciliação"). | A diferença volta ao adiantamento usado. Ele volta a "Pendente" com saldo disponível, e a conta a pagar em aberto é encerrada. Continua bloqueado, com mensagem clara: redução maior que o valor pago com adiantamento (parte paga no banco), compra paga com cheque ou crédito residual, ou adiantamento alterado depois da compra. |
| 15 | Compra paga com adiantamento nunca podia ser excluída. | Exclusão permitida quando não há pagamento no banco: devolve todo o valor aos adiantamentos no mesmo commit. A tela mostra quanto voltou e para qual adiantamento. |
| 16 | Quem tem "Cheques (Controle)" sem acesso a "Bancos" compensava cheque e a saída no extrato era descartada em silêncio. | Aviso claro de que a saída não foi lançada. Reabrir ou excluir cheque que já saiu do banco exige acesso a Bancos. |
| 17 | Exclusão de compra bloqueada mostrava sempre um texto genérico. | Mostra o motivo real enviado pelo servidor. |

Regras do Firebase: nada a publicar.
- As lápides `*DeletedV2` são só lidas pelo navegador. O único trecho que tentava apagar uma delas pertence ao formulário antigo de compra, substituído pelo módulo novo.
- Os nós novos (`quickEntries`, `quickUploads`, `erpQuickLocks`) ficam fechados para o navegador por padrão.
