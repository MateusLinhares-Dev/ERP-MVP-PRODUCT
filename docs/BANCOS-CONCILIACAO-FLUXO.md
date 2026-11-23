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
- saídas de pagamento (`LB-PG-…`) e de adiantamento;
- desde a v244, todas as contas bancárias e todo o extrato (ver a seção acima).
- desde a v251, os cheques de fornecedor da aba antiga (`cheques`) e suas marcas de exclusão (ver "Cheques de fornecedor da aba antiga").
- desde a v252, os saldos de fornecedor (`saldoDevedor`, `saldos` e `saldoDevedorDeleted`; ver "Saldos de fornecedor").

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
| Adiantamentos → "De quem veio?" (empresa na lista) | Mostrava "definida", mas voltava depois do F5 | Ação `company` em `advance-change`: o servidor troca só a empresa (v244) |
| Ficha do fornecedor → Editar ou excluir cheque | Achava pelo número (o primeiro de mesmo número, de qualquer banco) e mudava só na tela | Vai pelo `id` e grava no servidor (v251) |
| Ficha do fornecedor → Cancelar saldo | Apagava só na tela | Ação `clear` em `supplier-balance` (v252) |

Também foi removido código sem uso: "marcar compra paga" (sem botão) e `_aplicarAdiantamentosCP` (sem chamadas).

## Contas bancárias e extrato: só o servidor grava (17/11/2026, v244)

Desde a v244 o navegador não grava mais `bancos` nem `lancBanco` (nem as marcas de exclusão `bancosDeleted`/`lancBancoDeleted`). Tudo passa pela API `POST /api/banking/ledger` (`server/modules/banking/application/bank-ledger.ts`, regras puras em `domain/bank-ledger-rules.ts`):

| Ação | O que faz | Onde na tela |
|---|---|---|
| `create-account` | Cria a conta com o próximo código `BC-NNN`. Recusa conta repetida (mesmo banco, agência, conta e empresa). | Contas bancárias → + Nova Conta |
| `update-account` | Edita a conta. O CPF/CNPJ só fica em "Conta Terceiro". Recusa se outra tela alterou antes (`expectedUpdate`). | Editar conta |
| `delete-account` | Exclui a conta e grava `bancosDeletedV2/<id>`. Bloqueia se houver lançamento no extrato ou adiantamento pendente. | Mais → Excluir conta |
| `add-entry`, `update-entry`, `delete-entry` | Lançamento manual do extrato. Editar e excluir mandam a versão que a tela viu e são recusados se o lançamento mudou. Excluir grava `lancBancoDeletedV2/<id>`. | Extrato → Novo lançamento, Editar, Excluir |
| `clear-cheques` | Compensa um ou vários cheques do controle: marca `s:'C'` e a data, e lança a saída (`LB-CHQ-…`, `source:'cheque'`) na conta ligada ao banco do cheque. | Cheques a compensar → Compensar e Depositar em lote |
| `reopen-cheque`, `delete-cheque` | Voltam o cheque para "A compensar" ou o excluem, tirando a saída do extrato. | Cheques a compensar → Reabrir, Excluir |

Regras:
- **Lançamentos automáticos não se mexem pelo extrato.** São os pagamentos (`LB-PG-`), repasses (`LB-REP-`), vendas (`LB-VD-`), recebimentos (`LB-CR-`), adiantamentos e cheques compensados. O servidor recusa e diz em qual tela desfazer; o extrato mostra "Automático".
- **Trocar o código da conta** só é aceito quando o código está repetido em outra conta (para corrigir duplicidade). Os lançamentos com o código antigo passam para o novo. Fora disso o servidor recusa, porque pagamentos e adiantamentos guardam o código.
- **Cheques:**
  - cheque de adiantamento segue a regra automática: cheque de terceiro não baixa o banco; cheque próprio baixa se o adiantamento ainda não saiu do banco;
  - cheque antigo marcado "desconta da compra" continua perguntando;
  - sem acesso a Bancos (`canBanking`), o cheque é compensado sem lançar no extrato e a tela avisa;
  - reabrir ou excluir um cheque que já saiu do banco exige acesso a Bancos;
  - cheque de adiantamento só sai pelo módulo Adiantamentos.
- O resto do controle de cheques (`chequesControle`: cadastrar e editar cheque) continua gravado pela tela.
- Saíram as ferramentas escondidas "Sincronizar adiantamentos/pagamentos com o banco" e "Zerar saldos": gravavam adiantamentos e contas a pagar pela tela, o que não funciona mais desde que esses dados passaram para o servidor.
- `bancosCorrigeEmpresa` só ajusta a exibição e não grava mais.
- **Snapshots:** a restauração é feita pelo servidor (`/api/admin/snapshots`) e continua funcionando. Saiu `_snapshotPersistirExato`, uma cópia antiga que gravava tudo pelo navegador e não era chamada por ninguém.

