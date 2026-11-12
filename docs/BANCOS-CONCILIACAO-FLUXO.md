# Bancos, conciliação e fluxo de caixa: revisão de 11/11/2026

## Fluxo de caixa

O fluxo agora conta o dinheiro **na data em que ele saiu ou entrou**. A função é `_fluxoTotaisAno` em `public/legacy/app-core.js`.

| Situação | Antes | Agora |
|---|---|---|
| Conta a pagar com pagamento parcial (ex.: 300 em outubro e 700 em novembro) | Só os 700 do último pagamento entravam, em novembro; os 300 sumiam | 300 em outubro e 700 em novembro, um por pagamento do histórico |
| Conta paga, total ou em parte, com adiantamento | A parte do adiantamento contava duas vezes: quando o adiantamento foi dado e de novo na conta | Conta só o dinheiro pago no banco. O adiantamento já entrou em "Adiantamentos Forn." |
| Adiantamento compensado em parte numa compra ou conta | A parte usada mudava para o mês da compra | Fica no mês em que o adiantamento foi pago |
| Conta paga sem histórico de pagamentos (registro antigo) | — | Igual a antes: o valor entra na data de pagamento |

O cálculo é feito em uma passada só, e não mais 48 passadas por ano.

## Bancos e extrato

- **Bancos com o mesmo nome** (ex.: dois Sicredi, um de cada empresa):
  - antes, as telas que escolhem o banco pelo nome mostravam um só, e a entrada caía sempre no primeiro;
  - agora aparecem separados, por exemplo "Sicredi — B1" e "Sicredi — B2";
  - o lançamento vai para a conta escolhida.
- **`registrarMovBanco`** procura primeiro pelo código da conta, depois pelo nome.
- **Editar conta a pagar e marcar "Pago"** lança a saída na conta escolhida pelo código, e não pelo nome. O pagamento também passa a ficar no histórico da conta.
- **Extrato:**
  - mostra 25 por página, com opção de 50 ou 100;
  - o mais recente vem primeiro;
  - a busca procura em todos os lançamentos (descrição, data ou valor), e não só nos da tela;
  - o filtro de datas vale para todos os lançamentos.
- **Lançamentos automáticos:**
  - um lançamento feito pelo pagamento de uma conta a pagar aparece como "Automático", sem Editar e Excluir;
  - antes, editar ou excluir esse lançamento só mudava a tela: ele voltava ao recarregar, e a conta continuava paga;
  - para desfazer, use o Histórico de pagamentos da conta.
- **Histórico de pagamentos (🕒):**
  - cada pagamento tem o botão "Excluir", e excluir pela Ficha do fornecedor usa a mesma rotina;
  - a exclusão é feita **no servidor** (`reversePayablePayment`, no mesmo endpoint do pagamento, com `action: 'reverse'`);
  - numa única gravação: a conta volta a ficar devida, a saída sai do extrato (com marca de exclusão para as outras telas), o saldo do ticket é corrigido e as telas abertas são avisadas;
  - antes (11/11, primeira versão), a exclusão era feita na tela e, nas contas de compra (`CPPO_…`), não era gravada: o pagamento voltava depois do F5;
  - numa conta já quitada com pagamentos de 300 e de 700, excluir o de 300 deixa em aberto só os 300;
  - a operação é recusada se a conta mudou em outra tela, se o pagamento não confere, se usou adiantamento ou se o usuário não tem acesso a Contas a Pagar;
  - repetir a mesma operação não desfaz duas vezes.
- **Saldo depois de pagar uma conta:**
  - o saldo do banco atualiza na hora;
  - antes, só atualizava ao recarregar o ERP;
  - o servidor também avisa as outras telas abertas (`erp/_ts`).
- **Mudar conta "Pago" para "Pendente" na edição:**
  - se a conta tem histórico de pagamentos, o ERP abre o histórico para excluir o pagamento por lá;
  - sem histórico, pergunta se deve retirar a saída do extrato.
- **Receber conta a receber:**
  - a conta é localizada pelo código, e não pela posição na lista;
  - uma conta já recebida não é recebida de novo.
