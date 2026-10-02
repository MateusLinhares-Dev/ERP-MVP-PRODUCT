# Segurança aplicada — v9

- Firebase Authentication é a sessão/autorização do navegador.
- O login legado por senha é preservado, mas a senha é enviada somente ao endpoint serverless.
- Senhas são armazenadas como scrypt + salt em `erpAuth/users`; esse nó tem leitura/escrita negadas ao cliente.
- Custom Tokens são emitidos somente no servidor com claims mínimas (`erpAccess`, `erpUser`, `admin`).
- Administração usa `admin=true`; nenhum username especial concede privilégio.
- Rate limit server-side usa identificador de IP protegido por HMAC.
- Service account existe somente no ambiente server-side (`FIREBASE_SERVICE_ACCOUNT_B64`).
- Realtime Database começa com deny-by-default e exige `erpAccess` para `erp`.
- `erp/users` e `erp/usersDeleted` não aceitam escrita do navegador; gestão ocorre via Admin SDK/API.
- Storage exige autenticação/claim e limita tamanho/MIME dos arquivos novos.
- O bundle público não contém CPFs/funcionários, contas bancárias iniciais, tickets de demonstração, hashes ou credenciais do cliente.

## Separação de configuração

Configuração pública necessária para manter a mesma identidade visual é filtrada por `/api/public-config`. O endpoint não expõe service account, hashes, claims ou segredos. Configuração completa de negócio é lida pelo cliente autenticado de `erp/config` sob Security Rules.

## Compatibilidade inevitável

A UI legado ainda usa handlers inline, então a CSP mantém `unsafe-inline` enquanto a camada de apresentação não for migrada. Essa dívida é deliberada para não transformar uma refatoração de infraestrutura em uma reescrita funcional.

## Atualização v22
Os controles de hardening da entrega atual estão documentados em `SECURITY_V22.md`. Para preservar o legado, a v22 não reivindica RBAC granular de leitura em todo RTDB: o loader ainda hidrata `erp` de forma ampla para uma sessão autenticada. Escritas críticas, Storage, navegação e APIs foram endurecidos sem alterar a UI/regra funcional.