**Ordem de implantação** (a mesma da v242):
1. Publique o código.
2. Espere todos recarregarem (v244).
3. Só então rode `npm run deploy:rules:prod`.

Uma aba antiga que ainda grava o extrato teria esse envio recusado pelas regras novas.

## Tela "Cheques a compensar" em React (19/11/2026, v255)

A aba é React (`web/modules/cheque-control/`, ligada em `web/erp/cheque-control.tsx` no `#cheques-compensar-app`) e grava pela mesma API `banking/ledger`. Os dados continuam no legado (`CHQ_CTRL`, `chqInit` e o ouvinte do Firebase), e a tela lê tudo por `window.erpChequeControlSnapshot()`.

O que a cliente via era o resultado de três camadas: a tela antiga, a fase 2 (escondia a ajuda antiga e "Sincronizar aba antiga", acrescentava a conferência de numeração e o aviso do número no formulário) e a fase 3 ("Abate compra?", textos dos botões, totais sem os excluídos). A tela nova faz tudo isso direto, e as rotinas das fases 2 e 3, que rodavam a cada mudança na página, saíram.

Mudanças visíveis:
- **"Compensou":** abre uma janela com a data, no lugar do `prompt`. Quando o cheque abate compra e não é de adiantamento, a janela mostra dois botões ("Só marcar como compensado" ou "Compensar e descontar do banco") em vez do `confirm` de OK/Cancelar.
- **Datas no formulário e na remessa:** passaram a usar o calendário. A remessa antes era texto.
- **"Descontar carga":** chama a API de cheques de fornecedor com o `id` certo. Antes, num cheque antigo sem `id`, podia marcar outro cheque.
- **"Sincronizar aba antiga":** continua fora da tela, como já estava (a fase 2 escondia). A função `chqSincronizarAbaAntiga` ficou no legado.

Regras (iguais às de antes, agora em `domain/control.ts` e `domain/forms.ts`, testadas em `test/cheque-control-web.test.js`):
- **Desconto no banco ao compensar:** cheque próprio de adiantamento desconta; cheque de terceiro não; adiantamento que já saiu do banco não.
- **Cheque que abate compra sem adiantamento:** a tela pergunta. No depósito em lote ele não desconta de novo.
- **Excluir e reabrir:**
  - cheque de adiantamento só sai pelo adiantamento;
  - cheque que já saiu do banco exige acesso a Bancos.
- **Numeração:**
  - lacunas por banco;
  - salto acima de 250 é tratado como outro talão;
  - a lista mostra no máximo 48 linhas;
  - número repetido não salva;
  - número pulando a sequência pede confirmação só no cadastro novo.
- **Perfil secretária:** não vê totais, cartões, depósito, exportar, compensar, reabrir nem excluir.

## Saldos de fornecedor só pelo servidor (19/11/2026, v252)

O navegador não grava mais `saldoDevedor`, `saldos` nem `saldoDevedorDeleted` (regras com `.write: false`). A API é `POST /api/finance/supplier-balance` (`changeSupplierBalance` em `server/modules/purchases/application/supplier-balance.ts`). Na tela, a chamada é `_saldoFornApi`, também em `window.erpSupplierBalanceRequest`.

Um registro nesses nós pode ter dois significados:
- **Crédito do fornecedor (tem `ticket`):** é a sobra de adiantamento de uma compra antiga; o fornecedor deve. A compra oferece esse valor como "Crédito restante do fornecedor", e o servidor confere a origem (`verifyLegacyCredit`).
- **Saldo devedor registrado (sem `ticket`):** foi lançado pela Ficha ("Registrar Saldo Devedor" ou "Saldo inicial: você deve"); a empresa deve. A compra nunca conseguiu usar esse registro e mostrava "Conciliação financeira necessária".

Ações:

| Ação | Onde | O que faz |
|---|---|---|
| `clear` | Ficha → Excluir no saldo ou no crédito | Tira dos dois nós, conferindo o valor que a tela viu |
| `to-payable` | Ficha → "Levar para Contas a Pagar" (só saldo sem `ticket`) | Cria uma conta a pagar `compra_antiga` do fornecedor, com vencimento hoje, e tira o saldo na mesma gravação |

