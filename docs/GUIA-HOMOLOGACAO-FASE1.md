# Guia de homologação — Fase 1 ERP Manuela Metais

Execute primeiro em **HML**. Não faça merge para `main` enquanto algum cenário abaixo falhar.

## 0. Smoke test e carregamento

1. Suba os arquivos do pacote na branch `hml`.
2. Aguarde o deployment Preview ficar `Ready`.
3. Abra a HML e faça `Ctrl + F5`.
4. Confirme o indicador do Firebase verde.
5. No Console execute:

```js
console.log({
  phase1: window.__PHASE1_READY__,
  requirements: window.Phase1Requirements?.version,
  weighing: !!window.RoadWeighingFlow
})
```

Esperado:

```text
phase1: true
requirements: "1.1"
weighing: true
```

6. Navegue Dashboard → Fornecedores → Preços Forn. → Balança → Compra Sucata → Vendas. Não deve haver erro vermelho novo no Console.

---

## 1. Prioridade 1 — Balança / Balanceiro / Compra

### 1A. Somente Balanção

1. Abra **Operacional → Bal. Rodoviária**.
2. Crie uma compra para um fornecedor de teste, placa `ABC1D23`, motorista `TESTE`.
3. Informe peso de entrada `12000` e registre a entrada.
4. Escolha **Continuar aqui na Balança**.
5. Primeiro material: informe peso atual `8000`, material `COBRE MISTO`, clique **Adicionar material**.
6. Esperado: `COBRE MISTO = 4.000,0 kg`.
7. Segundo material: peso atual `7200`, material `ALUMINIO MOLE`, clique **Adicionar material**.
8. Esperado: `ALUMINIO MOLE = 800,0 kg`, sem perder o Cobre.
9. Faça `F5`. Os dois materiais e a etapa devem continuar.
10. Clique **Concluir pesagem e ir para Compra de Sucata**.
11. Esperado: abrir Compra de Sucata automaticamente e o ticket estar disponível para lançamento de preço.

### 1B. Balança → Balanceiro → Balança

1. Crie outro ticket com entrada `15000`.
2. Escolha **Enviar para o Balanceiro**.
3. O sistema deve abrir o Balanceiro mantendo o mesmo ticket.
4. Registre pelo menos dois itens/bags, por exemplo `ALUMINIO MOLE = 500 kg` e `COBRE MISTO = 300 kg`.
5. Clique **Concluir Balanceiro e voltar para a Rodoviária**.
6. Esperado: voltar para a Rodoviária, etapa **Peso final**.
7. **Validação do bug de layout:** na fila lateral deve aparecer somente um cartão compacto e o botão `🚛 Informar peso final`. O formulário completo de peso final não pode aparecer espremido na lateral.
8. Clique no botão lateral. O foco deve ir para o formulário grande no topo.
9. Informe peso final, por exemplo `14000`, e conclua.
10. Esperado: abrir Compra de Sucata automaticamente, mesmo ticket, materiais preservados.
11. Faça `F5` antes e depois do Balanceiro para validar persistência.

### 1C. Histórico e consistência

1. No Histórico da Rodoviária confira entrada, saída, líquido e material.
2. Ticket com status `Aguard. Preço` deve aparecer em **Compra Sucata → Pesagens Pendentes**.
3. Não pode existir ticket “concluído” na Rodoviária e invisível na Compra.

---

## 2. Prioridade 2 — Compra de Sucata

1. Abra o ticket criado no teste da Balança.
2. Confirme que material e peso vieram automaticamente.
3. Informe preços.
4. Preencha **Observação do material** em pelo menos um item.
5. Informe **Desconto da compra**, se aplicável.
6. Adicione um **Valor extra** e obrigatoriamente um motivo, ex.: `Frete`.
7. Finalize a compra.
8. Abra o detalhe e confira **Peso bruto total**, **Peso líquido total** e resumo financeiro.
9. Gere o PDF. Deve conter fornecedor, ticket, data, materiais, observações por item, bruto/líquido, R$/kg, total por item, desconto, extras/motivos, adiantamento, saldo e total.
10. Teste compartilhar PDF / WhatsApp.
11. O menu separado **Canhoto** não deve ser usado como fluxo principal; emissão fica centralizada em Compra.
12. Regra crítica: escolha um material existente e uma identificação. A identificação **não pode criar novo material no Estoque**.

---

## 3. Prioridade 3 — Agenda

1. Abra **Agenda Entregas**.
2. Clique diretamente em um horário vazio.
3. O modal deve priorizar: Cliente → Serviço → Forma de pagamento → Observação → Status.
4. Material/detalhe extra deve ficar em **Mais detalhes do agendamento**.
5. Clique **Cadastro rápido**, crie um cliente de teste e confirme que ele já fica selecionado.
6. Salve o agendamento e dê `F5`; deve permanecer.
7. Clique WhatsApp e confira exatamente:

