# ERP Manuela Metais — Guia de homologação Fase 3

Faça todos os testes em **HML** e dê `Ctrl + F5` antes de começar.

## 1. Compra de Sucata — ticket não encontrado

1. Abra **Compra Sucata > Histórico**.
2. Clique em um ticket existente pelo valor/detalhe.
3. No modal, clique em **Editar / Impureza** ou na ação de edição do ticket.
4. Altere uma observação e salve.
5. Feche e abra novamente o mesmo ticket.

**Aprovado quando:** não aparece `Ticket não encontrado` e a alteração permanece depois de F5.

## 2. Bancos múltiplos — Cliente e Fornecedor

### Cliente
1. Abra **Clientes**.
2. Na linha do cliente clique no botão bancário existente.
3. Cadastre 2 contas (Banco, Agência, Conta, PIX) e salve.
4. Reabra e confira as 2 contas.

### Fornecedor
1. Abra **Fornecedores**.
2. Clique **🏦 Bancos** na linha do fornecedor.
3. Cadastre 2 contas e salve.
4. Reabra.

**Aprovado quando:** as duas entidades aceitam mais de uma conta e a primeira continua aparecendo como conta principal nos fluxos antigos que só conhecem um banco.

## 3. Calendário por usuário + Avisos

1. Abra **Calendário**.
2. Clique **+ Novo compromisso**.
3. Crie um compromisso para daqui a 5 dias.
4. Em **Responsável**, escolha um usuário específico.
5. Salve.
6. Use filtros **De / Até**, usuário e busca para localizar.
7. Entre com o usuário responsável.
8. Abra **Avisos**.

**Aprovado quando:** o compromisso aparece somente para o responsável nos avisos. Nos dias exatos de 5, 3 e 1 dia antes, o usuário recebe o popup de lembrete uma vez por dia/navegador.

Também teste editar, concluir, reabrir e excluir um compromisso.

## 4. Preços Fornecedor / Cliente

1. Abra **Preços Forn.**.
2. Deve haver somente **uma busca de fornecedor** junto do seletor.
3. A busca de material continua na área da tabela.
4. Repita em **Preços Clientes**.

**Aprovado quando:** não existem dois campos extras lado a lado com funções redundantes.

## 5. Cheques

### Regra “Abate compra?”
1. Abra **Cheques (Controle)**.
2. Passe o mouse/observe a coluna **Abate compra?**.
3. A explicação no topo deve informar que **Sim** significa cheque usado como adiantamento que reduzirá uma compra; não significa apenas compensação bancária.

### Exclusão/KPI
1. Cadastre um cheque de teste.
2. Marque como compensado.
3. Confira KPI `Compensados = 1`.
4. Exclua o cheque.
5. Espere alguns segundos e dê F5.

**Aprovado quando:** `Total no controle` e `Compensados` ficam zerados se não restar nenhum cheque vivo.

### Lacuna
1. No mesmo banco, cadastre 198 e 200.
2. Deve aparecer aviso de **199 faltando**.

## 6. Contas da Dona

1. Abra **Contas da Dona**.
2. Crie uma conta `Internet pessoal`, R$ 100,00, vencimento dia 20.
3. Mude a competência no filtro mensal.
4. Volte para o mês do teste.
5. Clique **Pagar**.
6. Clique **Reabrir**.

**Aprovado quando:** a tela apresenta Previsto, Pago, Atrasadas e Vence hoje; o vencimento é tratado por mês e existe filtro de competência/status.

## 7. Adiantamentos vinculados à compra

1. Pegue uma compra/ticket com `Adiantamento R$ 120,00`.
2. Abra **Adiantamentos > Novo Adiantamento**.
3. Selecione fornecedor, valor `10,00` e em **Compra relacionada** selecione o ticket correto.
4. Salve.
5. Volte em **Compra Sucata > Histórico**.

**Esperado:** adiantamento do ticket vira `R$ 130,00` e o saldo a pagar diminui R$ 10,00. A Conta a Pagar do mesmo ticket acompanha o novo saldo.

Depois edite o adiantamento de R$ 10,00 para R$ 15,00. O ticket deve aumentar apenas R$ 5,00, e não duplicar o valor inteiro.

## 8. EPI / Almoxarifado

1. Confirme que existem 2 funcionários ativos em **Funcionários**.
2. Abra **EPI / Almox. > Entrega de EPI**.
3. Os dois ativos devem aparecer no seletor.
4. Cadastre no Almoxarifado 10 unidades de um EPI.
5. Entregue 1 unidade.

**Esperado:** estoque vai de 10 para 9 e não aparece `ReferenceError: data is not defined`.

6. Abra **Por Funcionário** e confira a entrega somente no funcionário escolhido.

## 9. Frota / Manutenção

1. Abra **Frota**, entre na ficha de um equipamento.
2. Clique **+ Nova Manutenção**.
3. `Próxima revisão` deve ser um campo de **data/calendário**.
4. Crie manutenções com status `Concluída` e `Em Andamento`.
5. Use o filtro de status.
6. Use a busca de serviço/oficina/tipo.

**Aprovado quando:** cada filtro esconde os cartões que não correspondem.

## 10. Viagem Motorista

1. Tenha 2 ativos e 1 inativo.
2. Abra **Viagem Motorista**.
3. O inativo não pode aparecer no seletor de Motorista.
4. Crie uma viagem.
5. Edite a viagem.
6. A edição deve mostrar **Gastos extras / supérfluos aprovados**.
7. Altere e salve.

**Aprovado quando:** o valor permanece após F5 e é refletido no resumo/prestação de contas.

## 11. Contas a Receber + Venda + Fiscal

1. Gere uma venda para um cliente comercial.
2. Confirme que ela gerou a Conta a Receber como já ocorre no ERP.
3. Abra **Contas a Receber**.
4. Na linha, clique **🧾 Fiscal**.
5. Selecione um **Cliente Fiscal** previamente cadastrado e informe NF/Pedido.
6. Salve.

**Aprovado quando:** o recebível mantém o cliente comercial e fica relacionado ao cadastro fiscal escolhido, sem copiar/misturar os cadastros.

Ao receber em banco, valide também que o fluxo bancário continua sendo movimentado pelo fluxo existente.

## 12. Custo Casa

1. Abra **Custo Casa**.
2. Não deve existir aba **Casa Glória**.
3. Deve existir apenas Casa, Sítio, Veículos Pessoais e Resumo conforme a configuração atual.
4. Dê F5.

**Aprovado quando:** Casa Glória não reaparece após F5 e lançamentos antigos dela aparecem consolidados em Casa.

## 13. Coordenação

1. Garanta 2 funcionários ativos e 1 inativo.
2. Abra **Coordenação > Reuniões / DDS**.
3. Os 2 ativos devem aparecer em Participantes; o inativo não.
4. Abra **Advertências**.
5. Os mesmos 2 ativos devem aparecer no seletor.
6. Verifique o tipo de reunião: Reunião, DDS, Treinamento, Inspeção/Segurança e Outro.
7. Abra também a aba **Funcionários** da Coordenação e confira ativos/inativos.

## 14. Regressão rápida

Após todos os testes:

- F5 não deve restaurar Casa Glória.
- F5 não deve apagar múltiplos bancos.
- F5 não deve apagar compromissos.
- Cheque excluído não deve ressuscitar.
- EPI não pode baixar estoque duas vezes.
- Funcionário inativo não pode voltar para EPI, Viagem ou Coordenação.
- Compra de Sucata deve continuar mostrando observações e valores anteriores.