Regras:
- **Trava:** `erpFinanceAdvanceLocks/<fornecedor>`, a mesma da compra e do adiantamento.
- **Operação:** fica registrada em `erp/supplierBalanceOperations`. Exige `canFinance`.
- **Crédito com `ticket`:** não vira conta a pagar (`BALANCE_IS_CREDIT`), porque seria dívida no sentido errado.
- **Leitura:** a tela junta os dois nós, preferindo `saldoDevedor` (o que o servidor confere) e caindo em `saldos` quando o primeiro não tem valor.
- **Compra que usa o crédito:** agora grava `saldos` igual a `saldoDevedor`, mesmo quando `saldos` não existia. Antes, quem fazia essa cópia era a tela.

Problemas corrigidos junto:
- **"Registrar Saldo Devedor (R$ …)"** aparecia quando a Ficha mostrava valor a pagar e gravava essa dívida como crédito do fornecedor. Esse valor já está nas contas a pagar das compras. O botão saiu.
- **"Saldo inicial: você deve"** gravava a dívida no mesmo lugar do crédito. Agora cria uma conta a pagar `compra_antiga` do fornecedor (`Saldo inicial — <nome>`), que se paga pelo caminho normal. "Ele te deve" continua abrindo o formulário de adiantamento.
- **Totais do topo da Ficha:** contavam o saldo devedor registrado e o saldo anterior como pagamento, enquanto a coluna de saldo os somava como dívida, e o "Saldo atual" podia sair diferente da última linha. Agora os dois usam a mesma regra (`_ffEhDebito`). Quando há dívidas além das compras, o primeiro total se chama "COMPRAS E DÍVIDAS".
- **Ficha:** passa a mostrar as contas `compra_antiga` sem ticket do fornecedor (saldo inicial e saldo levado para Contas a Pagar) e os pagamentos delas. O crédito com `ticket` aparece como "Crédito do fornecedor – sobra de adiantamento da compra …".

Publicação: código primeiro; regras só quando todos estiverem na v252.

## Cheques de fornecedor da aba antiga só pelo servidor (19/11/2026, v251)

O navegador não grava mais `cheques`, `chequesPorFornDeleted` nem `chequeItensDeleted` (regras com `.write: false`). A aba antiga "Cheques" já não está no menu, mas as funções dela e a Ficha do fornecedor continuam e agora usam `POST /api/finance/supplier-cheques` (`changeSupplierCheque` em `server/modules/banking/application/supplier-cheques.ts`). Na tela, a chamada é `_chequeFornApi`, também em `window.erpSupplierChequeRequest`.

| Ação | Onde |
|---|---|
| `create` | Lançar Cheques (formulário com várias linhas) |
| `update` | Editar (aba antiga) e Editar na Ficha do fornecedor |
| `delete` | Excluir (aba antiga e Ficha) |
| `clear` / `reopen` | Dar baixa / Estornar baixa |
| `discount` | Descontado, Desfazer desconto, Descontar todos do fornecedor |
| `cancel` / `reactivate` | Cancelar / Reativar |
| `restore` | Restaurar no Log de alterações (só a Elaine) |

Regras:
- **Trava:** `erpFinanceAdvanceLocks/<fornecedor>`, a mesma da compra e do adiantamento, e `erpFinanceAdvanceLocks/__supplier_cheques__`, porque a conferência de número repetido olha todos os fornecedores.
- **Operação:** fica registrada em `erp/supplierChequeOperations`; repetir o pedido não grava duas vezes. Exige `canFinance`.
- **Número repetido no mesmo banco:** é recusado em qualquer fornecedor, fora os cancelados. A regra é a dos adiantamentos (`chequeIdentity`).
- **Cheque usado numa compra** (`_aplicadoTicket` ou situação "Quitado"):
  - não pode ser excluído nem cancelado;
  - número, banco, valor, vínculo e situação não mudam;
  - observação, bom para, empresa e finalidade podem mudar;
  - compensar e estornar continuam; o estorno volta para "Quitado" (o servidor guarda `statusAnterior`).
- **Cheques antigos sem `id`:**
  - a tela usa `CHQ_<número>_<fornecedor>`;
  - quando o número se repete, a posição na lista desempata;
  - na primeira gravação daquele fornecedor, todos ganham `id` (`CHQ_104_F001`, `CHQ_104_F001_2`).
- **Restaurar:**
  - volta com `id` novo, para que as marcas de exclusão antigas guardadas no navegador não escondam o cheque, e com `restauradoDe`;
  - só volta como "Quitado" se a compra ainda tem o cheque no recibo;
  - é recusado se o cheque já está na lista;
  - tira o fornecedor de `chequesPorFornDeleted` quando a lista dele tinha sido apagada.
- **Leitura:** a tela confia na lista `cheques` da nuvem sempre que ela vem na leitura.