```text
Oi NOME, tudo bem?
Este é um lembrete para o seu atendimento, dia DD/MM/AAAA às HH:MM.
Serviço: SERVIÇO
PODENDO HAVER ATRASOS DEVIDO A DEMANDA.
Obrigada    🤝
```

---

## 4. Prioridade 4 — Comercial / Vendas / Ficha Financeira

### 4A. Nova Venda

1. Abra **Vendas → Nova Venda**.
2. A coluna operacional `Identificação` não deve ser necessária para gerar material novo.
3. Escolha material existente, quantidade e preço.
4. Informe um **Adiantamento pago nesta venda**, por exemplo `200,00`.
5. Salve.
6. Em Contas a Receber/Ficha, o adiantamento deve constar uma única vez como recebido e o restante deve ser somente `total - adiantamento`.
7. O estoque deve baixar somente no material selecionado, sem criar variação pelo campo identificação.

### 4B. Ficha Financeira

1. Abra **Clientes**.
2. Na linha de um cliente deve existir botão **📋 Ficha**.
3. Abra a Ficha.
4. Não devem existir as ações `Saldo anterior`, `Quitar saldo (zerar)` e `Juntar cliente`.
5. Filtre De/Até e confira que o histórico respeita o período.
6. Teste **PDF**.
7. Teste **WhatsApp**.
8. Cliente inativo não deve aparecer nos seletores operacionais novos, mas seus registros antigos devem continuar no histórico.

---

## 5. Usabilidade transversal

### Ativos/Inativos

1. Inative um funcionário de teste.
2. Ele não deve aparecer em seletores operacionais de Ponto, Vales, EPI, Folha ou Coordenação.
3. O histórico antigo continua visível.

### Alertas

1. Crie um lembrete/documento com antecedência configurada.
2. Se estiver fora da antecedência, não pode alertar prematuramente.
3. Ao entrar na janela configurada, deve aparecer em Avisos.
4. Registro concluído/parado não deve continuar indevidamente como pendente.

### Calendário

1. O módulo deve aparecer como **Calendário**, não “Meus Afazeres”.
2. Teste histórico De/Até.
3. Teste busca por texto.
4. Abra a visão anual e procure vencimentos/lembretes/cursos/treinamentos cadastrados.

### Buscas, foco e teclado

1. Digite em buscas de tabelas grandes rapidamente.
2. O foco não pode sumir a cada tecla.
3. Nas tabelas editáveis use `↑` e `↓`; deve navegar pelos campos quando aplicável.
4. Setas não podem alterar acidentalmente valor numérico quando a intenção é navegar.

### Fornecedores e preços

1. Busque fornecedor por nome.
2. Exclua fornecedor de teste, dê `F5`: ele não pode ressuscitar.
3. Cadastre/edite múltiplos dados bancários pelo botão 🏦.
4. Clique em uma linha: deve haver destaque visual.
5. Em Preços Forn./Clientes digite `30`; ao sair do campo deve aparecer `30,00`.
6. Digite `9,50`; deve salvar `9,50`, nunca `9,00`.
7. Teste busca por material.
8. Confirme que a **Imagem WhatsApp** de preços continua funcionando como já homologada.

---

## 6. Financeiro

### Contas a Pagar

1. Fluxo comum de Conta a Pagar deve continuar funcionando.
2. Abra aba **Contas a Pagar Fixas**.
3. Cadastre conta fixa `TESTE FIXA`, R$ `100,00`, vencimento dia `10`.
4. Clique **Gerar mês**.
5. Deve criar uma conta pendente normal.
6. Clique Gerar mês novamente: não pode duplicar no mesmo mês.
7. Pausar definição não apaga lançamentos já gerados.

### Adiantamentos

1. Procure por fornecedor.
2. Filtre por banco.
3. Recursos explicitamente removidos da especificação (snapshots/sincronização visual antiga) não devem poluir a operação.
4. Histórico deve permanecer preservado.

### Bancos

1. Pesquise banco/titular/conta/PIX.
2. Ações antigas aprovadas para remoção (`snapshot`, `puxar pagamento`, `zerar saldos`) não devem aparecer.
3. Se houver nomes duplicados, deve aparecer alerta **Revisar bancos duplicados** sem apagar nada automaticamente.

### Cheques

