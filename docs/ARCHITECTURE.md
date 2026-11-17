# Arquitetura

O ERP está migrando **por etapas** para TypeScript, com uma arquitetura modular em camadas. O sistema continua no ar durante a migração: cada etapa é publicada e testada, e o código antigo encolhe até sumir.

Decisões tomadas:

- **Servidor primeiro**, depois a interface.
- Interface nova em **React + Vite**.
- Código (arquivos, funções, variáveis) em **inglês**. Telas e mensagens ao usuário continuam em **português**.
- **Sem comentários** no código: os nomes e a estrutura explicam. Explicações maiores ficam nesta pasta `docs/`.

## Mapa do projeto

```
api/                      Endpoints da Vercel (finos: só declaram a rota e chamam o módulo)
server/
  shared/                 Núcleo usado por todos os módulos
    auth/identity.ts        Usuário logado e suas permissões (claims)
    config/                 Variáveis de ambiente e travas de segurança do ambiente
    domain/                 Tipos e funções puras comuns (datas de negócio...)
    errors/app-error.ts     AppError + fail(): erros com status HTTP e código
    firebase/               Firebase Admin, conexão serverless, transações e travas (leases)
    http/                   defineApi (rotas), autenticação, cabeçalhos de segurança, erros
    observability/          Logs estruturados e tracing
  modules/
    <módulo>/
      domain/               Regras de negócio puras: sem banco, sem HTTP, fáceis de testar
      application/          Casos de uso (o "o que fazer") + ports.ts (interfaces que precisam)
      infrastructure/       Implementações concretas: Realtime Database, Storage, Claude...
      index.ts              Composição: monta o módulo ligando application às implementações
web/                      Interface nova (React + Vite + TypeScript)
  pages/<tela>/index.html   Página de cada tela; o endereço publicado é /<tela>/
  shared/                   Peças comuns das telas
    auth/                     Login do Firebase (mesma sessão do ERP)
    http/api-client.ts        Chamadas à API com token, nova tentativa em 401 e mensagens de erro
    domain/                   Funções puras: texto, números digitados, formatos, ids
    ui/                       Ícones, aviso (toast) e ganchos (hooks) comuns
  modules/<tela>/
    domain/                   Regras puras da tela (testáveis com node:test)
    application/              Chamadas à API, sessão, voz, histórico do navegador
    ui/                       Componentes React e CSS
    main.tsx                  Ponto de entrada
public/                   Interface legada em JS (encolhe a cada etapa) + arquivos estáticos
vite.config.ts            Build das telas React para dist/ (chamado por scripts/build.mjs)
test/                     Testes (node:test, executados via tsx)
```

Módulos: `access` (login, usuários, permissões), `audit`, `company` (empresas e configuração), `suppliers`, `customers`, `sales`, `receivables`, `purchases`, `advances`, `payables`, `supplier-repasses`, `banking`, `quick-entry`, `agenda`, `training`, `help`, `fiscal`, `snapshots`.

## Regra de dependência

```
api  →  modules/<m>/index.ts  →  application  →  domain
                     ↓                ↓
              infrastructure  →  ports (interfaces)
                         tudo pode usar  shared/
```

- `domain` não importa nada de fora do próprio domínio (nem Firebase, nem HTTP).
- `application` depende de **interfaces** (`ports.ts`), nunca do Firebase direto. Por isso os testes trocam o banco por um falso sem mudar a regra.
- `infrastructure` implementa essas interfaces.
- `index.ts` é o **único** lugar que escolhe as implementações.
- `api/` não tem regra de negócio: declara método, permissão e limite, e chama o caso de uso.
- Um módulo usa outro pela fachada dele (`index.ts` ou um gateway em `ports.ts`), nunca pelos arquivos internos.

## Módulo de referência: `quick-entry`

Use como molde ao migrar os outros módulos:

| Arquivo | Papel |
|---|---|
| `domain/quick-entry.ts` | Tipos do lançamento, validação dos itens, totais, situação |
| `domain/ticket-number.ts` | Próximo número de pedido (função pura) |
| `domain/speech-interpretation.ts` | Aceita da IA só nomes que existem no cadastro |
| `application/ports.ts` | Interfaces: repositório, armazenamento de anexos, compras, IA, relógio |
| `application/quick-entry-service.ts` | Casos de uso: opções, compra, venda, histórico, anexos, interpretar fala |
| `infrastructure/rtdb-quick-entry-repository.ts` | Leituras e gravações no Realtime Database + trava do lançamento |
| `infrastructure/storage-attachment-store.ts` | Fotos e PDFs no Firebase Storage |
| `infrastructure/claude-speech-interpreter.ts` | Chamada ao Claude (opcional) |
| `index.ts` | `createQuickEntryModule()` |