Problemas corrigidos junto:
- **Ficha do fornecedor:** editar ou excluir cheque achava pelo número e só mudava na tela; excluir não deixava marca, então o cheque podia voltar. O cheque usado em compra aparecia como "Pendente" no formulário, e salvar trocava a situação sem querer. Agora mostra "Quitado (usado em compra)".
- **Estornar a baixa de cheque usado em compra** deixava o cheque "Pendente", disponível para outra compra. Agora volta para "Quitado".
- **Lista da aba antiga:** quebrava quando algum cheque não tinha "bom para" e ordenava a data como texto (pelo dia). Agora ordena pela data.
- **Saiu** `salvarCheque()`, formulário de um cheque só que nenhuma tela abria.

Publicação: código primeiro; regras só quando todos estiverem na v251.

## Notinha mostra o valor total do adiantamento (19/11/2026, v253)

A cliente escrevia nas observações "descontado adiantamento de 9.999,48, ficando saldo devedor de 258,53". A notinha mostrava o abatido e o que sobrou, mas não o valor total do adiantamento. O resumo "Situação financeira do pedido" agora mostra:
- **Valor total do adiantamento** (ou "dos adiantamentos usados", ou "dos adiantamentos e cheques usados"): soma do `valorOriginal` do recibo da compra;
- **Já usado em compras anteriores:** quando parte do adiantamento já tinha sido usada antes (`valorOriginal − valorAplicado − valorPendente`), para os números fecharem;
- depois, como antes: abatido no fechamento, pagamentos posteriores, saldo a pagar e saldo devedor do fornecedor.

A coluna do detalhe passou a se chamar "Valor total do adiantamento". Compras antigas sem recibo usam o `valorOriginal` do próprio adiantamento.

## Usar o adiantamento da compra mais antiga para a mais nova (23/11/2026, v262)

Caso Sergio Spader. Havia duas notinhas, T259 (17/11, R$ 29.963,40) e T715 (19/11, R$ 103.573,25), e dois adiantamentos, de 17/11 (R$ 99.990,80) e de 19/11 (R$ 32.000,00). A cliente usou "Usar adiantamento nesta compra" na T715. O sistema pôs os R$ 99.990,80 inteiros e mais R$ 3.582,45 do de 19/11 na T715, e a T259, mais antiga, ficou em aberto. O saldo final estava certo (R$ 1.545,85), mas na compra errada. A cliente pensa como na Ficha: o adiantamento de 17/11 paga a T259, sobram R$ 70.027,40, e esses mais os R$ 32.000,00 vão para a T715, que fica com R$ 1.545,85. Ela desfez a compensação e não achou como fazer nessa ordem. A tela mostrava "Adiantamento livre R$ 131.990,80", e ela esperava R$ 102.027,40, porque a T259 ainda estava em aberto.

Correção:
- **Servidor** (`applyAdvances` em payables): entre os adiantamentos que valem para a conta, usa primeiro o ligado ao pedido e depois o **mais antigo pela data**. Antes usava a ordem da lista.
- **Plano da compra mais antiga para a mais nova** (`erpSupplierAdvancePlan` / `erpSupplierCompensateOldestFirst` em purchase-order.js):
  - pega as contas em aberto do fornecedor: notinhas e saldo inicial (`compra_antiga`);
  - ordena pela data da compra e, dentro do pedido, pelo vencimento da parcela;
  - simula o uso do adiantamento como o servidor faz;
  - mostra numa confirmação o que cada pedido abate e com quanto fica;
  - compensa conta por conta pelo mesmo caminho de Contas a Pagar.
- **Edição da notinha:** se o fornecedor tem compra em aberto mais antiga, o quadro amarelo diz qual é e o resultado ("este pedido abate R$ 102.027,40 e fica com R$ 1.545,85 a pagar"). Ele oferece "Usar da mais antiga para a mais nova" ou "Usar só nesta compra". A oferta depois de salvar uma edição também segue a mais antiga primeiro.
- **Ficha do fornecedor:** botão **Compensar adiantamentos (R$ …)**, que aparece quando há adiantamento livre e compra em aberto.
- **Ficha mais clara:** a parte de um adiantamento usada numa compra aparece como "Parte do adiantamento X de 17/11/2026, usada no Ticket T259", com a data do adiantamento, logo antes do resto dele. O adiantamento original mostra a divisão: "Valor total R$ 99.990,80: R$ 29.963,40 no Ticket T259, R$ 70.027,40 no Ticket T715". O saldo acumulado lê como a cliente pensa: 29.963,40, depois 0,00, "te deve 70.027,40", 33.545,85 e por fim 1.545,85.

