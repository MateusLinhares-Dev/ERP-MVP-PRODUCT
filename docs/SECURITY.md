# Segurança

## Login e permissões

- O login por senha vai só para a API (`/api/auth/login`). As senhas ficam como scrypt + salt em `erpAuth/users`, que o navegador não lê nem grava.
- O servidor emite um Custom Token do Firebase com as permissões do perfil (`erpAccess`, `admin` e uma por módulo: `canPurchasing`, `canSales`, `canCustomers`...). Nenhum nome de usuário dá privilégio especial.
- O limite de tentativas de login usa o IP protegido por HMAC (`LOGIN_RATE_LIMIT_SECRET`).

## Firebase

- O Realtime Database nega tudo por padrão. Cada coleção de `erp` tem regra própria de leitura e escrita por permissão, gerada por `npm run generate:rules:candidate` (`scripts/generate-granular-database-rules.mjs`). O mesmo script gera `public/app/rtdb-collection-policy.json`, que diz à sincronização do navegador o que ela pode gravar.
- Dados que só o servidor grava ficam com `.write: false` (ex.: `fornecedores`, `clientes`, adiantamentos, compras e pagamentos feitos pela API). Mudar esses dados na tela sem passar pela API some no F5.
- `FIREBASE_SERVICE_ACCOUNT_B64` existe só nas variáveis de servidor da Vercel. Nunca no navegador nem no repositório.
- Storage exige login e permissão, e limita tamanho e tipo dos arquivos.

## Publicação

- `npm run check:release` roda tipos, lint, testes, build, a varredura de segredos no `dist/` e a conferência de `vercel.json`/`.vercelignore`.
- Regras novas do Firebase vão **depois** do código publicado e de todos recarregarem o ERP (`npm run deploy:rules:hml` / `prod`).

## Dívida conhecida

A tela antiga usa `onclick` no HTML, então a CSP ainda permite `unsafe-inline`. Isso sai quando as telas antigas terminarem de virar React.