## Como criar um endpoint novo

1. **Regra pura** em `server/modules/<m>/domain/` (com teste).
2. **Caso de uso** em `application/`, recebendo as dependências por construtor. Se precisar do banco, declare a interface em `ports.ts`.
3. **Implementação** da interface em `infrastructure/`.
4. **Ligação** no `index.ts` do módulo.
5. **Endpoint** em `api/<área>/<nome>.ts`:

```ts
import { defineApi } from '../../server/shared/http/api-handler.js';
import { createQuickEntryModule } from '../../server/modules/quick-entry/index.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 65536,
    handle: ({ identity, body }) => createQuickEntryModule().createSale(identity, body),
  },
});
```

`defineApi` já aplica:
- os cabeçalhos de segurança;
- o método permitido (405 nos outros);
- a origem (obrigatória em POST, opcional em GET);
- o JSON e o tamanho máximo do corpo;
- o login (`access: 'user' | 'admin' | 'engineer' | 'public'`);
- a conversão de erros em respostas padronizadas.

Para devolver um arquivo em vez de JSON, escreva na `res` e retorne `RAW_RESPONSE` (veja `api/quick/attachment.ts`).

6. **Erros:** use `fail(status, 'CODIGO', 'Mensagem para o usuário')`. O código é para a tela e a mensagem é exibida ao usuário.

## Convenções de código

- **TypeScript estrito:** `tsconfig.json` com `strict` e `noUncheckedIndexedAccess`. Evite `any`; dados do banco entram como `unknown` e são validados.
- **Imports relativos com extensão `.js`**, mesmo apontando para arquivos `.ts` ou `.tsx`. É o padrão NodeNext, aceito por `tsc`, `tsx`, Vite e Vercel. Vale também em `web/`.
- **Formatação:** Prettier, aplicado por `npm run format`.
- **Lint:** ESLint com `typescript-eslint` e a regra própria `erp/no-comments`, que impede comentários.
- **Dinheiro:** cálculos em **centavos** (inteiros) e conversão para reais só na saída.
- **Datas de negócio:** `businessTodayISO()`, no fuso de São Paulo. Nunca use `new Date().toISOString()` para "hoje".
- **Gravações com mais de um nó:** um único `db.ref().update({...})` multi-caminho, para que tudo grave ou nada grave.
- **Concorrência:** travas com `acquireLease`/`releaseLease` e transações com `runTransaction` (`shared/firebase/rtdb-transaction.ts`).

## Comandos

| Comando | O que faz |
|---|---|
| `npm run typecheck` | Verifica os tipos do servidor (`tsconfig.json`) e das telas (`web/tsconfig.json`) |
| `npm run lint` | ESLint (inclui a proibição de comentários) |
| `npm run format` | Formata `server/`, `api/` e `web/` (`.ts`, `.tsx`, `.css`, `.html`) |
| `npm test` | Todos os testes (node:test via tsx) |
| `npm run build` | Copia `public/` para `dist/` e roda o Vite, que gera as telas React |
| `npm run check` | Tudo acima + build. Rode antes de cada commit |
| `npm run check:release` | `check` + verificações de segurança e de deploy |

## Situação da migração

| Etapa | Escopo | Situação |
|---|---|---|
| 1 | Ferramentas (TS, ESLint, Prettier), remoção de comentários, nova estrutura de pastas, núcleo `shared/`, módulo `quick-entry` e `api/quick` em TS | **Concluída** |
| 2 | Servidor em TS: `access`, `audit`, `company`, `agenda`, `training`, `help`, `fiscal`, `snapshots` + endpoints `auth`, `admin`, `agenda`, `training`, `help`, `fiscal`, `engineering`, `config`, `public-config`, `health` | **Concluída** |
| 3 | Servidor em TS: `purchases`, `advances`, `payables`, `supplier-repasses`, `banking` (regras financeiras) + endpoints `api/finance` e `api/banking` | **Concluída** |
| 4 | Interface: base React + Vite + TS (`web/`); Lançamento rápido como primeira tela | **Concluída** |
| 5+ | Interface: substituir o `public/legacy/app-core.js` módulo a módulo (compras, financeiro, cadastros, RH, frota, fiscal), como **ilhas React** dentro do ERP | **Em andamento**: base das ilhas, Relatório de cheques, Central de Ajuda, Engenharia e Integrações bancárias |