Testes:
- `test/supplier-advance-oldest-first.test.js`;
- `test/payables-advance-reconciliation.test.js` (mais antigo primeiro no servidor);
- teste de tela com o caso do Sergio, pela Ficha e pela edição da T715, com F5 (8/8 cada).

## Painel, Ficha e extrato do fornecedor contam só notinhas (23/11/2026, v260)

Depois da v259 procurei o mesmo defeito em outras telas: somar **todo** ticket de `TICKETS_DB` como se fosse compra. A mesma lista guarda notinhas, pesagens da balança (em andamento, "Aguard. Preço", "Consolidado") e pesagens de venda. Estes lugares somavam tudo:
- **Painel:** "Compras do mês" (valor e número de tickets) e o gráfico de 6 meses. Uma pesagem juntada numa notinha contava como mais um ticket. A pesagem guarda os quilos, não o valor, por isso o valor quase não mudava, mas a contagem sim.
- **Extrato do fornecedor, canhoto e "fornecedores sem entrega há 30 dias"** (`_indiceTicketsPorForn`): mostravam a pesagem "Consolidado" ao lado da notinha dela.
- **Ficha do fornecedor:** a pesagem "Consolidado" aparecia como compra, e a pesagem de venda também, quando tinha o código do fornecedor.
- **Resumo do fornecedor no lançamento antigo** (últimas compras): mesma coisa. Ele também quebrava quando havia um ticket sem data.

A regra agora é uma só (`_ticketEhCompra` / `_ticketsDeCompra` no app-core). Conta como compra o ticket que:
- não é pesagem de venda;
- não é pesagem em andamento (`_balSessao`, `_rodEntrada`, `_rodSessao`);
- não está "Aguard. Preço", "Aguard. Saída" nem "Consolidado";
- não foi juntado numa notinha que ainda existe.

O estoque usa a mesma lista de pesagens juntadas (`_pesagensConsolidadas`) e continua contando a pesagem que aguarda preço, porque o material já está no pátio.

Também na v260:
- **"Cheques pendentes" do Painel:** somava só os cheques da aba antiga de cheques de fornecedor. Agora soma os cheques "A compensar" de **Cheques a compensar** (`chequesControle`), sem os excluídos. É o mesmo número que a tela mostra. O Painel se redesenha quando a lista de cheques chega.
- **Excluir notinha antiga:** além das pesagens que apontam para a notinha (`_consolidadoEm`), também volta para "Aguard. Preço" a pesagem "Consolidado" que está só na lista `_ticketsOrigemIds` da notinha. Isso não vale para pesagem que aponta para outra notinha.

Testes: `test/stock-weighing-double-count.test.js` (4), `test/dashboard-supplier-credit-regression.test.js` (Painel com cheques) e `test/erp-load-performance.test.js` (extrato sem pesagens). Teste de tela: Painel, Ficha, extrato e estoque com notinha, pesagem juntada, pesagem aguardando preço e pesagem de venda (6/6).

## Estoque: pesagem que virou notinha contava em dobro (23/11/2026, v259)

A cliente perguntou se excluir uma notinha tira o material do estoque, porque o estoque deu "uma diferença muito grande". O estoque não é gravado: é calculado na hora. As entradas vêm dos tickets em `TICKETS_DB` (`getEntradasMaterial`) e as saídas, das vendas e das entregas da Ficha do Cliente. Excluir uma notinha tira os quilos dela, mas a soma de entradas pegava **todo** ticket. Isso causava:
- **Contagem em dobro:** a pesagem da balança que virava notinha continuava contando ("Consolidado"), e a notinha também. Exemplo: 1.000 kg pesados apareciam como 2.000 kg.
- **Pesagem de venda (`tipo: 'venda'`) como entrada:** ela somava no estoque, enquanto a venda já tirava o material.
- **Exclusão da notinha:** a pesagem de origem ficava "Consolidado", apontando para uma notinha que não existe mais. Continuava contando e não podia ser lançada de novo.

Correção:
- **Cálculo** (`_ticketsNoEstoque`): não conta pesagem de venda. Não conta pesagem já transformada em notinha que ainda existe (pelo `_consolidadoEm` da pesagem ou pelo `_ticketsOrigemIds` da notinha). Uma pesagem cuja notinha foi excluída volta a contar, porque o material continua no pátio.
- **Exclusão da notinha** (`deletePurchaseOrder`): as pesagens consolidadas nela voltam para "Aguard. Preço" (`_balFinalizado: true`, sem `_consolidadoEm`, `_liberadoDe` com o número da notinha). A tela avisa: "A pesagem … voltou para Aguardando preço: o material continua no estoque até você lançar a notinha de novo ou excluir a pesagem."
- **Pesagens de notinhas excluídas antes da v259:** continuam "Consolidado" (não voltam sozinhas), mas contam no estoque como antes.

