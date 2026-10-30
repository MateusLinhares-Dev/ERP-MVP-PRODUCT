# ERP Manuela Metais — Mapa de correções da homologação Fase 3

## O que esta revisão corrige

| Área | Problema observado | Correção desta revisão |
|---|---|---|
| Compra de Sucata | Editar ticket podia retornar “Ticket não encontrado” | Resolução robusta por chave Firebase **ou** número visível do ticket antes de abrir detalhe/impureza |
| Clientes / Fornecedores | Multibanco existia apenas para cliente | Ambos recebem gestão de múltiplas contas; primeira conta vira principal para compatibilidade com módulos legados |
| Calendário / Avisos | Tela ainda poluída e sem responsável | Nova agenda mensal/por período, compromisso associado a usuário, pesquisa, edição, conclusão e alertas 5/3/1 dias antes |
| Avisos | Compromissos não eram pessoais | Aba Avisos recebe somente os compromissos do usuário logado; badge inclui esses avisos |
| Preços Fornecedor/Cliente | Duas buscas extras lado a lado confundiam | Fica uma busca da pessoa junto do seletor; a busca de material nativa continua separada |
| Cheques | “Desc. Compra?” sem clareza | Renomeado visualmente para “Abate compra?” e incluída explicação da regra de adiantamento |
| Cheques | KPI podia aparentar item compensado após exclusão | KPIs são rechecados a partir do controle vivo/tombstones; exclusão força nova renderização |
| Contas da Dona | Simples demais, sem vencimento/calendário | Competência mensal, data/dia de vencimento, atrasadas, vence hoje, pagas, pagar/reabrir e filtro |
| Adiantamentos | Ticket livre e novo adiantamento não refletia na compra | Ticket vira seleção de compra do fornecedor; inclusão/edição ajusta adiantamento e saldo da compra e Contas a Pagar |
| EPI/Almoxarifado | `ReferenceError: data is not defined` | Data de entrega passou a usar variável explícita `deliveryDate` e gravação explícita |
| EPI/Almoxarifado | Só parte dos funcionários ativos aparecia | Regra única de funcionário ativo em EPI, Almoxarifado, Viagem e Coordenação |
| Frota | Próxima revisão era texto livre | Campo convertido para calendário/data |
| Frota | Filtro de manutenção não filtrava corretamente | Filtro reaplicado por texto + status normalizado nos cartões |
| Viagem | Funcionário inativo no seletor | Seletor reconstruído somente com ativos |
| Viagem | Edição não possuía gastos extras | Campo de gastos extras/supérfluos incluído e persistido |
| Contas a Receber / Fiscal | Falta de ligação entre venda/recebível e cadastro fiscal | Vínculo explícito entre Conta a Receber e Cliente Fiscal, mantendo Comercial/Fiscal independentes |
| Custo Casa | Casa Glória ainda aparecia | Dados Casa Glória são consolidados em Casa e a aba é removida de forma recorrente |
| Coordenação | Só um de dois funcionários ativos aparecia | Reuniões e Advertências são repovoadas pela regra única de ativos; tipos padrão garantidos |

## Fluxo financeiro/comercial consolidado

A regra usada nesta revisão é:

`Venda -> Conta a Receber -> Cliente Fiscal/NF -> Recebimento -> Banco/Fluxo de Caixa`

- **Venda** continua sendo a origem comercial.
- **Conta a Receber** continua sendo a obrigação financeira.
- **Cliente Fiscal** é um cadastro independente, vinculado explicitamente à Conta a Receber quando necessário.
- Ao baixar o recebimento pelo fluxo já existente, a movimentação bancária/Fluxo de Caixa continua sendo gerada quando uma conta bancária é informada.
- Não há mistura automática entre CLIENTES do Comercial e Clientes Fiscais; o relacionamento fica explícito e auditável.

## Arquivos da revisão

- `public/app/bootstrap.js`
- `public/modules/phase2/phase2-feedback.js` (correções do EPI e regra única de funcionário ativo)
- `public/modules/phase3/phase3-homologation.js`
- `public/modules/phase3/phase3-homologation.css`
- `test/phase3-homologation.test.js`

Não substitui `public/legacy/app-core.js`.