Todo o servidor (`server/` e `api/`) está em TypeScript desde a etapa 3. Desde a etapa 5, o `allowJs` está desligado. O motor de conciliação bancária saiu de `public/` (só o servidor o usava) e virou `server/modules/banking/domain/reconciliation-engine.ts`.

### Etapa 5: ilhas React dentro do ERP

O ERP antigo continua sendo a "casca" (menu, abas, login, sincronização). Cada tela migrada vira uma **ilha React** montada dentro de um elemento da aba antiga. Assim a troca é feita tela por tela, sem parar o sistema.

- **Entrada:** `web/erp/islands.tsx`.
  - Monta cada tela no `id` do contêiner antigo.
  - Substitui as funções globais que os botões antigos chamam (por exemplo, `abrirRelatorioChequesAdiantamentos`).
- **Login:** `web/shared/auth/erp-session.ts` usa o usuário que o ERP já autenticou. As chamadas à API passam pelo mesmo `api-client.ts` do Lançamento rápido.
- **Build:**
  - o Vite gera `dist/web/erp-islands-<hash>.js` (com `manifest`);
  - o `scripts/build.mjs` grava esse caminho em `webIslandsEntry` no `dist/app/bootstrap.js`;
  - o `bootstrap.js` carrega as ilhas depois do ERP antigo; se falharem, o ERP continua funcionando;
  - o `verify-deployment-artifacts.mjs` reprova o deploy sem esse pacote.