Depois de atualizar, o estoque cai nos materiais que chegaram pela balança (some a contagem dupla) e nos que tiveram pesagem de venda. Se alguém ajustou "Estoque inicial" ou "Saídas" à mão para compensar a diferença, esses ajustes precisam ser revistos.

## Excluir "dinheiro recebido para repasse" e desfazer PIX de repasse (22/11/2026, v258)

O botão "Dinheiro recebido / Valor a repassar" da Ficha do fornecedor serve para quando o fornecedor entrega dinheiro em espécie e a empresa devolve por PIX. A cliente o usou por engano para registrar que o fornecedor pagou parte de uma dívida (caso Helmerson Peixer: R$ 1.955,70 e R$ 2.775,75). O módulo só registrava; não excluía nem desfazia.

Agora `POST /api/finance/supplier-cash-repasses` tem mais duas ações:
- **`delete`:** exclui um recebimento que ainda não teve PIX. Apaga `fornecedorRepasses/<forn>/<id>` e a entrada em espécie `fornecedorRepassesCaixa/<id>`, que é a que aparece no fluxo de caixa. O banco não é mexido, porque o recebimento nunca lançou nada no banco. Se o recebimento já teve PIX, recusa com `RECEIPT_HAS_REPASSES`.
- **`undo-pay`:** desfaz um PIX registrado por engano. Apaga a saída `LB-REP-…` do extrato e marca `lancBancoDeletedV2`; o valor volta a ficar a repassar.
- **Nas duas:** confere `expectedVersion`, registra a operação e exige `canPayables` ou `canFinance`, como as outras ações.

Na janela, cada recebimento sem PIX ganhou **Excluir recebimento**, e cada PIX ganhou **Desfazer PIX**. A tela tira a saída do extrato local na hora (`window.erpBankMovementRemoved`).

Também na v258:
- **Aba "Custo Casa":** saiu do menu, da lista de permissões de usuário e do quadro do painel, a pedido da cliente. "Contas da Dona" continua. Os dados (`custosCasa`) ficam guardados. Quem tinha "Custo Casa" como primeira aba entra na primeira aba que existe.
- **Tabelas de preço (fornecedor e cliente):** texto do WhatsApp, imagem, impressão e a lista da tela de cliente saem em ordem alfabética (`_precosOrdenados`, ignorando acento, números em ordem natural). Antes saíam na ordem em que os preços foram gravados.

## Excluir adiantamento ou notinha que já quitou conta (19/11/2026, v257)

Caso da cliente (Ismael, T449): um adiantamento de R$ 25.000 quitou R$ 9.915,45 da conta da T449 em Contas a Pagar. Na Ficha isso aparece em duas linhas: a sobra de R$ 15.084,55 (Pendente) e a parte usada (Pago, "Compensação parcial – CP"). Ao tentar excluir a sobra, o sistema recusava (`ADVANCE_ALREADY_COMPENSATED`) e mandava usar o 🕒 da conta. A conta, porém, está quitada e não aparece no filtro "Em aberto" de Contas a Pagar. Excluir a notinha também recusava, com "Estorne o pagamento antes de excluir", sem dizer onde.

Agora:
- **Excluir adiantamento** (lista, Ficha do fornecedor, `excluirAdiantamento`): quando o servidor recusa por compensação, a tela procura os pagamentos que usaram o adiantamento (`adtUsos[].cod` ou `adtUsos[].parcial`, por `window.erpPaymentsOfAdvance`). Ela mostra a conta e o valor e oferece desfazer: o valor volta ao adiantamento, a conta volta a ficar em aberto e o banco não é mexido.
  - **Se a linha era a parte usada** (`origem: compensacao_cp`), termina aí: a linha some e o adiantamento de origem volta inteiro.
  - **Se era o adiantamento:** depois de desfazer, a tela pergunta de novo se quer excluir; a exclusão leva a saída do banco junto.
- **Excluir notinha** (`excluirEntradaCompra`): com `PURCHASE_HAS_FINANCE`, `PURCHASE_HAS_PAYMENTS` ou `PURCHASE_HAS_LINKS` e pagamentos na conta, a tela lista os pagamentos e oferece "Desfazer e excluir a compra". A segunda tentativa não pergunta de novo.
- **Ordem do desfazer:** `window.erpUndoPayments` desfaz do último pagamento para o primeiro de cada conta, porque o índice muda ao excluir. Cada desfazer é o mesmo estorno do 🕒 (`reversePayablePayment`).
- **Contas a Pagar:** com texto na busca e filtro de situação diferente de "Todas", aparece "Há mais N conta(s) com “…” fora do filtro “Em aberto” (contas quitadas, onde fica o 🕒…)" com o botão **Mostrar todas** (`hiddenByStatus`).
- **Pagamento antigo sem `adtUsos`:** a mensagem explica como achar a conta (filtro "Todas" em Contas a Pagar).

