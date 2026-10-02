# Deploy v30 — LOCAL, HML e PRODUÇÃO

Esta versão mantém o funcionamento da v29. A alteração é somente de processo de ambiente, segurança de configuração e deploy.

## 1. Matriz de ambientes

| Ambiente | Front/API | Firebase | Configuração |
|---|---|---|---|
| LOCAL | `vercel dev` | Firebase Emulator Suite | `.env.erp.local` |
| HML | Vercel Preview | projeto Firebase exclusivo de homologação | Environment Variables `Preview` |
| PROD | Vercel Production | Firebase real do cliente | Environment Variables `Production` |

Regras obrigatórias:

- LOCAL nunca acessa Firebase real.
- HML nunca aponta para o Firebase PROD.
- Preview da Vercel nunca recebe variáveis PROD.
- Produção nunca usa `demo-*` nem Emulator.
- `FIREBASE_SERVICE_ACCOUNT_B64` e `LOGIN_RATE_LIMIT_SECRET` existem somente no servidor/Vercel.
- `dist/` contém somente frontend estático; as funções em `/api` são publicadas separadamente pela Vercel.
- Nunca execute `seed:emulator`, scripts de seed ou fixtures em HML/PROD.

---

# 2. LOCAL

## 2.1 Instalar

```powershell
npm install
Copy-Item .env.erp.local.example .env.erp.local
```

Preencha `LOCAL_DEV_PASSWORD_BASE` e `LOGIN_RATE_LIMIT_SECRET` apenas para desenvolvimento local.

## 2.2 Subir

```powershell
npm run dev
```

Serviços esperados:

- ERP: `http://localhost:3000`
- Emulator UI: `http://127.0.0.1:4000`
- Auth: `127.0.0.1:9099`
- RTDB: `127.0.0.1:9000`
- Storage: `127.0.0.1:9199`

## 2.3 Gate local

```powershell
npm run check:release
```

---

# 3. FIREBASE HML

Use um projeto Firebase separado do cliente, por exemplo `manuela-metais-hml`.

## 3.1 Criar projeto

1. Firebase Console → **Add project / Criar projeto**.
2. Defina um nome claramente de homologação.
3. Não reutilize o projeto de produção.
4. Analytics é opcional para este ERP.

## 3.2 Registrar Web App