- **Telas migradas:**
  - Relatório de cheques (`web/modules/cheque-report/`). O antigo `public/modules/finance/advance-cheque-report.js` foi removido.
  - Central de Ajuda (`web/modules/help-center/`). O antigo `public/modules/help-center/help-center.js` foi removido. O `final-ops.js` continua chamando `window.ERPHelpCenter.render(host)`, que agora monta a tela React.
  - Engenharia (`web/modules/engineering/`): logs de auditoria e editor da Central de Ajuda. O menu é criado pela ilha só para a conta técnica. A captura de erros da tela foi para `web/shared/observability/telemetry.ts`. O antigo `public/modules/engineering/engineering.js` foi removido.
  - Integrações bancárias (`web/modules/bank-integrations/`): janela de configuração do Pluggy. A função `window.erpBankIntegrationsOpen(bankCode)`, usada pela tela de Bancos e pela Conciliação, abre a versão React. O antigo `public/modules/banking/bank-integrations-ui.js` foi removido.
  - Repasses de caixa a fornecedor (`web/modules/supplier-repasses/`, ligado em `web/erp/supplier-repasses.tsx`):
    - janela "Dinheiro recebido / Valor a repassar", quadro em Contas a Pagar e indicador na Ficha do fornecedor;
    - `window.SupplierCashRepasse` (`flowTotal`, `refreshSummary`, `openForSupplier`) continua com a mesma interface para o fluxo de caixa;
    - a saída de banco do PIX entra no saldo na hora (`erpBankMovementAdded`) e aparece como "Automático" no extrato;
    - o antigo `public/modules/finance/supplier-cash-repasses.js` foi removido.
  - Conferência de adiantamento órfão (`web/modules/advance-review/`, ligado em `web/erp/advance-review.tsx`):
    - a janela "Conferir pagamento do adiantamento" é React (`window.ERPAdvanceReview.review`);
    - a fila de exclusão de adiantamentos continua em `public/modules/finance/advance-actions.js`, que delega a conferência e aplica o resultado (`applyOrphanResult`).
  - Fornecedores (`web/modules/suppliers/`, ligado em `web/erp/suppliers.tsx`):
    - a lista (busca sem acento e sem pontuação, paginação, seleção para excluir vários, botões Ficha, PIX, Bancos e Docs) entra em `#sforn-compra`;
    - o formulário (PF/PJ, máscaras, validação de CPF/CNPJ inclusive alfanumérico) entra no editor da casca de cadastros (`phase4-master-editor-fornecedores`);
    - os dois gravam pela API `master-data/suppliers`;
    - `renderTabelaFornecedores`, `editFornecedor`, `om('fornecedor')` e `phase4MasterCreate('fornecedor')` passaram a abrir a versão React;
    - saíram do `app-core.js`, `supplier-compat.js` e `master-data-forms.js` a lista e o formulário antigos;
    - continuam na tela antiga: Ficha do fornecedor, Documentos, Contas bancárias (`phase3OpenPartyBanks`) e Fornecedores de despesa.
  - Vendas (`web/modules/sales/`, ligado em `web/erp/sales.tsx`), no mesmo layout do Pedido de compra (detalhes em `docs/VENDAS.md`):
    - abas "Pesagens a fechar" (saídas da Balança Rodoviária), "Lançamento" (pedido de venda na própria aba, sem janela) e "Histórico" (filtros, totais do período, impressão da lista);
    - regras puras e testadas em `web/modules/sales/domain/` (totais, parcelas, abatimento de adiantamento e cheque, contas a receber de cada parcela, estoque);
    - grava pela API `finance/sales` (venda, contas a receber, abatimentos, banco e pesagem numa operação só, com trava por venda e cliente);
    - impressão do pedido de venda no padrão da notinha (`web/shared/print/order-print.ts`);
    - saíram do `app-core.js` o modal de venda, a edição em modal, o histórico antigo e o recebimento por linhas; saíram do `phase1-commercial.js` os remendos do modal;
    - `om('venda')`, `editVenda(i)`, `verVendaDoCR`, `fcLancarVenda` e `renderVendas` passaram a abrir ou redesenhar a versão React.
  - **CSS das telas React:** o Vite gera `dist/web/erp-islands-<hash>.css` e o `build.mjs` grava a lista em `webIslandsStyles` no `bootstrap.js`, que carrega o CSS antes das ilhas. O `verify-deployment-artifacts.mjs` reprova o deploy sem esse arquivo.
  - As telas React usam os mesmos ids e classes, então o CSS e os testes de tela continuaram valendo.
  - **Menus e redesenho:** quando outro computador grava, a sincronização redesenha a aba ativa. Menu suspenso que morre no redesenho fecha sozinho (foi o defeito do "Mais" em Contas bancárias, 13/11/2026). Menus soltos na página devem se prender de novo ao botão após o redesenho, e a recarga é adiada enquanto um menu listado em `_FB_MENUS_ABERTOS` (`firebase-sync.js`) estiver aberto.
  - **Cuidado ao migrar:** scripts antigos que rodam a cada mudança na tela (`apply()` do phase1/phase2/phase3) podem inserir ou remover elementos dentro do contêiner da ilha. O React quebra ("insertBefore") e a tela some. Antes de montar uma ilha, procure no `public/` quem mexe naquele contêiner (`removeByText`, `decorate...`, `tableSearch`) e tire o contêiner dessas rotinas.
  - Clientes (`web/modules/customers/`, ligado em `web/erp/customers.tsx`): lista em `#clientes-app` e formulário no editor da casca de cadastros, gravando pela API `master-data/customers` (detalhes em `docs/CLIENTES-API.md`). Trocar o nome leva o histórico junto.
  - **Cadastro de pessoa comum:** `web/shared/domain/party.ts` (campos, validação de CPF/CNPJ, envio) e `web/shared/ui/PartyFormView.tsx` (formulário) servem Fornecedores e Clientes; o cliente tem a mais o limite de crédito.
- **Regra pura compartilhada:** a tela pode importar de `server/modules/<m>/domain` e `server/shared/domain` (só regra pura, sem Firebase nem Node), para calcular exatamente como o servidor. Vendas usa isso: `web/modules/sales` importa o pedido de `server/modules/sales/domain`, e `web/shared/domain/{dates,money,decimal,text}.ts` só reexportam os de `server/shared/domain`.
  - Contas a Receber (`web/modules/receivables/`, ligado em `web/erp/receivables.tsx`): lista, lançamento, baixa por banco ou cheque, estorno e exclusão em `#contas-receber-app`, gravando pela API `finance/receivables` (detalhes em `docs/CONTAS-RECEBER.md`).
  - Contas a Pagar (`web/modules/payables/`, ligado em `web/erp/payables.tsx`): lista, filtros, calendário, lançar (avulsa ou parcelada), editar e excluir em React, gravando pela API `finance/payables` (detalhes em `docs/CONTAS-PAGAR.md`). Pagar e o histórico de pagamentos também são React (desde a v240). Outras telas (folha, despesas, combustível, contratos, contas fixas) ainda criam contas a pagar pelo navegador.