- **Adiantamento de cliente já usado em venda** não pode ser excluído. Primeiro exclua ou edite a venda.
- **Descrições de lançamentos** com caracteres especiais (`&`, `<`) são gravadas como digitadas, e não mais como código HTML.

## Dados que só o servidor grava

A sincronização da tela antiga **não grava** alguns dados, porque eles pertencem ao servidor:
- todos os adiantamentos;
- tickets de compra confirmados (`_purchaseOperationId`);
- contas de compra (`CPPO_…`) e contas ligadas a esses tickets;
- saídas de pagamento (`LB-PG-…`) e de adiantamento.

Qualquer botão que mude esses dados só na tela parece funcionar, mas volta ao recarregar. Foram corrigidos:

| Onde | Antes | Agora |
|---|---|---|
| Contas a Pagar → 🕒 → Excluir pagamento | Voltava depois do F5 nas contas de compra | Feito no servidor |
| Contas a Pagar → Editar conta de compra | Mudava só na tela | Avisa para usar Editar no Histórico de compras |
| Ficha do fornecedor → ➕ Lançar adiantamento | Criava só na tela, e o banco também não gravava | Abre o formulário oficial de adiantamento, já com o fornecedor |
| Ficha do fornecedor → Saldo inicial "ele te deve" | Criava adiantamento só na tela | Abre o formulário oficial de adiantamento com o valor |
| Ficha do fornecedor → Editar ou excluir adiantamento | Mudava só na tela | Usa a edição e a exclusão do servidor |
| Ficha do fornecedor → Editar compra confirmada | Mudava só na tela | Abre a edição do pedido |
| Ficha do fornecedor → Excluir compra confirmada | Apagava só o ticket e deixava a conta de compra no servidor | Usa a exclusão segura do pedido, que confere pagamentos e devolve adiantamentos |
| Impureza em compra confirmada | Mudava só na tela | Avisa para usar Editar no Histórico de compras |
| Formulário de adiantamento aberto pela Ficha | Ficava atrás da janela da Ficha | A Ficha se esconde e volta ao fechar |

Também foi removido código sem uso: "marcar compra paga" (sem botão) e `_aplicarAdiantamentosCP` (sem chamadas).

## Sincronização: fornecedor (ou outro registro) sumindo

- **O que acontecia:** quando o mesmo registro estava gravado em duas chaves no Firebase (uma antiga sem `id` e outra nova), a limpeza de duplicados marcava o `id` como excluído. Como os dois têm o mesmo `id`, **os dois sumiam** da tela, e a marca de exclusão podia ir para as outras telas.
- **Agora:** a cópia é retirada da lista sem marcar o `id` que continua em uso.
- Vale para todas as listas sincronizadas (fornecedores, vendas, contas a receber, lançamentos etc.).
- Teste: `test/cash-flow.test.js`.

## Inicialização

- Ao restaurar a sessão depois do F5, a falta da lista de telas do usuário quebrava a abertura (`cu.tabs[0]`).
- Agora abre o Início.

## Conciliação

- **OFX:**
  - linha com valor zero (ex.: "SALDO DO DIA") é ignorada; antes, ela cancelava a importação inteira;
  - aceita valores com mais casas decimais (`-38.900000`), separador de milhar (`1.234,56` ou `1,234.56`), sinal `+` e valor como `-.5`.
- **"Registrar movimento no ERP"** atualiza o saldo de Bancos na hora e avisa as outras telas. "Criar título financeiro" também avisa.
- **Lista de movimentações:**
  - mostra 100 por vez, com "Mostrar mais";
  - a busca e os filtros procuram em todas as movimentações.