1. Projeto Firebase → engrenagem **Project settings / Configurações do projeto**.
2. Aba **General / Geral**.
3. Em **Your apps / Seus apps**, clique no ícone Web `</>`.
4. Nome sugerido: `manuela-erp-hml-web`.
5. Não é necessário ativar Firebase Hosting porque o frontend será hospedado na Vercel.
6. Após registrar, copie os valores do objeto `firebaseConfig`:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`

A `apiKey` do Web SDK identifica o projeto, mas não substitui Security Rules e não é tratada pelo projeto como segredo de servidor.

## 3.3 Authentication

O ERP usa **Custom Authentication**: a senha do ERP é validada pela função server-side e o backend cria um Firebase Custom Token.

1. Firebase Console → **Authentication**.
2. Clique em **Get started / Começar** caso o produto ainda não esteja inicializado.
3. Não é necessário transformar a interface do ERP em e-mail/senha. O fluxo continua usando Custom Token.

## 3.4 Realtime Database

1. Firebase Console → **Realtime Database**.
2. **Create Database / Criar banco de dados**.
3. Selecione a região planejada.
4. Inicie de forma restrita; não deixe regras públicas de teste em HML.
5. Copie a URL exata exibida pelo Firebase para `FIREBASE_DATABASE_URL`.
6. Depois publique as regras deste projeto com `npm run deploy:rules:hml`.

## 3.5 Storage

O ERP usa Storage para PDFs/imagens/documentos. Para Cloud Storage for Firebase, o projeto precisa estar no plano Blaze.

1. Firebase Console → **Storage**.
2. Se solicitado, vincule o projeto ao plano Blaze / conta de faturamento.
3. **Get started / Começar**.
4. Escolha a região do bucket conscientemente.
5. Copie o nome exato do bucket para `FIREBASE_STORAGE_BUCKET`.
6. Não deixe Rules públicas; publique `storage.rules` deste projeto.

## 3.6 Service Account

1. Firebase Console → engrenagem → **Project settings**.
2. Aba **Service accounts / Contas de serviço**.
3. Em **Firebase Admin SDK**, gere uma nova chave privada para HML.
4. Salve o JSON temporariamente fora do repositório.
5. Converta em Base64:

```powershell
npm run encode:service-account -- "C:\caminho\service-account-hml.json"
```

6. Copie o valor resultante para `FIREBASE_SERVICE_ACCOUNT_B64` na Vercel Preview.
7. Nunca coloque o JSON ou o Base64 no Git, em `public/`, em `dist/` ou em screenshots.
8. Se a chave vazar, revogue-a e gere outra.

---

# 4. FIREBASE PRODUÇÃO

O Firebase PROD é o projeto real do cliente e já contém os dados.

Antes de qualquer alteração:

1. Identifique `projectId`, RTDB URL e bucket atuais.
2. Faça backup/export do RTDB.
3. Confirme o bucket de documentos.
4. Gere uma service account exclusiva do projeto PROD.
5. Não rode seed.
6. Não recrie cadastros existentes.
7. Teste Security Rules em HML primeiro.
8. Faça o corte de Rules em horário combinado e valide login, leitura, escrita e documentos imediatamente.

Para conferir o arquivo local antes de copiar valores para Vercel:

```powershell
Copy-Item .env.production.example .env.production
# preencher localmente sem commitar
npm run preflight:prod
```

---

# 5. VERCEL

## 5.1 Criar/importar projeto

1. Vercel Dashboard → **Add New → Project**.
2. Importe o repositório Git do ERP.
3. Em Framework Preset, use **Other**. O `vercel.json` já declara `framework: null`.
4. Root Directory: raiz do projeto, onde estão `package.json` e `vercel.json`.
5. Build Command: `npm run build`.
6. Output Directory: `dist`.
7. Node.js: 24.x.

O repositório já possui esses valores em `vercel.json`/`package.json`; o painel deve apenas não contradizê-los.

## 5.2 Environment Variables — Preview / HML

Vercel → Project → **Settings → Environment Variables**.

Cadastre com escopo **Preview**:

```text
APP_ENV=homolog
USE_FIREBASE_EMULATORS=false
FIREBASE_PROJECT_ID=<projeto-hml>
FIREBASE_API_KEY=<web-api-key-hml>
FIREBASE_AUTH_DOMAIN=<...>
FIREBASE_DATABASE_URL=<url-exata-rtdb-hml>
FIREBASE_STORAGE_BUCKET=<bucket-hml>
FIREBASE_MESSAGING_SENDER_ID=<...>
FIREBASE_APP_ID=<...>
FIREBASE_SERVICE_ACCOUNT_B64=<base64-hml>
LOGIN_RATE_LIMIT_SECRET=<segredo-aleatorio-forte-hml>
```

`FIREBASE_SERVICE_ACCOUNT_B64` e `LOGIN_RATE_LIMIT_SECRET` devem ser tratados como secretos/sensíveis.

## 5.3 Environment Variables — Production

Cadastre OUTRO conjunto com escopo **Production**:

```text
APP_ENV=production
USE_FIREBASE_EMULATORS=false
FIREBASE_PROJECT_ID=<projeto-prod-cliente>
FIREBASE_API_KEY=<web-api-key-prod>
FIREBASE_AUTH_DOMAIN=<...>
FIREBASE_DATABASE_URL=<url-exata-rtdb-prod>
FIREBASE_STORAGE_BUCKET=<bucket-prod>
FIREBASE_MESSAGING_SENDER_ID=<...>
FIREBASE_APP_ID=<...>
FIREBASE_SERVICE_ACCOUNT_B64=<base64-prod>
LOGIN_RATE_LIMIT_SECRET=<segredo-aleatorio-forte-prod>
```

Nunca marque as variáveis PROD para Preview.

## 5.4 Deploy HML

- Trabalhe em uma branch de homologação ou abra um Preview Deployment.
- O Preview usa as variáveis Preview e deve apontar somente para o Firebase HML.
- Valide `/api/health`: o JSON deve reportar `environment: "homolog"`.
- Valide `/api/config`: deve mostrar o `projectId` HML e `emulators.enabled=false`.
- Faça a homologação completa antes da produção.

## 5.5 Deploy Production

- Production Branch deve ser a branch aprovada (ex.: `main`).
- Confirme as variáveis Production antes do deploy.
- O deploy de produção usa o Firebase PROD.
- Valide `/api/health`: `environment: "production"`.
- Faça smoke test de login, clientes, fornecedores, compras, vendas, documentos, chat e avisos.

---

# 6. Security Rules

Faça login na Firebase CLI uma vez:

```powershell
npx firebase login
```

HML:

```powershell
$env:FIREBASE_HML_PROJECT_ID="SEU_PROJETO_HML"
npm run deploy:rules:hml
```

PROD possui trava extra:

```powershell
$env:FIREBASE_PROD_PROJECT_ID="SEU_PROJETO_PROD"
$env:CONFIRM_PRODUCTION_DEPLOY="MANUELA_PROD"
npm run deploy:rules:prod
```

O script publica somente Database Rules e Storage Rules.

---

# 7. Como o build funciona

Sim, a Vercel usa o `dist/` para o frontend:

```text
public/
   ↓ npm run build
 dist/
   ↓ Vercel CDN
 navegador
```

As funções backend NÃO vão para `dist/`:

```text
api/*.js
   ↓
Vercel Functions (Node.js)
```

Por isso o frontend estático nunca precisa receber a service account.

O browser busca `/api/config`, que retorna somente a configuração Web pública do Firebase. A service account e o segredo do rate limit continuam apenas no ambiente da Function.

---

# 8. Gate antes de deploy

```powershell
npm run check:release
```

O comando executa:

1. testes automatizados;
2. build de `dist/`;
3. validações de Rules/claims/headers;
4. scanner do `dist/` para impedir chave privada/segredo no bundle;
5. validação de `vercel.json` e `.vercelignore`.

Não existe promessa técnica de "zero vulnerabilidades". A versão aplica hardening compatível com o legado e reduz exposição sem alterar os fluxos funcionais, mas deve continuar recebendo atualizações, auditoria de dependências e homologação.

## Docker Compose para desenvolvimento local

A v30 também pode ser executada de forma padronizada por Docker, sem alterar HML/PROD:

```powershell
Copy-Item .env.erp.local.example .env.erp.local
docker compose up --build
```

O Compose expõe somente em `127.0.0.1` as portas 3000, 4000, 9000, 9099 e 9199. Dentro do container, `firebase.docker.json` faz os Emulators escutarem em `0.0.0.0` para que o bind de portas funcione. A aplicação continua entregando ao navegador `127.0.0.1` como host dos Emulators, portanto não há alteração do contrato do frontend.

Detalhes: `docs/DOCKER_LOCAL_V30.md`.