- **Ordem das próximas migrações:**
  1. Passar para o servidor quem ainda cria conta a pagar pelo navegador (folha, despesas, combustível, contratos, contas fixas); aí `contasPagar` fecha nas regras.
  2. Bancos (extrato), Adiantamentos e Cheques.
  3. Compra sucata (hoje metade navegador, metade servidor).
  4. Balança rodoviária.
  5. Painel e Fluxo de caixa.
- **Limpeza feita na etapa 5:**
  - scripts avulsos de incidentes já resolvidos (fornecedor de teste F675, ticket T284, adiantamento excluído);
  - migrações únicas já aplicadas (`migrate:auth`, `migrate:storage`);
  - `SHA256SUMS.txt` desatualizado e arquivos `:Zone.Identifier` do Windows;
  - `bootstrap-admin.json`, que tinha o hash de senha da administradora e não era usado;
  - ferramentas de auditoria de incidentes (`audit-*.mjs`, `access-inventory.mjs`, `diagnose-emulator.mjs`), que liam cópias exportadas do banco para investigar casos já resolvidos;
  - documentos de fases e incidentes encerrados (guias de homologação das fases 1–3, mapas de correção, notas de incidente e as entregas antigas da conciliação). As regras que ainda valem foram para `BANCOS-CONCILIACAO-FLUXO.md`; deploy, variáveis e Docker ficaram só em `DEPLOY.md`.
- **Testes de texto do código antigo** (phase1/2/3, v30): saem junto com cada módulo quando ele vira React, como aconteceu com Vendas, Fornecedores, Clientes, Contas a Receber e Contas a Pagar.

Para migrar uma tela:

1. Crie `web/modules/<tela>/` com `domain/` (regras puras e testes) e `ui/`.
2. Registre a tela em `web/erp/islands.tsx`, no contêiner da aba antiga.
3. Tire o script antigo do `bootstrap.js` e apague-o.
4. Rode o teste de tela da aba.

### Desempenho (10/11/2026)

Medido com latência de 80 ms e uma base de 300 fornecedores e 1.500 compras:

| Medida | Antes | Depois |
|---|---|---|
| Tela de login pronta | 5,0 s | 2,0 s |
| ERP pronto após o login | 1,5–2,1 s | 0,33 s |
| Aba Compra | ~450 ms | ~40 ms |
| Aba Adiantamentos | ~650–780 ms | ~90 ms |

Mudanças:

- **Scripts em paralelo:** o `bootstrap.js` e o `firebase-loader.js` disparam todos os scripts juntos (`async=false` mantém a ordem). Antes era um `await` por arquivo, em fila.
- **Login antes da hora:** o `doLogin` antigo respondia "Senha incorreta" se a pessoa entrasse antes de o login seguro carregar. Agora avisa que o sistema ainda está carregando.
- **Algoritmos:**
  - o rótulo de fornecedor (`_fornRotuloOpcao`) era quadrático: cerca de 90 mil normalizações a cada letra digitada;
  - as compras por fornecedor percorriam todas as compras para cada fornecedor;
  - os dois agora usam cache ou índice.
- **Lista de Adiantamentos paginada:** antes desenhava todas as linhas, cerca de 480 ms só de layout.
- **Cache:**
  - o build acrescenta o hash do conteúdo a todos os `?v=` do `index.html` e à revisão do `bootstrap.js`;
  - com isso, o `vercel.json` guarda em cache longo (`immutable`) os endereços de `/legacy`, `/modules` e `/app` que têm `?v=`;
  - a verificação de deploy reprova build sem o hash.
- **Testes:** `test/erp-load-performance.test.js`.

### O que a etapa 4 mudou

- **Nova pasta `web/`** com a interface em React 19 + Vite 8 + TypeScript estrito (`web/tsconfig.json`).
- **Lançamento rápido em React** (`web/modules/quick-entry/`):
  - mesmas telas, mesmo visual, mesmo endereço `/rapido/` e mesmo login do ERP;
  - os 4 arquivos antigos (`public/rapido/index.html`, `rapido.js`, `parser.js`, `rapido.css`) foram removidos;
  - manifest e ícones continuam em `public/rapido/`.
