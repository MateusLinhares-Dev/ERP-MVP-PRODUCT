# Conciliação bancária — Manuela Metais / HML

## Escopo implementado

Nova ação **Conciliar** ao lado de **Extrato** em Bancos. Tela de duas colunas: extrato bancário importado por OFX e lançamentos existentes do ERP. Possibilidades: seleção de banco, importação OFX SGML/XML, deduplicação por FITID (ou data+valor+descrição+posição), filtros, correspondências sugeridas, vínculo 1:1, classificação manual por categoria e centro de custo, reversão e histórico de auditoria. Importações e eventos são imutáveis no Firebase.

**Importação e conciliação não geram um novo lançamento em `lancBanco` e não marcam títulos como pagos/recebidos.** Essa separação impede contabilização dupla com a lógica financeira existente. Uma movimentação classificada sem vínculo é exibida como **Classificada**, não como Conciliada.

## Caminhos novos no Realtime Database

- `erp/bankReconciliationImports/{bankCode}/{importId}` — origem OFX, dados originais normalizados, data, centavos em string, responsável e timestamp. Somente criação.
- `erp/bankReconciliationEvents/{bankCode}/{eventId}` — decisões e reversões append-only, vinculadas ao identificador importado e ao UID autenticado.

Leitura e escrita exigem `erpAccess` e `canBanking`; não foi criado wildcard genérico. Eventos só podem apontar para importações existentes. `database.rules.json` e `docs/database.rules.candidate.json` são gerados pelo script `npm run generate:rules:candidate`. `docs/database.rules.baseline.json` é a referência de regras legadas, não o arquivo de implantação.

O sincronizador legado **não** precisa incluir os dois novos caminhos em `rtdb-collection-policy.json`: eles são acessados diretamente pelo módulo novo com as regras próprias, sem interferir na sincronização financeira atual.

## Ativação em HML

1. Extraia o ZIP na raiz da mesma versão HML que possui o módulo Bancos e o extrato com precisão monetária.
2. Execute `npm run generate:rules:candidate` e `ERP_SECURITY_STRICT=1 npm run check:release`.
3. Faça commit/push da branch `hml` e confirme que a Vercel terminou o deploy.
4. Publique **somente as regras RTDB**: `firebase deploy --only database --project manuela-metais-hml`. `storage.rules` não foi alterado.
5. Faça logout/login para renovar o token. Abra **Bancos → Conciliar**, escolha um OFX e confirme a lista.
6. Teste com perfis administrador, usuário com `contas_banco` e usuário sem acesso bancário. Verifique importação repetida, correspondências, classificação e reversão. Teste `permission_denied` e importação na conta errada.

## Limites e integridade

- Importação de OFX até 1 MB, no máximo 2.000 movimentações por arquivo; valores monetários ficam em **centavos como string**, sem arredondamentos binários.
- Uma sugestão é criada apenas se a direção é compatível e o valor bate **exatamente**; datas próximas priorizam o resultado, não fazem confirmação automática.
- Conciliações desta entrega são **1:1**; não somam várias parcelas para um único débito. Quando não há correspondência, a movimentação pode ser classificada, permanecendo sem vínculo financeiro.
- A conciliação não substitui as baixas financeiras existentes e **não está integrada automaticamente à API bancária** (é OFX manual).
- Os eventos de auditoria são preservados na reversão; a versão atual da decisão é derivada do evento mais recente.
- Faça backup da HML. A validação automatizada cobre o domínio, a geração das regras, permissões estáticas, build e integração de interface por análise de código. **Testes end-to-end com Firebase Emulator e perfis reais devem anteceder o deploy de produção.**
