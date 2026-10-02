# Arquitetura — v9

A v9 mantém a **interface e as regras funcionais da v8/legado** e muda apenas a origem/isolamento dos dados e da autenticação. A estratégia continua sendo **Strangler + Anti-Corruption Layer**: o código legado permanece executando os mesmos fluxos, enquanto Firebase/Vercel ficam atrás de adaptadores e casos de uso.

## Camadas

- `public/legacy/`: apresentação e regras legadas. As coleções mutáveis nascem vazias e são hidratadas pelo RTDB após autenticação.
- `public/app/`: bootstrap, Firebase compat, Auth segura e adaptador Storage/RTDB.
- `server/domain/`: regras puras de usuário/perfil.
- `server/application/`: casos de uso (`authenticateUser`, `manageUser`, `getPublicBranding`).
- `server/infrastructure/`: Firebase Admin e repositórios concretos (`user-repository`, `business-config-repository`), hash e rate limit.
- `api/`: Vercel Serverless, somente entrega HTTP.

## Fontes de verdade

| Dado | Fonte de verdade em runtime |
|---|---|
| Sessão/autorização | Firebase Authentication + Custom Claims |
| Perfil/permissões dos usuários | `erp/users` |
| Hash/estado seguro de login | `erpAuth/users` — somente servidor |
| Materiais | `erp/metais` + `erp/estoque` |
| Funcionários | `erp/funcEdit` |
| Fornecedores/clientes | nós existentes do RTDB, sincronizados pelo legado |
| Bancos | `erp/bancos` |
| Tickets/compras | `erp/tickets` |
| Frota | `erp/frota` |
| Controle de cheques | `erp/chequesControle` |
| Configuração cadastral/referências do cliente | `erp/config` |
| Documentos binários novos | Firebase Storage, com ponteiro no RTDB |

As variáveis globais do legado (`USERS`, `FUNCIONARIOS`, `TICKETS_DB`, `METAIS`, `BANCOS_DB` etc.) continuam existindo para **não reescrever a aplicação**, mas não carregam registros do cliente no bundle. Elas são preenchidas a partir do Firebase.

## Local x produção

`scripts/dev-users.json`, `scripts/dev-materials.json` e `scripts/dev-business-data.json` são **fixtures exclusivamente locais**. `npm run seed:emulator` grava essas fixtures apenas no Firebase Emulator.

Essas fixtures não ficam em `public/`, não são copiadas para `dist/` e não são carregadas pelo navegador. Em homologação/produção, **não execute o seed**: o ERP usa os dados já existentes no Firebase do cliente.

## Fluxo de login

1. A tela continua pedindo somente a senha, igual ao legado.
2. `/api/auth/login` valida a senha no servidor contra `erpAuth/users` usando scrypt + salt.
3. O servidor cria Firebase Custom Token com `erpAccess`, `erpUser` e `admin`.
4. O navegador usa `signInWithCustomToken`.
5. Security Rules liberam RTDB/Storage somente para sessão autenticada.
6. O perfil visual/permissões é carregado de `erp/users`.

A identificação de administrador não depende mais de login/nome hardcoded; usa `admin=true` no perfil/claim.

## Preservação do legado

A v9 não converte o ERP para outro framework e não muda nomes de telas, fluxos, botões ou regras de negócio. Dados externos são adaptados para os mesmos objetos globais que o legado já consumia. Isso reduz a superfície de regressão e permite testar módulo por módulo contra a v8 aprovada.