- **Build:**
  - `scripts/build.mjs` copia `public/` e depois chama o Vite;
  - o Vite grava `dist/rapido/index.html` e os pacotes com hash em `dist/web/`;
  - a Vercel não mudou (`npm run build` → `dist/`).
- **Cache:** `vercel.json` marca `/web/*` como `immutable`, porque o nome do arquivo muda a cada versão. A página `index.html` não fica em cache, então a versão nova chega sem `?v=`.
- **Login nas telas novas:**
  - `web/shared/auth/firebase-session.ts` carrega só o app e o auth do Firebase (9.23.0, o mesmo do ERP);
  - a sessão fica no `sessionStorage`, compartilhada com o ERP.
- **Lint:** `eslint-plugin-react-hooks` (regras do React Compiler), com `exhaustive-deps` como erro.
- **Verificação de deploy:** `verify-deployment-artifacts.mjs` confere que `dist/rapido/index.html` aponta para um pacote existente em `/web/`.
- **Testes:** a varredura de segredos (`security-scan.test.js`) também olha `web/`.

Para criar a próxima tela React:

1. Crie `web/pages/<tela>/index.html`, apontando para `../../modules/<tela>/main.tsx`.
2. Adicione a página em `build.rolldownOptions.input` no `vite.config.ts`.
3. Coloque as regras em `domain/` (com testes em `test/`), as chamadas em `application/` e os componentes em `ui/`.

### O que a etapa 3 mudou

| Módulo | Organização |
|---|---|
| `purchases` | `domain/installments.ts` (parcelas), `domain/purchase-edit.ts` (regras puras da edição), `domain/advance-refund.ts` (devolução ao adiantamento), `domain/purchase-records.ts` (tipos e centavos); `application/` com criar, editar e excluir |
| `payables` | `application/payables.ts`: baixa, conferência e bancos para pagamento |
| `advances` | `domain/advance-rules.ts` (validações), `infrastructure/advance-locks.ts` (travas com recuperação por recibo), `application/advances.ts` e `orphan-recovery.ts`. A lista de fornecedores usa `suppliers/domain/supplier-directory.ts`, sem cópia |
| `supplier-repasses` | `application/supplier-cash-repasses.ts` |
| `banking` | `application/bank-integrations.ts` (Pluggy) e `reconciliation.ts`; `domain/reconciliation-engine.ts` (adaptador tipado) |

- Os endpoints `api/finance/*` e `api/banking/*` usam `defineApi`.
- O teste `api-endpoints-contract.test.js` cobre todos eles.
- Os testes que copiavam `acquireAdvanceLock` agora importam a função de `advances/infrastructure/advance-locks.ts`.

### O que a etapa 2 mudou

- **Endpoints:** todos os endpoints não financeiros usam `defineApi`. A regra de negócio que estava dentro deles foi para os módulos:

| Endpoint | Caso de uso |
|---|---|
| `api/admin/employee-companies.ts` | `company/application/company-directory-service.ts` |
| `api/admin/branding.ts` | `company/application/update-branding.ts` |
| `api/admin/snapshots.ts`, `restore-history.ts`, `data-backup.ts` | `snapshots/application/data-administration.ts` |
| `api/training/matrix.ts` | `training/application/training-matrix.ts` (recebe `db` e `storage` por parâmetro) |
| `api/help/articles.ts` | `help/application/help-center.ts` |
| `api/agenda/services.ts` | `agenda/application/agenda-services.ts` |
| `api/fiscal/staff.ts` | `fiscal/application/fiscal-staff-query.ts` |
| `api/engineering/logs.ts`, `telemetry.ts` | `audit/application/audit-log.ts`, `client-telemetry.ts` |

- **Fachada:** cada módulo tem `index.ts`, e os endpoints importam só dela.
- **Erros:** todos têm código (`fail(status, 'CODIGO', mensagem)`). Erros que antes saíam sem código agora têm um próprio; por exemplo, o login com senha vazia devolve `INVALID_CREDENTIAL`.
- **Texto:** `shared/domain/text.ts` (`hasControlChars`, `replaceControlChars`, `hasMarkup`) substitui as expressões regulares de caracteres de controle, que o ESLint recusa.
- **Scripts:** os que importam o módulo `access` passam a rodar com `node --import tsx`: `seed:emulator`, `migrate:auth` e `provision:engineer`.
- **Testes:** os que copiavam trechos do código dos endpoints agora importam os módulos `.ts`. Há dois testes novos:
  - `api-endpoints-contract.test.js`: método aceito, origem e login exigido de cada endpoint;
  - `access-login-integration.test.js`: login, bloqueio por tentativas e gestão de usuários contra o banco simulado.