## Baixar o total de uma notinha já paga ou compensada (19/11/2026, v256)

Caso da cliente (T449): a notinha foi salva sem adiantamento e quitada depois com "Usar adiantamento nesta compra" (ou "Compensar adiantamento" em Contas a Pagar). Ao corrigir os itens, o total ficou R$ 292,60 abaixo do que já estava compensado, e a edição travava em "Requer conciliação". O único jeito de sair era Contas a Pagar → 🕒 → Excluir. Mas Contas a Pagar abre no filtro "Em aberto" e a conta quitada não aparece; é preciso escolher "Quitadas" ou "Todas".

Agora, na edição das compras confirmadas pelo servidor (`_purchaseOperationId`):
- **Quadro Pagamento:** lista "Pagamentos e compensações feitos depois do fechamento" (os `pagamentos` das contas do pedido), cada um com o botão **Desfazer**. Ele usa o mesmo estorno de Contas a Pagar (`window.erpPayablesReverse`):
  - compensação: o valor volta ao adiantamento e o banco não é mexido;
  - pagamento em dinheiro: a saída sai do extrato.
- **Itens já editados:** continuam na tela depois do Desfazer (`phase4PurchaseUndoPayment` reabre o pedido e devolve itens, desconto, frete, observações e datas).
- **Ao salvar a edição depois de desfazer uma compensação:** o sistema pergunta "Usar de novo o adiantamento?" (`offerAdvanceAgain`, mesmo caminho da v250).
- **Mensagens:**
  - o saldo mostra "Pago a mais: R$ …" no lugar de "Requer conciliação";
  - o erro ao salvar diz para clicar em "Desfazer";
  - nas compras antigas, o erro aponta para o 🕒 de Contas a Pagar no filtro "Quitadas".

As regras de dinheiro não mudaram: são três operações que já existiam (estorno, edição e compensação), cada uma conferida pelo servidor. Teste de tela: desfazer, salvar e usar de novo, com a compra quitada no fim, a sobra no adiantamento e o banco intacto.

## Usar adiantamento lançado depois da notinha (18/11/2026, v250)

Caso da cliente (T353): a notinha de R$ 70.622,40 foi fechada usando R$ 52.506,24 de adiantamento (sobraram R$ 18.116,16). Depois chegou um adiantamento novo de R$ 150.093,96, e a notinha não oferecia usá-lo.

- **Regra:** a regra de Contas a Pagar não muda: "Pagar → Compensar adiantamento" (`payPayable` com `advanceAmount`, sem banco). Ela usa os adiantamentos Pendentes do fornecedor que não estão presos a outra compra, divide o que sobra (`compensacao_cp`) e pode ser desfeita pelo 🕒 (o adiantamento volta inteiro).
- **Na notinha:** Compra Sucata → Histórico → Editar mostra no quadro Pagamento "Adiantamento livre deste fornecedor: R$ … — Usar adiantamento nesta compra". O botão confirma quanto vai usar e quanto sobra, compensa as parcelas em aberto da mais antiga para a mais nova e reabre o pedido atualizado. Ponte: `window.erpPayablesCompensateAdvance` (`web/erp/payables.tsx`).
- **Na impressão:** "Adiantamentos / abatimentos no fechamento" continua com o do fechamento (R$ 52.506,24). O novo aparece em "Pagamentos e abatimentos posteriores" (R$ 18.116,16) e na tabela "Pagamentos registrados após o pedido" (Compensação de adiantamento). O que sobra (R$ 131.977,80) aparece como saldo devedor do fornecedor.
- **Limite:** o botão só aparece em compras confirmadas pelo servidor (`_purchaseOperationId`). Em compras muito antigas, uma rotina antiga do `phase3` recalcula compra e conta na tela, então elas seguem pelo caminho de Contas a Pagar.

## Tirar adiantamento de uma compra (18/11/2026, v248)

Pedido da cliente: apagar um adiantamento que já estava abatido numa notinha (ex.: R$ 3.424,95 na T269), sem quebrar a compra.