1. Filtre por número.
2. Filtre por banco.
3. Filtre por fornecedor/cliente.
4. Cadastre sequência `198` e `200` sem `199`.
5. Deve avisar possível numeração faltante, **sem bloquear** o salvamento.
6. Tente número já existente: deve avisar repetição, sem exclusão automática.
7. Foco da busca deve permanecer durante a filtragem.
8. Ações antigas de sincronização, depósito em lote/remessa e alertas de cabeçalho aprovados para remoção não devem aparecer.

### Navegação

1. **Ficha do Cliente** deve estar agrupada em Comercial, conforme RN-05.

---

## 7. RH / Frota / Viagem

### Vales

1. Novo vale: competência deve aceitar mês/ano.
2. Use busca de funcionário.
3. Salve e confirme persistência.

### EPI / NR-06 ↔ Almoxarifado

1. Cadastre no Almoxarifado um item de EPI com quantidade `5`.
2. Registre entrega desse mesmo EPI para funcionário.
3. Estoque do Almox deve cair para `4` e registrar movimento.
4. Teste o sentido já existente: saída do Almox para funcionário deve gerar registro EPI quando aplicável.
5. Edite/corrija registro EPI pelo botão ✏️.
6. Teste impressão mensal/filtro por mês.

### Frota / Manutenção

1. Cadastre manutenção por tipo/status.
2. Use a busca nova por tipo, descrição, oficina/equipamento.
3. Edite e confirme que o histórico permanece.

### Viagem Motorista

1. Crie viagem com dinheiro entregue.
2. Informe **Gastos extras/supérfluos aprovados**, por exemplo `100,00`.
3. Ao salvar, o acerto/devolução deve considerar esse valor.
4. A coluna de extras deve aparecer na listagem.

### Ponto / Folha

1. Confirme campos essenciais de cálculo já existentes: nome, cargo, base, falta, atestado, adicional, abono, viagem, diárias e hora extra manual.
2. Não validar a reestruturação maior de RH/Ponto/Folha ainda: AD-03/RN-07 estão fora desta homologação.

---

## 8. Fiscal e Administração

### Fiscal

1. Abra Fiscal → **Cadastros Fiscais independentes**.
2. Cadastre `CLIENTE FISCAL TESTE`.
3. Confirme que isso **não cria automaticamente um cliente Comercial**.
4. Inative/ative o cadastro.
5. Não cobrar campos fiscais finais: FIS-02 está aguardando AD-02.

### Despesas Grupo

1. Teste busca por descrição/fornecedor/empresa/grupo.
2. Confirme preservação do histórico.

### Contratos

1. Teste busca por contrato, fornecedor ou identificação.

### Custo Casa

1. Verifique áreas separadas: Casa, Sítio, Casa Glória e Veículos Pessoais.
2. Troque mês/período e confira histórico correto.

### Lista de Compras

1. Confira filtro **Histórico / Comprados**.
2. Itens comprados devem continuar consultáveis.

### Documentos

1. Abra novo documento.
2. Clique **Nova categoria**.
3. Crie uma categoria de teste.
4. Salve/reabra modal; categoria deve continuar disponível.

### Coordenação

1. Use busca.
2. Use filtro de mês/período.
3. Funcionários inativos não devem aparecer como opções operacionais novas.

---

## 9. Regressão obrigatória antes do merge para PROD

1. Login Firebase continua funcionando.
2. `F5` não perde tickets em andamento, bags, materiais, compras, contas fixas nem cadastros auxiliares.
3. Estoque: excluir material e atualizar página; material não pode ressuscitar por histórico.
4. Clientes e fornecedores continuam separados.
5. Combustível/Tanque continua lendo Firebase e não deve ressuscitar dados via localStorage.
6. Recibo da Compra continua exibindo todos os adiantamentos aplicados.
7. Download do template da Ficha do Cliente continua funcionando.
8. Valor brasileiro `20.000,00` em Adiantamentos continua salvando como R$ 20.000,00.
9. Custo Casa mantém a aba visual correta (Casa/Sítio/etc.).
10. Agenda ainda permite agendar clicando diretamente no horário.
11. Tabela de preços: imagem WhatsApp permanece no tamanho já aprovado.
12. Console sem erros novos de CSP/Firebase; `favicon.ico 404` isolado não bloqueia operação.

---

## Critério para merge `hml` → `main`

Marcar a Fase 1 como homologada somente quando:

- todos os cenários aplicáveis acima passarem;
- nenhum dado desaparecer após `F5`;
- nenhum histórico financeiro for apagado pela nova interface;
- nenhum material novo for criado apenas por `Identificação`;
- tickets da Rodoviária/Balanceiro chegarem corretamente em Compra;
- AD-01, AD-02 e AD-03 permanecerem sem implementação presumida;
- FIS-03 permanecer fora desta entrega sem aditivo comercial.