## Fontes de verdade dos dados

| Dado | Onde fica |
|---|---|
| Sessão/autorização | Firebase Authentication + Custom Claims (montadas no login a partir das abas do perfil) |
| Perfil/permissões dos usuários | `erp/users` |
| Hash/estado seguro de login | `erpAuth/users` (somente servidor) |
| Materiais | `erp/metais` + `erp/estoque` |
| Fornecedores / clientes | `erp/fornecedores`, `erp/fornDespesa` / `erp/clientes` |
| Bancos e extrato | `erp/bancos`, `erp/lancBanco` |
| Compras e contas | `erp/tickets`, `erp/contasPagar`, `erp/contasReceber`, `erp/vendas` |
| Adiantamentos e cheques | `erp/adiantamentos`, `erp/chequesControle`, `erp/cheques`, `erp/chequesCli` |
| Lançamento rápido | `erp/quickEntries`, `erp/quickUploads` (somente servidor) |
| Configuração da empresa | `erp/config` |
| Arquivos (fotos, PDFs) | Firebase Storage, com ponteiro no RTDB |

## Sincronização do navegador e gravações recusadas

O código antigo grava em lote (`fbSalvar` → `_enviarDadosEmLotes` em `public/legacy/firebase-sync.js`), uma atualização atômica com tudo o que mudou e todas as exclusões locais (`<nó>/<id>: null`). O filtro por nó (`__ERP_RTD_COLLECTION_POLICY__`) não enxerga regras com condição dentro do nó, como a de `tickets/$ticketId`. Antes de 13/11/2026, um único item recusado derrubava o lote inteiro em toda gravação daquele computador, e o aviso "Falha ao confirmar dados no Firebase" ficava preso.

Desde a v235:

- **Recusa de regra** (`PERMISSION_DENIED`, chave inválida, caminhos sobrepostos): primeiro grava só `_user` para testar a sessão. Se a sessão está boa, separa o lote por nó e ao meio até achar os itens recusados (no máximo 200 tentativas; o resto fica para a próxima gravação), grava o restante e manda `_ts` por último.
- **Exclusão recusada de algo que já não existe no servidor** conta como feita, sem aviso.
- **Item recusado de verdade** fica de quarentena neste computador (`localStorage.mm_fb_rejeitados`, 12 horas; exclusões confirmadas, 30 dias). A pessoa recebe um aviso dizendo o que ficou de fora, e o evento vai para Engenharia → Auditoria e logs (`sync_rejected`, com o nó e o id, sem valores).
- **Chaves com `. # $ [ ]`** (ex.: nome antigo de cliente em `chequesCli`) saem do lote antes do envio e entram na mesma quarentena.
- **Sessão sem permissão** continua como antes (aviso de erro, relogin e nova tentativa), sem quarentena.
- **`_ts` desfeito**: quando o Firebase recusa uma gravação, ele desfaz o `_ts` local antes de rejeitar. O ouvinte de `_ts` ignora o valor que o servidor tinha antes do envio; antes disso, cada recusa causava recarga e nova gravação, num laço sem fim.

O banco simulado dos testes (`test/support/fake-rtdb-server.mjs`) aceita `denyWrites(regra)` para imitar recusas.

## Login

1. A tela pede só a senha.
2. `/api/auth/login` confere a senha no servidor (scrypt + salt) contra `erpAuth/users`.
3. O servidor cria um Firebase Custom Token com `erpAccess`, `erpUser`, `admin` e as permissões (`canPurchasing`, `canQuickEntry`...).
4. O navegador entra com `signInWithCustomToken`. As regras do RTDB e do Storage liberam cada nó conforme essas permissões.

## Ambientes

- **Local:** `npm run dev`, com emuladores e as fixtures de `scripts/dev-*.json`. Nunca rode o seed em homologação ou produção.
- **Homologação:** branch `hml`, projeto Firebase `manuela-metais-hml`.
- **Produção:** branch `main`, projeto Firebase `manuelametaisltda`.
