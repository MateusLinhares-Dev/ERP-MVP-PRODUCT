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
public/                   Interface (legado em JS; vai virar React + Vite)
test/                     Testes (node:test, executados via tsx)
```

Módulos: `access` (login, usuários, permissões), `audit`, `company` (empresas e configuração), `suppliers`, `purchases`, `advances`, `payables`, `supplier-repasses`, `banking`, `quick-entry`, `agenda`, `training`, `help`, `fiscal`, `snapshots`.

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
- **Imports relativos com extensão `.js`**, mesmo apontando para arquivos `.ts`. É o padrão NodeNext, aceito por `tsc`, `tsx` e Vercel.
- **Formatação:** Prettier, aplicado por `npm run format`.
- **Lint:** ESLint com `typescript-eslint` e a regra própria `erp/no-comments`, que impede comentários.
- **Dinheiro:** cálculos em **centavos** (inteiros) e conversão para reais só na saída.
- **Datas de negócio:** `businessTodayISO()`, no fuso de São Paulo. Nunca use `new Date().toISOString()` para "hoje".
- **Gravações com mais de um nó:** um único `db.ref().update({...})` multi-caminho, para que tudo grave ou nada grave.
- **Concorrência:** travas com `acquireLease`/`releaseLease` e transações com `runTransaction` (`shared/firebase/rtdb-transaction.ts`).

## Comandos

| Comando | O que faz |
|---|---|
| `npm run typecheck` | Verifica os tipos |
| `npm run lint` | ESLint (inclui a proibição de comentários) |
| `npm run format` | Formata os arquivos `.ts` |
| `npm test` | Todos os testes (node:test via tsx) |
| `npm run check` | Tudo acima + build. Rode antes de cada commit |
| `npm run check:release` | `check` + verificações de segurança e de deploy |

## Situação da migração

| Etapa | Escopo | Situação |
|---|---|---|
| 1 | Ferramentas (TS, ESLint, Prettier), remoção de comentários, nova estrutura de pastas, núcleo `shared/`, módulo `quick-entry` e `api/quick` em TS | **Concluída** |
| 2 | Servidor em TS: `access`, `audit`, `company`, `agenda`, `training`, `help`, `fiscal`, `snapshots` + endpoints `auth`, `admin`, `agenda`, `training`, `help`, `fiscal`, `engineering`, `config`, `public-config`, `health` | **Concluída** |
| 3 | Servidor em TS: `purchases`, `advances`, `payables`, `supplier-repasses`, `banking` (regras financeiras) + endpoints `api/finance` e `api/banking` | **Concluída** |
| 4 | Interface: base React + Vite + TS; Lançamento rápido como primeira tela | A fazer |
| 5+ | Interface: substituir o `public/legacy/app-core.js` módulo a módulo (compras, financeiro, cadastros, RH, frota, fiscal) | A fazer |

Todo o servidor (`server/` e `api/`) está em TypeScript desde a etapa 3. O `allowJs` continua ligado por um único motivo: a conciliação bancária usa o motor `public/modules/banking/reconciliation-engine.mjs`, que é o mesmo da tela. O servidor importa esse arquivo por meio de um adaptador tipado (`server/modules/banking/domain/reconciliation-engine.ts`).

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

## Login

1. A tela pede só a senha.
2. `/api/auth/login` confere a senha no servidor (scrypt + salt) contra `erpAuth/users`.
3. O servidor cria um Firebase Custom Token com `erpAccess`, `erpUser`, `admin` e as permissões (`canPurchasing`, `canQuickEntry`...).
4. O navegador entra com `signInWithCustomToken`. As regras do RTDB e do Storage liberam cada nó conforme essas permissões.

## Ambientes

- **Local:** `npm run dev`, com emuladores e as fixtures de `scripts/dev-*.json`. Nunca rode o seed em homologação ou produção.
- **Homologação:** branch `hml`, projeto Firebase `manuela-metais-hml`.
- **Produção:** branch `main`, projeto Firebase `manuelametaisltda`.