- **O que a conciliação faz** (API `/api/banking/reconcile`, só para quem tem `canBanking`):
  - importa OFX sem duplicar (FITID/conteúdo e conta de origem); o extrato importado não mexe no saldo;
  - sugere títulos por valor, data, tipo e descrição;
  - liga vários títulos a um movimento e vários movimentos a um título, com alocação parcial sem passar do valor;
  - ajustes (tarifa, desconto) exigem categoria e são só metadados: não viram lançamento contábil;
  - concilia em lote até 30 correspondências exatas, tudo ou nada;
  - arquiva, classifica e desfaz, com histórico de quem e quando;
  - o mesmo título não pode ser conciliado duas vezes, nem em contas diferentes;
  - "Registrar movimento no ERP" e "Criar título financeiro" usam identificador determinístico (repetir não duplica); o título nasce Pendente.
- **Regra mantida:** conciliar **não** dá baixa em conta a pagar ou a receber, nem muda caixa ou saldo dos títulos. Só "Registrar movimento no ERP" mexe no saldo do banco; use apenas quando o movimento ainda não existir no extrato do ERP.
- **Limite:** até 10.000 eventos por conta; acima disso, é preciso arquivar.
- **Teste rápido:** importar `docs/examples/conciliacao-exemplo.ofx` duas vezes (a segunda não insere nada); ligar títulos de R$ 1.500 e R$ 1.000 a um débito de R$ 2.500 (diferença zero); tentar usar o mesmo título em outra conta (deve falhar).

## Pontos para combinar com a cliente

1. **Adiantamento de cliente:**
   - ao lançar, o ERP guarda o banco de entrada, mas não lança a entrada no extrato;
   - a entrada só aparece no banco quando o adiantamento é usado numa venda "Pago", na data da venda;
   - o mais correto seria lançar no dia em que o dinheiro entrou;
   - mudar isso exige tratar os adiantamentos antigos, para não contar em dobro. É o mesmo caso do cheque de cliente em `docs/REGRAS-CHEQUES-E-VENDAS.md`.
2. **Venda em permuta:** entra em "Vendas de Metais" no fluxo como dinheiro recebido. Se o fluxo for só de dinheiro, a permuta deveria ficar fora.
3. **Lançamentos manuais no banco não entram no fluxo:**
   - por exemplo, tarifas e lançamentos criados pela conciliação;
   - o fluxo é montado com contas a pagar, contas a receber, adiantamentos e repasses;
   - para incluir esses lançamentos sem contar em dobro, eles precisam ser marcados como "manuais" ao serem criados.

## Testes

- Testes automáticos:
  - `test/cash-flow.test.js`: fluxo e limpeza de duplicados;
  - `test/payable-payment-reversal.test.js`: exclusão de pagamento pelo servidor, com o SDK real do Firebase sobre o banco simulado;
  - `test/bank-refresh.test.js`: lançamento automático protegido;
  - `test/bank-reconciliation.test.js`: OFX;
  - `test/reconciliation-advanced.test.js`: aviso às outras telas.
- Teste de tela de Contas a Pagar: 15 verificações, com compra criada pelo servidor, pagamento parcial, exclusão no 🕒, **F5** e adiantamento pela Ficha.
- Teste de tela de Bancos: 38 verificações com as funções reais do servidor (conciliação, pagamento e exclusão), sobre o banco simulado, terminando com **F5**:
  - saldos;
  - extrato paginado;
  - lançar, editar e excluir;
  - bancos com o mesmo nome;
  - receber;
  - pagar parcial;
  - excluir pagamento;
  - fluxo;
  - importar OFX, conciliar, desfazer e registrar tarifa;
  - lista grande;
  - integrações.

## Como testar em HML

1. Bancos → Extrato de uma conta com muitos lançamentos:
   - aparecem 25 por vez, o mais recente primeiro;
   - a busca encontra um lançamento antigo.
2. Pague uma conta a pagar em parte. O saldo do banco muda na hora, sem F5.
3. Fluxo de caixa: o valor pago aparece no mês do pagamento.
4. Na conta paga, abra 🕒 e exclua o pagamento:
   - a conta volta a ficar devida com o valor certo;
   - a saída some do extrato, inclusive depois de F5.
5. Se houver dois bancos com o mesmo nome, receba uma conta escolhendo o segundo. A entrada cai nele.
6. Conciliação: importe um OFX que tenha linha de saldo zerada. A importação passa e ignora essa linha.
