# Conciliação bancária avançada — Manuela Metais

## Versão e segurança

Este patch deve ser aplicado sobre a entrega **ERP-CONCILIACAO-BANCARIA-HML-IMPLEMENTADA.zip**, incorporando todas as alterações desta versão. A segurança é realizada no servidor, na API `/api/banking/reconcile`, que valida o Firebase ID Token e o atributo `canBanking`. O navegador não tem permissão de escrita em `erp/bankReconciliationState`.

Todas as contas bancárias compartilham uma **transação RTDB global** de reservas: o mesmo título não pode ser conciliado duas vezes, inclusive em contas bancárias distintas. O histórico das alterações (quem, quando, estado, vínculos, valores) fica em `erp/bankReconciliationState/{bankCode}/audit`; decisões atuais ficam em `decisions`. A API opera com credenciais Firebase Admin já utilizadas nas outras funções Vercel. Nunca exponha a service account no frontend.

**Não publique o Firebase antes do frontend atualizado:** o RTDB adiciona uma nova coleção somente para leitura de usuários bancários e escrita exclusiva via Firebase Admin; regras existentes das demais coleções ficam preservadas.

## Capacidades entregues

- Visão em duas colunas com busca, filtro por tipo e situação, e indicadores de pendência.
- Importação OFX (SGML e XML simples), detecção de duplicados por FITID / conteúdo e conta de origem, limite de tamanho e de quantidade.
- Sugestões ordenadas por montante, data, tipo e semelhança na descrição.
- Associação de múltiplos títulos a um movimento (1:N), múltiplos movimentos ao mesmo título (N:1), e alocação parcial com saldo remanescente, sem superar o valor disponível.
- Ajustes de conciliação positivos (tarifas) ou negativos (descontos), sempre com categoria obrigatória. **Os ajustes são metadados de conciliação; não são automaticamente lançamentos contábeis.**
- Conciliar correspondências exatas em lote, atômico no servidor até 30 itens. Se uma falhar, o lote não é confirmado.
- Arquivar, classificar, desfazer e manter histórico/auditoria.
- Registrar, por escolha explícita e confirmação, a movimentação importada no extrato bancário do ERP (`lancBanco`), com ID determinístico e escrita idempotente para evitar duplicação por retry.
- Criar títulos financeiros **pendentes** (Contas a Pagar ou Contas a Receber, conforme o sinal bancário), com empresa, contraparte, categoria, descrição e valor, usando identificador determinístico para evitar duplicações. O lançamento criado é oferecido para vínculo na conciliação.
- Suporte a perfis bancários/financeiros. O servidor só oferece títulos de módulos autorizados ao token.

## Limites funcionais importantes

- **Conciliação não é baixa:** vincular um movimento a Contas a Pagar ou Receber **não** altera automaticamente `status`, caixa, saldo ou datas de liquidação desses títulos. Não contabilize um pagamento duas vezes. As baixas seguem os fluxos existentes de Financeiro.
- A criação de um **movimento bancário** pela conciliação afeta o saldo da conta; só use quando ainda não existir em `lancBanco`. Não confunda o extrato OFX importado (sem efeito em saldo) com o extrato ERP (com efeito em saldo).
- Baixa automática de novos títulos, conciliação multiempresa com planos de contas completos, provisões contábeis e conexão automática por API bancária **não** estão incluídas. Exigem definição de regras financeiras, homologação e, no caso de APIs, credenciais/contrato bancário. Não são substituídas por campos visuais.
- Registros antigos de contas a receber sem ID estável podem sofrer alterações de índice no legado; revise esses vínculos antes de migrar/editar dados. As decisões novas persistem o identificador do título, mas não modificam sua identidade.
- Transações globais têm custo proporcional ao histórico das contas. A API impede ultrapassar 10.000 eventos por conta, exigindo procedimento de arquivamento administrado para volumes maiores.
- Não houve mudanças no `storage.rules` ou integração com bancos externos.

## Como atualizar a HML

1. Fazer backup do RTDB HML e extrair o ZIP de arquivos modificados **na raiz do projeto**, preservando os caminhos.
2. Executar `npm run generate:rules:candidate` (incluído na versão base) para conferir que `database.rules.json` e `docs/database.rules.candidate.json` não divergiram.
3. Executar `ERP_SECURITY_STRICT=1 npm run check:release` e conferir o resultado.
4. Subir para a branch `hml` (`git add ...`, `git commit`, `git push origin hml`) e aguardar a conclusão do deploy automático Vercel HML, incluindo a nova função `/api/banking/reconcile`.
5. Conferir **FIREBASE_PROJECT_ID / FIREBASE_DATABASE_URL / FIREBASE_SERVICE_ACCOUNT_B64** nas variáveis **server-side** da Vercel HML, apontando só para o projeto Firebase de homologação.
6. Publicar as regras: `firebase deploy --only database --project manuela-metais-hml`.
7. Logout/login para atualizar claims; testar com admin e com usuário que tem somente acesso a Bancos.

## Checklist de testes manuais de homologação

- Importar `docs/examples/conciliacao-exemplo.ofx` duas vezes; a segunda não deve inserir duplicatas.
- Vincular dois títulos de R$ 1.500 e R$ 1.000 a um único débito de R$ 2.500. Conferir diferença zero.
- Conciliar um título de R$ 1.000 em dois débitos de R$ 600 e R$ 400. A segunda operação não pode permitir alocar mais de R$ 400.
- Tentar usar o mesmo título em duas contas bancárias; segunda ação deve falhar.
- Testar um débito de R$ 1.010 com título de R$ 1.000 e tarifa +R$ 10 classificada; diferença zero, sem lançamento contábil automático.
- Fazer classificação e desfazer. Conferir histórico de usuário, data e estado.
- Selecionar vários movimentos com correspondência exata e conciliar em lote; um item inválido deve barrar o lote todo.
- Registrar uma movimentação bancária pela importação: primeiro clique cria um lançamento, segundo não cria outro. Conferir saldo e histórico em Bancos.
- Confirmar que um usuário sem `canBanking` recebe 403 da API e `permission_denied` na nova coleção; usuários bancários não conseguem escrever diretamente em `bankReconciliationState`.
- Criar título financeiro pelo extrato; repetir a tentativa e conferir que só há um título, marcado como `Pendente` até passar pelo fluxo de pagamento/recebimento.
- Confirmar que conciliar títulos não muda suas baixas automaticamente e não duplica pagamentos.

## Rollback

Antes do deploy, arquive JSON/backup da HML. Para retornar a interface anterior, restaure o commit no Git. A nova coleção `bankReconciliationState` pode permanecer no RTDB sem alterar saldo financeiro: não apague histórico/auditoria sem exportar e aprovar a retenção. No rollback de regras, mantenha a negação de escrita do browser no nó de estado.