A ação nova `POST /api/finance/purchase-advance-detach` (`server/modules/purchases/application/detach-purchase-advance.ts`) tira **um** adiantamento de **uma** compra, numa gravação só:
- **Adiantamento:** volta a ficar Pendente com o valor que estava abatido naquela compra (`refundAdvanceReceipt` com o código do adiantamento). O histórico fica em `devolucoesCompra`.
- **Compra:** o abatimento (`adiantamento`) cai, o saldo a pagar sobe no mesmo valor e o recibo registra a devolução (`reciboFinanceiro.devolucoes`). O total dos itens não muda.
- **Contas a Pagar:** com parcela única, a conta da compra sobe; parcelado, a última parcela em aberto sobe; compra já quitada ganha uma conta nova com a diferença (`CP-AJUSTE-…`, a mesma regra da correção de compra paga).
- **Proteções:**
  - mesmas travas da edição de compra e dos adiantamentos;
  - recusa se a compra mudou em outra tela;
  - repetir a mesma operação não devolve duas vezes;
  - compra paga com cheque ou crédito antigo continua pedindo conciliação;
  - é preciso acesso a Compras e a Adiantamentos (ou Financeiro).

Onde a cliente usa:
- **Adiantamentos → 🗑:** se o adiantamento está abatido em compra, a tela mostra o(s) pedido(s) e o valor e oferece tirar da compra. Depois disso, a exclusão normal continua (com a confirmação de sempre).
- **Compra Sucata → Histórico → Editar pedido:** o quadro Pagamento lista os adiantamentos abatidos, cada um com o botão "Tirar desta compra". A tela reabre o pedido já atualizado.
- Adiantamento usado para pagar uma conta em Contas a Pagar (não uma compra) continua pelo 🕒 Excluir pagamento.

## Controle de cheques só pelo servidor (18/11/2026, v247)

Desde a v247 o navegador também não grava `chequesControle` nem `chequesControle_del` (regras com `.write: false`). A aba "Cheques a compensar" continua igual, mas cada ação vai à API `banking/ledger`:

| Ação | Botão |
|---|---|
| `save-cheque` | + Novo Cheque e Editar (formulário) |
| `batch-cheques` | 📦 Remessa (vários): números em sequência, pula os que já existem no banco |
| `toggle-cheque-discount` | 🛒 desconta da compra |
| `import-legacy-cheques` | 🔄 Sincronizar aba antiga (enviado em lotes de 200) |
| `clear-cheques`, `reopen-cheque`, `delete-cheque` | Compensar, depositar em lote, Reabrir, Excluir (v244) |

Problemas corrigidos junto:
- **Editar cheque que já saiu do banco:** o formulário deixava trocar valor, banco, número, situação ou data de compensação sem mexer no extrato. A saída ficava sobrando ou com valor diferente. Agora o servidor recusa e pede Reabrir antes (o valor volta ao banco). Destino, data de saída e vencimento continuam editáveis.
- **Cheque de adiantamento:** não se edita nem se marca/desmarca "desconta da compra" pelo controle; corrige-se pelo próprio adiantamento.
- **Número repetido no mesmo banco:** o servidor recusa, com a mesma regra dos adiantamentos (`chequeIdentity`). "Cheque de Terceiro" pode repetir.
- **🔄 Sincronizar aba antiga:**
  - antes, ela marcava como "NÃO EXISTE" cheques que não estavam na aba antiga, inclusive os criados pelos adiantamentos, e regravava o cheque apagando o vínculo com o adiantamento;
  - agora o servidor preserva os cheques de adiantamento e, nos que já saíram do banco, muda só o nome e a data;
  - ao marcar "não existe", mantém os outros dados do cheque.
- **Saíram** os botões de correção de uma vez só ("➕ Completar Gratus Sicredi", "🔧 Corrigir Acredi" e a correção definitiva do Gratus Sicredi). Eles aplicavam conferências de agosto e dezembro de 2025, e rodar de novo hoje podia desfazer compensações e cancelamentos feitos depois. A configuração `legacyRepairs` no Firebase deixou de ser usada para isso.
- **Saiu** a rotina de "reparo" que rodava ao abrir a aba (`_chqRepararBase`), que estava vazia.

## Tela de Bancos em React (17/11/2026, v245)

A aba Contas Bancárias é React (`web/modules/banking/`) e grava pela mesma API `banking/ledger`. Nada muda para a cliente, exceto:
- **Menu "Mais":** acompanha o botão quando a tabela ou a página rolam, em vez de fechar, e continua aberto quando outro computador grava. Antes, a rolagem que o próprio clique provoca (botão perto da borda, tela estreita) podia fechar o menu na hora.
- **Busca:** agora procura também no código, tipo, CPF/CNPJ, observação e empresa, sem diferenciar acentos.
- **Excluir conta:** a tela confere os lançamentos antes de perguntar. O servidor confere de novo, também os adiantamentos pendentes.
- **Novo lançamento:** já vem com a data de hoje.

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
