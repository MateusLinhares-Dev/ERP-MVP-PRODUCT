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

## Varredura depois da v289; material excluído volta ao cadastro quando a compra o usa (26/11/2026, v290)

Verificações sem defeito:
- **Simulador:**
  - 44 abas e 316 cliques sem erro;
  - dois computadores no mesmo banco: o que um lança aparece no outro com o "Pedido lançado" no Histórico; a exclusão feita no outro devolve o adiantamento;
  - nenhuma gravação repetida com a tela parada, antes ou depois de cada ação.
- **Produção (leitura autorizada):**
  - nenhum erro de gravação registrado pelas telas em 48 h e `_ts` parado em 20 s;
  - as 122 compras do servidor batem com as contas a pagar. A T1431 só tem `CP-AJUSTE-T1431-…`, criada por "Tirar desta compra", e não `CPPO_`;
  - adiantamentos: valores, compensado e usos (recibos + `adtUsos`) fecham;
  - extrato: as 246 saídas têm origem, e todo adiantamento e pagamento em dinheiro tem sua saída;
  - vendas x contas a receber batem. A V0016 está "Pendente" porque vence no dia da venda (regra de `sale-order.ts`);
  - nenhuma pesagem presa a compra excluída.
- **Estoque negativo de RODA (−3.604,5 kg) e CHUMBO (−961,9 kg):** é dado, não defeito. As vendas de 19/11 (5.820 kg e 1.035 kg) passam das compras lançadas, e o estoque inicial desses materiais está zerado.

Defeito: a CHAPA DURA foi excluída do cadastro em 23/11 como "material sem movimento". Em 25/11, a edição da T781 passou a usar 223,5 kg dela. A tela nova de compra não cadastrava o material usado: só o fechamento antigo cadastrava as variantes, e a edição pelo servidor não cadastrava nada. O material continuou marcado como excluído, e a tela de Estoque escondia os 223,5 kg. A recuperação automática pula de propósito material excluído (regra da v30: compra antiga não ressuscita material excluído).

Correção:
- **Código:** `registerPurchaseMaterials` (purchase-order.js), chamado em `finishPurchaseSave` e `afterConfirmedPurchaseEdit`, passa cada material da compra confirmada por `_garantirMetalCadastrado`, que tira a marca de excluído e devolve o material ao cadastro. Isso só vale quando o material não está no cadastro ou está marcado como excluído; nome antigo de material renomeado continua no nome novo. Usar o material numa compra nova conta como reativação, como já era no fluxo antigo.
- **Produção:** feito backup em `scratchpad/prod/backup-chapa-dura.json`. Depois:
  - `CHAPA DURA` saiu de `erp/estoqueDeleted` (transação);
  - voltou a `erp/metais` e ganhou `erp/estoque/CHAPA DURA`;
  - entrou uma linha no Histórico ("Estoque", "Restaurado") e o `_ts` foi atualizado.

  A tela de Estoque mostra 223,5 kg. As outras quatro marcas com movimento (LATINHA SOLTA BATIDA, CROMO MAG, RODA DE CAMINHAO, MEDALHA) são nomes antigos de materiais renomeados e contam no nome novo.

Testes: `test/purchase-advance-load-first.test.js` e teste de tela (compra editada com material excluído: marca sai da nuvem, material volta ao cadastro e aparece no Estoque).

## Adiantamentos desta carga antes da sobra antiga; fechamento mostra quanto entra de cada um (26/11/2026, v289)

Queixa da cliente (CICLO, F619): na primeira notinha (T1379, R$ 62.280,20) os adiantamentos apareciam separados. Depois de tirar um material, a tabela virou só "Saldo devedor anterior". Ela excluiu e lançou de novo (T1421, R$ 32.040,20), marcou os adiantamentos e a tabela continuou só com o acumulado.

Leitura da produção (autorizada):
- **T1379, 11:28:** lançada sem adiantamento. Às 11:29 foram usados R$ 58.786,13: a sobra do PIX de R$ 90.000,00 de 24/11 (R$ 46.130,98, porque R$ 30.653,18 foram para a T983 e R$ 13.215,84 para o saldo inicial), mais os PIX de 25/11 de R$ 4.010,00 e R$ 8.645,15.
- **14:02 a 14:09:** a compensação foi desfeita e usada de novo três vezes, com o total já em R$ 32.040,20, até a exclusão da T1379.
- **T1421, 14:11:** marcados os adiantamentos. O servidor aplicou na ordem da lista, a sobra de 24/11 primeiro, e ela sozinha pagava tudo. Os dois PIX de 25/11 ficaram livres.
- **Saldos:** todos certos. O CICLO tem R$ 26.745,93 livres (14.090,78 + 4.010,00 + 8.645,15). Nada mudou na produção.

O "acumulado" é a regra da v263: a sobra de adiantamento já usado em outra compra aparece como "Saldo devedor anterior". O defeito era outro: no fechamento, a tela deixava marcar adiantamentos que não iam entrar, sem avisar. Além disso, ao usar de novo depois de uma edição, o sistema sempre começava pela sobra mais antiga, e os adiantamentos dados durante a carga saíam da notinha.

Mudanças:
- **Ordem "desta carga primeiro"** (`advancesThisLoadFirst` em purchase-order.js). Um adiantamento é sobra quando:
  - já foi usado em outra compra ou conta (`printAdvanceUsedElsewhere`, ou `valorCompensado` maior que o usado nesta compra);
  - é crédito ou saldo;
  - ou tem data até o último dia em que uma notinha anterior do fornecedor usou adiantamento (`printCarriedCutoff`).

  É a mesma regra da impressão. Os outros adiantamentos são desta carga e vêm primeiro; dentro de cada grupo, vale a data mais antiga.
- **Fechamento:**
  - a lista de adiantamentos vem nessa ordem (`loadFirstAdvances` nos pontos que montam a lista e na conferência de atualização);
  - os marcados seguem para o servidor (`advanceCodes`) e para o cálculo local (`pendentesAdt` em app-core) na mesma ordem;
  - cada adiantamento marcado mostra "Usa o valor todo.", "Usa R$ X e sobram R$ Y." ou "Não entra: o pedido já fica pago com os de cima." (`showAdvanceUse`, que desconta antes o crédito antigo marcado, como o servidor);
  - com dois ou mais adiantamentos, a tela avisa que os marcados são usados de cima para baixo.
- **Depois do fechamento** ("Usar adiantamento nesta compra" e "usar de novo" depois de desfazer e salvar a edição): `purchaseAdvanceOrder` manda a ordem em `erpPayablesCompensateAdvance(id, valor, ordem)` (web/erp/payables.tsx), que envia `advanceOrder` ao servidor.
- **Servidor** (`payPayable`, `applyAdvances` em payables.ts):
  - aceita `advanceOrder`, com até 200 códigos sem repetição; formato inválido dá `INVALID_ADVANCE_ORDER`;
  - continua usando primeiro o adiantamento reservado ao próprio ticket; depois segue a ordem recebida, e o que não estiver na lista vai por data;
  - a ordem entra na assinatura da operação.

  Sem ordem (Contas a Pagar e "Usar da mais antiga para a mais nova", que reparte entre várias compras), nada muda: vale a data.

Com a regra nova, na T1421 os PIX de 25/11 entrariam inteiros, e a sobra só com R$ 19.385,05.

Testes:
- `test/purchase-advance-load-first.test.js`: caso CICLO, uso parcial só nesta compra, notas de uso e passagem da ordem;
- `test/payables-advance-reconciliation.test.js`: ordem no servidor e ordem inválida.

## Edição da compra mostra cada adiantamento da compensação (25/11/2026, v288)

Dúvida da cliente na T863 (HUMBERTO MESCH): a notinha e a Ficha do fornecedor mostravam os dois adiantamentos separados (R$ 10.723,52 de 16/11 e R$ 75.000,00 de 23/11), mas a edição da compra mostrava uma linha só, "Compensação de adiantamento R$ 85.723,52". Os valores estavam certos: os dois foram usados depois do fechamento, num clique só, e o servidor grava isso como um pagamento com `adtUsos` (código e valor de cada adiantamento).

Agora, em "Pagamentos e compensações feitos depois do fechamento", cada linha continua com o total e um só "Desfazer" (o estorno devolve todos os adiantamentos daquele pagamento), e embaixo lista os adiantamentos usados: "Adiantamento de 16/11/2026 (PIX): R$ 10.723,52". Data e forma vêm de `ADT_POR_FORN` do fornecedor; se o adiantamento não for encontrado, mostra o código. Pagamentos antigos sem `adtUsos` ficam como antes.

Testes: `test/purchase-order-history-and-cheques.test.js`; teste de tela com a T863 da cópia da produção.

## Notinha "sumida" T1247; compra lançada e excluída entram no Histórico (25/11/2026, v287)

Queixa: a notinha de ALAN CACHIMBO de R$ 61.643,20, lançada hoje, sumiu; só a T1049 aparecia. Leitura da produção (autorizada):
- `purchaseCreateOperations/erp_thais_5fd08d57…`: T1247 criada às 14:27:14 por thais (12 itens, 1.834,9 kg, sem adiantamento e sem pesagem de origem, conta `CPPO_T1247` com vencimento em 25/11/2026);
- `purchaseDeleteOperations/thais_195d5e12…`: excluída às 14:29:59 por thais, `CONFIRMED`, com a conta `CPPO_T1247`;
- nenhuma outra notinha nem conta de R$ 61.643,20 (não foi lançada de novo).

Não foi falha de gravação: a exclusão só acontece pela lixeira do Histórico de compras ou da Ficha do fornecedor, depois de clicar OK em "Excluir a compra T1247?". Nesse horário, a mesma pessoa mexia na T1049 (adiantamento às 14:28, pagamentos desfeitos às 14:31 e 14:32, edição às 14:33), e a lixeira da T1247 fica na linha logo acima.

Recuperação na produção (backup em `scratchpad/backup-t1247-antes-restaurar.json`), em uma gravação só:
- `tickets/T1247` e `contasPagar/CPPO_T1247` voltaram do registro de criação;
- `ticketsDeletedV2/T1247` e `contasPagarDeleted/CPPO_T1247` apagados;
- `_untomb/tickets/T1247` e `_untomb/contasPagar/CPPO_T1247`, para que o computador que excluiu tire a compra da lista local de excluídos;
- entrada no Histórico ("Compra Sucata", "Restaurado") e `_ts`.

O estoque é calculado pelas notinhas, então voltou junto. Conferido no simulador com a lista local de excluídos da thais: a compra aparece no filtro "cach" ao lado da T1049, inclusive depois do F5, e o navegador não tenta apagá-la de novo. Na produção, a compra continuou lá nos 4 minutos seguintes.

Defeito corrigido: o Histórico mostrava "Pedido editado", mas não o lançamento nem a exclusão de uma compra. Por isso a exclusão parecia sumiço. Agora:
- `finishPurchaseSave` (só depois da confirmação do servidor) registra "Pedido lançado", com número, fornecedor e total;
- `excluirEntradaCompra`, depois do `CONFIRMED`, registra "Compra excluída", com número, fornecedor e valor, e guarda a cópia da compra no registro do Histórico. Exclusão recusada não entra.

Testes: `test/purchase-order-delete-guard.test.js`.

## Revisão depois da v285; recarga automática respeita formulário aberto (25/11/2026, v286)

Verificações, todas sem defeito, no simulador com a cópia da produção e as permissões reais:
- **Cliques:** 446 cliques nas 44 abas como Elaine, sem nenhum erro de tela.
- **Dado do servidor alterado só na tela** (o padrão dos defeitos da v279 e da v282): depois de abrir todas as abas, notinhas, adiantamentos, contas a pagar e a receber, vendas, clientes, fornecedores, bancos e extrato ficaram iguais à nuvem, comparando registro a registro.
- **Abrir abas:** não grava nada (só a marcação de chat lido).
- **Conflito de notinha** (fonte possível do aviso "Conflito de sincronização em ticket…", mostrado como "Falha ao confirmar"): nenhuma notinha fica "pendente" sem edição. Até a v282, o arredondamento das 42 notinhas do servidor com sobra de centavos criava essas pendências falsas, e o pagamento seguinte pelo servidor gerava o conflito.
- **Primeira gravação da sessão:** manda 41 itens (2 KB), dos quais 38 iguais (apagados e agenda); da segunda em diante, só o que mudou. Ficou como está.
- **Produção:** `erpAudit` sem falha de salvamento.

Defeito corrigido: a recarga automática da v281 só esperava por `#modal-ov`, janelas `*-ov` e campo com o cursor dentro. Uma janela das telas novas (React, `aria-modal`) ou um formulário preenchido pela metade, sem o cursor no campo, eram perdidos se a versão nova chegasse depois de 1 minuto sem uso. Agora `_telaParadaParaRecarregar` também espera:
- com `[aria-modal="true"]` ou `[role="dialog"]` visível;
- enquanto houver na tela um campo em que a pessoa digitou ou escolheu algo (eventos `input` e `change` com `isTrusted`), exceto pesquisa e filtro.

Testes: `test/stock-weighing-double-count.test.js`; teste de tela (campo digitado, diálogo aberto, saída da tela: 3/3) e o da versão nova (4/4).

## Agenda grava a situação na hora; salvamento sem sessão não dá erro (25/11/2026, v285)

Leitura da produção depois da v284 (só leitura):
- nenhuma falha de salvamento em `erpAudit` desde a publicação;
- regras publicadas idênticas a `database.rules.json` (lidas por `/.settings/rules.json`);
- os backups diários de 20/11 a 25/11 e a agenda atual (55 agendamentos) nunca tiveram um "Chegou".

Criar agendamento sempre funcionou; mudar a situação nunca chegou à nuvem. Era o laço de gravações (corrigido na v282), que recarregava várias vezes por segundo, somado à recarga que copiava a nuvem por cima do clique ainda não salvo (corrigida na v283).

Mudanças:
- `agendaStatus` (CHEGOU, CANCELAR, VOLTAR) grava na hora em `erp/agendaEntregas/<id>/status` e `_upd`, com `_ts` e `_user` no mesmo `update`, sem esperar os 0,8 s do salvamento geral. Se a nuvem recusar, a tela volta à situação anterior e avisa o motivo;
- `_fbSalvarAgoraInterno` sem sessão (logout, inclusive por inatividade, ou sessão caída) não tenta gravar nem publica erro. Mantém `mm_fb_pendente` e grava depois do próximo login.

Testes:
- `test/server-owned-sync-deletions.test.js`;
- teste de tela com outro computador gravando a cada 0,3 s: 5 CHEGOU e 1 VOLTAR gravados, e o outro computador vê;
- recusa da nuvem: volta a "Agendado" e avisa;
- queda de sessão com mudança pendente: aviso amarelo de pendência, sem erro;
- três usuárias com dados reais (6/6).

## Aviso "Falha ao confirmar dados no Firebase", diagnóstico e pesquisa nas contas da Dona (25/11/2026, v284)

Queixas:
- o aviso "Falha ao confirmar dados no Firebase. As alterações ainda estão pendentes..." aparece sempre, até na tela de login;
- a agenda mostrava EVANDRO com ✅, mas a janela dizia "Agendado" e não tinha VOLTAR;
- a cliente pediu um campo de pesquisa nas Contas pessoais da Dona.

Leitura da produção (só leitura): os 54 agendamentos estão todos como "Agendado", inclusive EVANDRO 25/11 13:00. O "Chegou" existia só no computador da Elaine. As duas primeiras queixas são o mesmo problema: os salvamentos daquele computador falham. O aviso fica preso até um salvamento dar certo, por isso aparece até depois do logout. A tela dela (v282, sem redesenho da agenda) mostrava a mudança local; a janela lia a cópia da nuvem.

A falha não foi reproduzida:
- simulador com a cópia da produção e as três usuárias com as permissões reais;
- regras de `_ts` (até 10 min do servidor) e `_user` (igual ao `erpUser`) imitadas;
- política do navegador comparada nó a nó com as regras (sem diferença);
- logout com mudança pendente, na v282 e na v283.

O emulador oficial precisa de Java, que a máquina de desenvolvimento não tem. Não havia nenhum registro do erro na produção.

Mudanças:
- **Diagnóstico.** Falha de salvamento vai para `erpAudit` (`action: sync_rejected`, `module: salvar`, `entityId` = código, `scope` = mensagem), no máximo uma vez por mensagem a cada 10 min (`_fbReportarFalhaSalvar`). O aviso passa a mostrar o motivo entre parênteses;
- **Sem recarga depois de sair.** `_fbTsOnValue` não roda sem sessão nem durante o logout. Antes, cada gravação de outro computador gerava "Sessão Firebase não autenticada" na tela de login;
- **Pesquisa nas Contas pessoais da Dona.** Campo "Pesquisar conta (ex.: internet)". Filtra os dois imóveis pela descrição, categoria e observação, sem diferenciar acento e maiúscula, e avisa quando a conta existe fora do mês escolhido. O cursor continua no campo enquanto se digita.

Próximo passo: depois de publicar, ler `erpAudit` com `module: salvar` para ver o motivo real das falhas da Elaine.

Testes: `test/server-owned-sync-deletions.test.js`; testes de tela (pesquisa, logout, agenda e três usuárias 6/6).

## Clique perdido na agenda, tela parada, consulta excessiva (25/11/2026, v283)

Queixa: "cliquei sem querer em CHEGOU e não tem como voltar". Os botões existem (VOLTAR na janela e "Voltar" na lista). Leitura da produção: os 55 agendamentos estavam como "Agendado", inclusive o do LUCAS, ou seja, nenhum "Chegou" tinha sido gravado. Revisão geral pedida pelo Mateus, com medições no simulador usando cópia local da produção (só leitura), três navegadores com as permissões reais (elaine, marlene, thais) e o banco simulado ordenando os campos como o Firebase real.

| Problema | Nome técnico | O que acontecia | Correção |
|---|---|---|---|
| Clique desfeito | Atualização perdida (*lost update*) por condição de corrida (*race condition*) | O salvamento espera 0,8 s. Se chegava uma recarga nesse intervalo, a cópia da nuvem era copiada por cima do registro local (`Object.assign(atual,item)`). Teste: 5 de 5 cliques em CHEGOU perdidos | Com mudança pendente, salva antes e recarrega depois. Leitura que pegou mudança no meio não é aplicada. Na mescla, o registro local com `_upd` mais novo fica |
| Tela parada | Dados desatualizados na tela (*stale UI*) | Agenda, afazeres, cheques, vales, EPI, lista de compras, viagens, custo da casa, fluxo, folha e documentos só redesenhavam ao trocar de aba. A guarita marcava "Chegou" e o escritório não via | Essas telas entram em `_fbAtualizarAbaAtivaSilenciosamente` |
| Banco inteiro a cada mudança | Consulta excessiva (*over-fetching*) e efeito manada (*thundering herd*) | Cada mudança fazia todos os computadores baixarem de novo todos os nós (medido: 3.006 KB nos três por um agendamento alterado; banco de 3,2 MB) | Cada nó fica com um ouvinte permanente (`_fbGarantirOuvinte`). O Firebase manda só a diferença e a recarga lê a cópia local (medido: 42 KB, 70 vezes menos). Sair do sistema solta os ouvintes |
| Leitura antes do dado chegar | Ordem de eventos (*event ordering*) | O aviso `_ts` pode chegar antes dos dados (cada caminho vem numa mensagem). Ao ler a cópia local na hora, outro computador não via o material renomeado e, ao salvar, gravava `metais` sem ele | `_fbEsperarDadosAssentarem`: espera 0,2 s e depois 0,15 s sem dado novo (limite 1,5 s) antes de ler |
| Avisos piscando | Redesenho desnecessário (*re-render*) | Toda recarga disparava "funcionários/documentos mudaram" e redesenhava Avisos | Só dispara quando o conteúdo mudou (a primeira carga continua disparando) |

A regravação do mesmo conteúdo, ou escrita redundante (*redundant write*, *write amplification*), em laço entre computadores (*feedback loop*, *write storm*) foi corrigida na v282. Medição na produção depois dela: 0 mudanças de `_ts` em 30 s.

Verificado e sem defeito:
- abrir cada uma das 44 abas não grava nada;
- nenhuma aba parada se redesenha sozinha. A única exceção é chamar `switchTab('lancamento_rapido')`, que não tem painel; nenhum usuário chega a esse estado (o Lançamento rápido abre em `/rapido/`);
- os temporizadores (`setInterval`) não leem nem gravam no banco.

Fica para depois: operações do servidor que leem um nó inteiro (por exemplo, todas as notinhas ao criar uma com crédito antigo, todo o extrato ao conciliar). São pontuais, e melhorar exige índices nas regras do Firebase.

Testes:
- `test/server-owned-sync-deletions.test.js` e `test/silent-firebase-sync-notifications.test.js`;
- testes de tela:
  - clique com outro computador gravando: 5/5 perdidos antes, 0/5 depois;
  - agenda recebendo mudança de outro computador;
  - três usuários reais (6/6; a v282 publicada falha na agenda);
  - tempestade (0);
  - medição de download;
  - estoque e agenda/WhatsApp (12/12).

## Aba Avisos piscando: computadores regravando sem parar (25/11/2026, v282)

Queixa: "a aba Avisos fica dando refresh, piscando direto".

Medição na produção (só leitura, autorizada), com o `_ts` mudando sem parar:

| Horário | Mudanças de `_ts` | Ritmo |
|---|---|---|
| 1ª medição | 290 em 60 s | ~5 por segundo |
| 2ª medição | 48 em 20 s | ~2,4 por segundo |
| 3ª medição | 58 em 15 s | ~4 por segundo |

- `_user` se alterna entre elaine, marlene e thais;
- nenhum dos 73 nós mudou de valor no período. Os computadores regravavam valores idênticos, e o único efeito era o `_ts` novo, que faz os outros recarregarem;
- a aba Avisos se redesenha a cada recarga (evento `erp:alert-source-changed` dos funcionários), por isso piscava.

Reprodução: cópia local do banco (só leitura) no simulador, com o banco simulado ordenando os campos como o Firebase real. Com dois computadores, bastou um salvamento qualquer para começar: 15 gravações de `_ts` em 25 s, todas em `erp/estoque`, 27 por vez, os 27 nomes de `estoqueDeleted`.

Causa, em duas partes:
- **"Apagar" reenviado sempre.** O `fbSalvar` manda `estoque/<nome apagado>: null` (e o mesmo para as outras listas de apagados) em todo salvamento. O filtro `_fbFiltrarJaEnviado` deixava passar todo `null`, mesmo já aplicado na nuvem. O valor não muda, mas a gravação leva um `_ts` novo.
- **Toda recarga virava salvamento.** `_arredondarDinheiro2Casas`, que roda dentro do salvamento, arredondava na memória as notinhas do servidor: 42 delas chegam da nuvem com sobra de centavos, como `1223.6000000000001`. Ele também arredondava os adiantamentos (do servidor) e chamava `saveDB()`, mantendo a gravação pendente. Cada recarga trazia os valores de volta sem arredondar, e o ciclo recomeçava. É o mesmo erro da v279: tela corrigindo dado do servidor.

Correção:
- `_fbFiltrarJaEnviado` não reenvia um `null` cuja base já é `null` (`_fbEnviadoOk[k]==='null'`, gravada por `_fbMarcarEnviado` depois de enviar). Se o registro reaparece na nuvem, `_fbRegistrarBaseConfirmada` troca a base e o apagar volta a ser enviado;
- `_arredondarDinheiro2Casas` ignora notinhas com `_purchaseOperationId` e não mexe mais em `ADT_POR_FORN`.

Testes:
- `test/server-owned-sync-deletions.test.js` (os dois falham sem a correção);
- teste de tela com a cópia da produção: 0 gravações (antes 15 `_ts`/405 gravações em 25 s);
- os testes de tela de estoque (renomear, espaços, dois computadores) e da agenda (12/12).

Depois da publicação, as abas na v281 se atualizam sozinhas quando ficam paradas; abas mais antigas precisam de F5. Para conferir: contar as mudanças de `erp/_ts` por um minuto (deve ser perto de zero com todos parados).

## RODA DE CAMINHÃO sumindo; estoque em dobro ao corrigir espaços; abas antigas avisadas sozinhas (25/11/2026, v281)

Queixa da cliente: "renomeei RODA DE CAMINHÃO para RODA DE CAMINHÃO OU RODA DE CARRO CROMADA; no outro dia apareceram as três; excluí as que estavam sem estoque, renomeei de novo e sumiu, igual à GRANA GROSSA".

Leitura da produção em 25/11 (autorizada):
- a RODA DE CAMINHAO (sem acento) tem 44,5 kg pela notinha T225 (IRIVALDO, 17/11);
- a Elaine excluiu "RODA DE CAMINHAO OU RODA DE CARRO CROMADA" em 23/11 às 16:33, e a EVELIN excluiu "RODA··DE CAMINHAO OU RODA DE CARRO CROMADA" (com **dois espaços**) em 25/11 às 09:06. As duas exclusões passaram como "sem movimento", com o registro vazio que o sistema cria sozinho. Ou seja, o vínculo com a RODA DE CAMINHAO (e os 44,5 kg) já não existia;
- de manhã, nem o nome antigo nem o novo estavam no estoque, os dois estavam na lista de apagados, e só a RODA aparecia;
- `erp/_appBuild` estava em v276, embora o site já estivesse na v280: nenhum administrador tinha aberto o sistema desde 24/11, e as abas antigas nunca receberam o aviso de versão;
- nenhum outro material com movimento estava sumido.

Os dias 23 e 24 passaram por versões com as listas de apagados somadas entre computadores (até v276) e com a troca de nome que não levava os quilos (antes da v271). Com o código da v280 a sequência da cliente funciona no teste de tela, com um ou dois computadores abertos.

Correção dos dados (gravação autorizada, com cópia salva antes):
- `erp/estoque/RODA DE CAMINHAO OU RODA DE CARRO CROMADA` recriado zerado, igual ao cadastro original no snapshot de 24/11, com `nomesAnteriores: ["RODA DE CAMINHAO"]`. Ele volta a mostrar os 44,5 kg da T225;
- o nome entrou em `erp/metais`;
- as duas grafias do nome saíram de `erp/estoqueDeleted` (agora 27 nomes). A RODA DE CAMINHAO continua lá, porque virou nome antigo;
- `erp/_appBuild` = v280, para que as abas antigas mostrem o aviso.

Defeitos de código encontrados e corrigidos:
- **Estoque em dobro ao corrigir espaços ou maiúsculas.** Renomear "RODA··DE CAMINHAO" para "RODA DE CAMINHAO" (ou "latinha" para "LATINHA") apagava o nome antigo só no navegador. A nuvem ficava com os dois registros, e no F5 o estoque dobrava (teste de tela: 30 kg viravam 60). Agora o registro antigo sai da nuvem (`erp/estoque/<antigo>`), com aviso se a gravação falhar.
- **Nome com espaço repetido.** Criar e renomear material gravam com um espaço só (`replace(/\s+/g,' ')`). A marca de apagado (`_normalizarTombstoneEstoque`) passou a comparar sem diferença de espaços, como a chave do estoque já fazia. "Novo material" acusa repetido também quando só muda espaço ou maiúscula. A produção não tinha nenhum material ativo que essa comparação escondesse.
- **Renomear não ficava registrado.** Agora entra no Histórico como "Estoque / Renomeado" (sem botão de restaurar).
- **Aba antiga sem aviso.** O aviso de versão dependia de um administrador abrir a versão nova, e só começava quando a sessão era restaurada, não num login novo. O build passou a gerar `version.json` com o `_APP_BUILD`. Cada aba consulta esse arquivo (20 s depois de abrir, a cada 3 min e quando a aba volta a ficar visível). Se houver versão nova, mostra o aviso vermelho e recarrega sozinha quando a tela está parada: 1 min sem uso, sem janela aberta, sem campo em edição e sem gravação pendente.

Testes:
- `test/stock-weighing-double-count.test.js`;
- testes de tela:
  - corrigir espaços não dobra o estoque;
  - renomear com dois espaços, com o nome de um espaço já apagado, mostra os 44,5 kg antes e depois do F5;
  - dois computadores abertos;
  - aviso e recarga da aba antiga (4/4);
  - mesma versão: sem aviso nem recarga.

## Agenda: WhatsApp do cadastro, fornecedor excluído na lista, Fornecedor como padrão (25/11/2026, v280)

Queixas da cliente sobre a agenda (`public/modules/phase1/phase1-agenda.js`, que substitui a janela de `app-agenda.js`):
1. "Cada vez que encaminho o lembrete, pede o número. O Silvio tem o número no cadastro e não puxa."
2. "Ao agendar, aparecem BM SUCATA e BM SUCATAS (e THIAGO HANSEN e THIAGO LEANDRO HANSEN OLIVEIRA), mas em Fornecedores só tem um."
3. "Todo agendamento é de fornecedor, mas o tipo vem sempre em Cliente."

Leitura da produção (só leitura, autorizada) em 25/11:
- o WhatsApp do Silvio (F010) está no campo `wpp` do cadastro; `tel` está vazio;
- BM SUCATAS (F510) e THIAGO HANSEN (F042) são fornecedores excluídos: o registro continua em `erp/fornecedores` e o código está em `erp/fornDeleted`;
- os 51 agendamentos são de fornecedor, e já existia um agendamento em BM SUCATAS.

Causas:
- `phoneFor` só olhava `tel`, `telefone` e `celular`;
- a agenda completava a lista com uma leitura direta de `erp/fornecedores` (para mostrar cadastro novo de outro computador sem F5) e não tirava os excluídos;
- `enhanceModal` fixava `type.value='Cliente'`.

Correção:
- o telefone vem de `wpp`, `whatsapp`, `tel`, `telefone` ou `celular`, primeiro no tipo do agendamento (fornecedor ou cliente) e só entre os fornecedores ativos;
- quando o cadastro não tem número, a agenda pede uma vez e guarda em `whats` no agendamento. Ele vai para a nuvem com o resto da agenda e vale para os próximos lembretes da mesma pessoa, em qualquer computador. Número sem DDD (o "47" que já vem escrito) é recusado, em vez de abrir `wa.me/47`;
- a leitura direta tira os fornecedores de `FORN_DELETED`, a mesma regra da tela de Fornecedores (`getFornAtivos`);
- a janela abre em Fornecedor; Cliente continua disponível;
- o mesmo campo `wpp` passou a valer no número já preenchido ao enviar a notinha pelo WhatsApp (`wpp-phone`), no WhatsApp da Ficha do fornecedor, no compartilhamento da Ficha do cliente (`phase1-commercial.js`) e na agenda antiga (`_agdTelefonePor`).

Testes:
- `test/erp-critical-integrations.test.js`;
- teste de tela (12/12) com os dados da produção. Com o código antigo dá 2/12: abre em Cliente, não acha o WhatsApp do Silvio, aceita "47" e pede o número toda vez.

## Cliente novo nascendo escondido; adiantamento reescrito pela tela (24/11/2026, v279)

Achado na revisão. Excluir um cliente ou juntá-lo em outro grava `erp/clientes/<código>: null` e `erp/clientesDeleted/<código>: true`. O próximo código (`nextCustomerCode`) olhava só os clientes que sobraram. Quando o cliente excluído era o de código mais alto, por exemplo juntar o cadastro duplicado mais novo no antigo:
- o cliente seguinte recebia o mesmo código e já nascia na lista de excluídos. O servidor e as telas não o mostravam;
- todo cadastro depois disso falhava com "Outro cadastro foi feito ao mesmo tempo. Tente de novo.", porque o código calculado já existia.

Correção: `createOne` (`server/modules/customers/application/customer-registry.ts`) reserva também os códigos de `clientesDeleted`, como o cadastro de fornecedores já fazia com `fornDeleted`.

Um cliente que já tenha nascido escondido continua escondido: o registro existe em `erp/clientes` com o mesmo código de `erp/clientesDeleted`. Para achar, é preciso ler esses dois nós na produção.

Teste: `test/customer-registry.test.js` exclui o C003 e junta o C002 no C001. Os próximos cadastros recebem C004, C005 e C006, sem erro. Sem a correção, o teste falha.

**Saldo inicial no juntar e no renomear.** Juntar ou renomear grava o saldo inicial no nome do cliente principal. Gravava sem tirar esse nome da lista antiga `fcSaldoIniDeleted`, que as telas aplicam ao carregar, e o saldo somado podia sumir da ficha. Agora as duas ações tiram o nome da lista, como "Saldo inicial" já fazia (`openingBalanceTombstoneCleared`, usado também em `client-credits.ts`). Teste em `test/customer-registry.test.js`, com a lista nos dois formatos.

**Adiantamento que a tela reescrevia.** Duas correções antigas da tela mudavam adiantamentos só no navegador, a cada vez que a lista ou a Ficha abria:
- `_adtCorrigirDataCompensacaoParcial` trocava a data de "Compensação parcial – CP dd/mm/aaaa" pela data escrita na observação;
- `adtCorrigeEmpresa` apagava a empresa marcada `_empresaAuto` e a empresa principal de adiantamento de banco "terceiro".

Desde que o servidor grava os adiantamentos, essas mudanças nunca chegavam à nuvem. A tela mostrava uma coisa e o servidor tinha outra. Corrigir a data dessa compensação parecia não salvar, e editar ou excluir esses adiantamentos falhava com "O adiantamento foi alterado por outra sessão. Atualize antes de salvar.", porque a tela mandava a cópia alterada como "o que eu vi". As duas foram removidas, e a tela mostra o que está gravado. A empresa se troca pela coluna Empresa; o servidor tira o `_empresaAuto` nessa hora.

Testes:
- `test/server-owned-sync-deletions.test.js`;
- teste de tela (5/5) com a função real do servidor. Antes da correção dava 0/5: data errada na tela, edição e exclusão recusadas.

## Lista de apagados do estoque vazia na nuvem (24/11/2026, v278)

Defeito da v277, achado na revisão. Quando o último nome sai de `erp/estoqueDeleted` (alguém recria ou restaura o único material apagado), a transação grava uma lista vazia e o Firebase apaga o nó. A leitura (`_lerErpSemPesados`) descarta nós vazios, então os carregadores não chamavam `_estoqueTombstonesDaNuvem`. O computador que estava aberto ficava com a marca antiga:
- o material recriado continuava escondido nele sem F5;
- ao salvar qualquer coisa, ele gravava `metais` sem o material (o nome só voltava pelo cadastro do estoque).

Correção:
- `_lerErpSemPesados` guarda em `d._lidos` todo nó lido com sucesso, inclusive os vazios;
- os dois carregadores usam `_fbNoLido(d,'estoqueDeleted')`. Nó lido e vazio limpa a marca local; nó sem permissão de leitura não mexe nela;
- excluir material lê a lista da nuvem com `_nomesTombstoneEstoque` (aceita lista ou objeto, compara sem diferença de maiúsculas);
- se a transação da lista de apagados falhar ao recriar ou renomear, aparece um aviso para conferir a internet e salvar de novo.

Testes:
- `test/stock-weighing-double-count.test.js` (nó vazio conta como lido e limpa a marca);
- `test/matriz-estoque-aniversarios-regression.test.js`;
- teste de tela (8/8): o computador B aberto com MEDALHA apagada passa a mostrar a MEDALHA recriada em outro computador sem F5, esquece a marca, salva sem apagar nada da nuvem e continua igual depois do F5;
- os testes de tela de estoque da v277.

## Material que some e volta (MEDALHA / GRANA GROSSA); WhatsApp Web (24/11/2026, v277)

**Material sumindo.** A cliente: "já criei o item umas 3 vezes e ele fica sumindo; era MEDALHA, editei para GRANA GROSSA, sumiram os dois, depois a MEDALHA apareceu e agora sumiu de novo". Leitura (só leitura, autorizada) da produção:
- `erp/metais` tem MEDALHA;
- `erp/estoque` tem MEDALHA, sem `nomesAnteriores`;
- `erp/estoqueDeleted` tem **GRANA GROSSA**;
- o histórico mostra que em 23/11 às 12:26 a Elaine excluiu "GRANA GROSSA" ("Material sem movimento removido do catálogo"), durante uma limpeza do cadastro. A GRANA GROSSA estava zerada porque, antes da v271, renomear não levava os quilos.

Causa: a lista de nomes apagados do estoque (`estoqueDeleted`) era **somada** entre os computadores e gravada inteira pelo `fbSalvar` de cada um. Criar de novo ou renomear para um nome apagado tirava o nome só da lista local (`_estoqueLimparExclusao`). Os outros computadores mandavam a lista deles de volta e o nome voltava a ser apagado. Renomear marcava o nome antigo como apagado só localmente. O resultado era o pingue-pongue: some um, some o outro, volta.

Correção:
- ao carregar, a lista local passa a ser **a da nuvem** (`_estoqueTombstonesDaNuvem`), sem somar a local. Uma marca que só existia num computador deixa de esconder material;
- `fbSalvar` não grava mais `estoqueDeleted` inteiro;
- as mudanças vão direto para a nuvem por transação (`_estoqueTombstoneNuvem`): excluir material (já era assim), renomear (o nome antigo entra e o novo sai) e criar ou reaproveitar um nome apagado (sai da lista).

**Depois de publicar, todos os computadores precisam de F5.** Uma aba com versão antiga ainda grava a lista inteira e pode apagar de novo a GRANA GROSSA. No computador dela, a MEDALHA volta a aparecer (a marca era só local). Para ficar com o nome GRANA GROSSA: Editar na MEDALHA, nome GRANA GROSSA, Salvar. Os quilos vão junto (v271) e a GRANA GROSSA sai da lista de apagados na nuvem.

**WhatsApp Web.** A Agenda (e todo o sistema) abria o WhatsApp por `wa.me`, que chama o aplicativo instalado. No computador da cliente, o aplicativo é um WhatsApp separado, só para comprovantes. Ela pediu a opção da outra agenda: aplicativo ou Web. Novo:
- `whatsapp-format.js` guarda a escolha por computador (`localStorage` `erp_whatsapp_modo`);
- no modo Web, troca todo `wa.me` / `api.whatsapp.com/send` aberto pelo sistema por `https://web.whatsapp.com/send?phone=…&text=…`, sempre na mesma aba (`erp_whatsapp_web`);
- a escolha fica na Agenda de Entregas: "Abrir WhatsApp no: Aplicativo do computador / WhatsApp Web".

Testes:
- `test/whatsapp-web-mode.test.js`;
- `test/stock-weighing-double-count.test.js` (lista de apagados segue a nuvem);
- teste de tela do caso dela (7/7): MEDALHA marcada só no computador dela aparece; renomear para GRANA GROSSA (apagada pela Elaine) funciona e corrige a nuvem; navegador limpo e F5 mostram o mesmo; salvar não regrava a lista;
- os testes de tela de estoque anteriores.

## Fornecedor devolveu o adiantamento (24/11/2026, v276)

Caso Jeferson Serafim Borba. O adiantamento de R$ 15.000,00 foi usado em R$ 9.044,70 no T206, e a Ficha mostrava "Fornecedor deve R$ 5.955,30". Ele devolveu esse dinheiro, e a cliente perguntou como lançar. Não havia como:
- adiantamento usado em parte não pode ser editado nem excluído ("já compensado");
- não existia ação de devolução.

Os R$ 5.955,30 ficavam presos como dívida do fornecedor.

Novo:
- **Servidor** (`changeAdvance` com `action: 'refund'` / `'refund-undo'`, mesmo endpoint `advance-change`, mesma trava do fornecedor e registro da operação):
  - devolução total: o adiantamento vira "Quitado", com `valorDevolvido`, `dataDevolucao`, `bancoDevolucao`/`bancoDevolucaoNome` e `movDevolucaoId`;
  - devolução parcial: a parte devolvida vira um registro próprio (`origem: 'devolucao'`, `adiantamentoOrigem`) e o resto continua livre;
  - com banco escolhido, cria a **entrada** no extrato (`LB-DEV-…`, `source: 'advance-refund'`); "Dinheiro" não cria lançamento de banco;
  - desfazer volta tudo e apaga a entrada (com `lancBancoDeletedV2`);
  - recusa devolver adiantamento já usado e valor maior que o que sobrou;
  - recusa desfazer o resto se ele já foi usado depois;
  - editar ou excluir adiantamento com devolução registrada é recusado (`ADVANCE_REFUNDED`), para a entrada do banco não ficar solta.
- **Ficha do fornecedor:** botão **↩ Devolvido** na linha do adiantamento livre. Ele abre uma janela com o valor (já preenchido com o que sobrou), a data e onde o dinheiro entrou (bancos ou "Dinheiro"). A Ficha ganha a linha "Devolução do adiantamento X" (+ valor, situação "Recebido", botão Desfazer) e o saldo fecha. A parte devolvida aparece como "Parte do adiantamento X…, devolvida pelo fornecedor", e o valor total do adiantamento mostra "R$ … devolvido". O "Total pago" desconta a devolução.
- **Fluxo de caixa:** a devolução desconta da linha de adiantamentos no mês em que foi recebida.

Testes:
- `test/advance-refund.test.js` (total com banco, desfazer, parcial em dinheiro, recusas, editar e excluir travados);
- teste de tela com o caso Jeferson (7/7): devolução, saldo quitado, extrato do banco, F5 e desfazer.

## As duas fichas do cliente davam saldos diferentes (24/11/2026, v275)

A cliente notou que há duas fichas do cliente e "uma não puxa a outra":
- a aba **Ficha do Cliente** (botões com os clientes; extrato em `_fcMovimentos`);
- a **Ficha** que abre pela aba Clientes (janela, `fcRenderFicha`, com editar e excluir por linha).

A aba ignorava os lançamentos manuais da ficha (`fcLanc`: entrega, depósito, cheque devolvido, reembolso) e o saldo anterior (`fcSaldoIni`). Também contava cheque devolvido como pago. Com isso, o mesmo cliente tinha saldos diferentes nas duas telas.

Correção (`_fcMovimentos`):
- a aba soma os lançamentos manuais, menos os "ainda não pago", com a etiqueta "Lançamento";
- soma o saldo anterior, com a etiqueta "Saldo inicial" (positivo é crédito do cliente, negativo é dívida, como na janela);
- não conta o cheque devolvido, que aparece como "(devolvido, não conta)".

Os cheques do "Cheques a compensar" com o nome do cliente continuam só na aba, como antes. O teste de tela tem venda, adiantamento, cheque bom e devolvido, entrega e depósito manuais, um "ainda não pago" e saldo anterior. As duas telas mostram "cliente deve R$ 850,00" (4/4).

**Saldo anterior lançado duas vezes (caso Anderson):** ela lançou o saldo anterior como "Adiantamento (crédito)" e ele foi gravado duas vezes, provavelmente por clique duplo, que a v272 já impede. Não é defeito de cálculo. Para apagar o repetido: aba Ficha do Cliente → sub-aba "💳 Adiant/Cheques (detalhe)" → 🗑️ num dos dois adiantamentos de R$ 43.966,44 do Anderson. Também dá pela Ficha da aba Clientes, no 🗑️ da linha. A exclusão só é recusada se o adiantamento já foi usado numa venda.

## Estoque mais rápido; Painel contava material repetido duas vezes (24/11/2026, v274)

**Desempenho.** A tela do Estoque e o Painel calculavam cada material varrendo todas as notinhas e vendas: 110 materiais vezes todas as notinhas. Medido com 3.000 notinhas, 500 vendas e 110 materiais:
- v269: cerca de 1 s;
- v271: 1,6 s (a tradução pelo nome atual em cada item pesou).

A tela é redesenhada a cada atualização da nuvem. Agora `_estoqueTotaisPorChave` soma entradas (notinhas e pesagens no estoque), saídas (vendas e entregas da Ficha do Cliente) e nomes antigos numa passada só: **21 ms**, com o mesmo resultado (teste compara com o cálculo material por material). Edição, exclusão de material e estoque da venda continuam usando o cálculo de um material só.

**Painel → estoque total contava em dobro.** O Painel percorria o cadastro do estoque (`ESTOQUE_DB`), que ainda guarda a variante "latinha" (v266) e pode guardar um nome antigo de material renomeado (v271). Cada chave somava os mesmos quilos. Exemplo do teste: LATINHA 1.000 kg + MEDALHA/GRANA GROSSA 50 kg mostrava 2.100 kg em vez de 1.050 kg. Agora as chaves são agrupadas pelo nome atual, somando os ajustes manuais, como na tela do Estoque.

**Revisado e sem defeito:**
- tratamento de erro das chamadas ao servidor nas telas antigas (avisam a cliente; só a migração de documentos registra no console);
- excluir pela Ficha do fornecedor a "Parte do adiantamento" encontra os pagamentos e oferece desfazer.

Testes:
- `test/stock-weighing-double-count.test.js` (uma passada só igual a material por material, com nome antigo e variante);
- teste de tela do Painel (3/3);
- os 8 testes de tela de estoque anteriores.

## Revisão: pesagem de venda na lista de compra; varredura de telas (24/11/2026, v273)

**Varredura de telas:** no navegador simulado, com compra, venda, adiantamento, cheque e lançamento de banco de exemplo, abri as 44 abas e as 13 janelas de lançamento. Fiz isso como administradora e como secretária, com menos permissões. Não apareceu nenhum erro de JavaScript.

**Pesagem de venda podia virar notinha de compra.** A pesagem de venda (`tipo: 'venda'`) fica "Aguard. Preço" e finalizada, como a de compra. As listas de pesagens para lançar compra filtravam só por situação:
- Compra de Sucata → Pesagens (`csRenderPesagens`);
- lista por fornecedor;
- fila do pedido de compra;
- `RoadWeighingDomain.isReadyForPurchase`.

No fluxo normal da rodoviária a marca `_rodEntrada` tirava a pesagem de venda dessas listas. Mas "Remover da fila" do Balanceiro limpa essa marca, e aí a pesagem de venda aparecia para virar compra. Correção:
- as listas acima ignoram `tipo: 'venda'`;
- abrir uma pesagem de venda como compra avisa que ela fecha em Vendas → Pesagens a fechar;
- o servidor (`createPurchaseOrder`) recusa pesagem de venda como origem (`SOURCE_IS_SALE`).

Testes: `test/stock-weighing-double-count.test.js` (servidor recusa pesagem de venda). Varredura de telas como administradora e como secretária, sem erros.

## Revisão: botão de excluir pesagem que nunca funcionava; clique duplo (24/11/2026, v272)

Segunda varredura, agora por outros tipos de defeito.

Corrigidos:
- **Balanceiro → Histórico → excluir pesagem:** o botão pedia a senha da administradora e sempre terminava em "Confirmação administrativa segura indisponível" (a confirmação por senha no navegador tinha sido desligada por segurança). Era um beco sem saída. Agora `balExcluirTicket`:
  - exclui de verdade a pesagem solta (aguardando preço ou de saída), com confirmação;
  - se a pesagem já virou notinha, explica que é preciso excluir a notinha primeiro (a pesagem volta para "Aguardando preço");
  - se a pesagem está numa venda, manda excluir a venda primeiro;
  - se o ticket é uma notinha, manda usar o Histórico de compras.
- **Clique duplo:** as funções que gravam pelo servidor no sistema antigo (fornecedores, clientes, contas a receber, créditos de cliente, cheques de fornecedor, contas a pagar, saldo de fornecedor, bancos, vendas) geravam uma operação nova a cada clique. Dois cliques rápidos podiam gravar duas vezes. O adiantamento de cliente, por exemplo, não travava o botão. Agora passam por `_pedidoUnico`: enquanto um pedido está em andamento, outro igual (mesmo conteúdo, qualquer `operationId`) recebe a mesma resposta. Pedidos diferentes, ou o mesmo pedido depois que o primeiro terminou ou falhou, seguem normalmente.

Visto e sem defeito:
- data de "hoje" (`_hojeISO` usa o horário local, sem pular para o dia seguinte depois das 21h);
- ordenação por data das despesas, viagens, combustível, tanque, EPI e manutenção (a data fica em aaaa-mm-dd);
- campos de dinheiro do sistema antigo (são numéricos ou usam leitor próprio de vírgula);
- adiantamento de fornecedor (já travava o botão).

Testes: `test/request-coalescing.test.js`. Testes de tela: exclusão no Balanceiro (5/5) e clique duplo (4/4).

## Renomear material: o nome antigo voltava com os quilos (24/11/2026, v271)

A cliente renomeou MEDALHA para GRANA GROSSA (Estoque → Editar → Nome do material). Depois do F5, "sumiu a grana grossa e voltou a medalha": GRANA GROSSA ficou com 0 kg e MEDALHA voltou com os quilos.

Causa: renomear mudava só o cadastro (`METAIS`/`ESTOQUE_DB`). As notinhas, vendas e entregas continuavam com o item "MEDALHA". O estoque soma pelo nome do item, então os quilos continuavam em MEDALHA. A recuperação de materiais com movimento (`_recuperarMateriaisComMovimento`) e `_garantirMetalCadastrado` (venda salva) recriavam MEDALHA. Reproduzido no teste de tela.

Correção (app-core):
- **Renomear guarda o nome antigo** em `ESTOQUE_DB[novo].nomesAnteriores`, junto com os nomes anteriores do material antigo, para valer em renomes em cadeia. Esse campo vai para a nuvem com o estoque.
- O cálculo do estoque (`getEntradasMaterial`, `getSaidasMaterial`, inclusive entregas da Ficha do Cliente, e `_vendaEstoqueDisponivel`) usa `_chaveEstoqueComAlias`: item "MEDALHA" conta em GRANA GROSSA.
- A lista de materiais (`_dedupeMetais`, `_mergeMetaisRemoto`, tabela do estoque) tira o nome antigo quando o novo existe (`_semNomesAntigos`). A recuperação e `_garantirMetalCadastrado` não recriam o nome antigo.
- As tabelas de preço de fornecedor e de cliente levam o preço do nome antigo para o novo (`_renomearMaterialNosPrecos`).
- **Renomear para um material que já existe junta os dois**: estoque inicial e saídas manuais são somados.
- "Novo material" com um nome que virou outro avisa: "O material MEDALHA foi renomeado para GRANA GROSSA…".
- Mudar só maiúsculas e minúsculas no nome não marca mais o material como excluído. Antes, a marca de exclusão (que ignora maiúsculas e minúsculas) apagava o próprio material.

**Para a cliente consertar depois de atualizar:** no Estoque, Editar na MEDALHA, trocar o nome para GRANA GROSSA e salvar. Se GRANA GROSSA já existe, os dois viram um só, com os quilos somados.

Testes:
- `test/stock-weighing-double-count.test.js` (renomear: entradas, saídas, entregas, lista e preços);
- teste de tela do renomear (7/7);
- teste de tela de juntar com material existente (4/4), com F5.

## Revisão geral: contas a pagar que sumiam, data da notinha, saldos de centavos (23/11/2026, v270)

Varredura pelos tipos de defeito que mais apareceram com a cliente. Achados e corrigidos:

- **Vale-transporte (Avisos → Vale-transporte)** criava as contas a pagar só no navegador (`CONTAS_PAGAR.push` + `saveContasPagar`). Desde a v242 só o servidor grava contas a pagar, então elas não iam para a nuvem e sumiam no F5. Agora usa `erpPayablesRequest({action:'create', …, installments})`, com origem nova `vale_transporte`. O valor do vale continua salvo no funcionário. Se a criação falha, a tela avisa.
- **Contas fixas → "Gerar mês"** (phase1-finance) tinha o mesmo defeito. Agora cria pelo servidor com origem `conta_fixa` e vínculos `fixedId`/`fixedMonth`, para o aviso "já gerada neste mês" continuar funcionando. O servidor passou a aceitar essas duas origens e os dois vínculos (`PAYABLE_ORIGINS`, `LINK_FIELDS`).
- **Data da notinha:** o extrato, o canhoto e a Ficha mostram o campo `data`. Mudar a "Data da compra" na edição só mudava `dataCompra`, e essas telas continuavam com a data antiga. Agora a edição atualiza também `data`. O "Corrigir data" antigo do Detalhe da compra mudava `data` só no navegador (voltava no F5). Para notinhas confirmadas pelo servidor, ele agora manda usar Editar.
- **Ficha do fornecedor:** o saldo corrido somava números com casas flutuantes e podia mostrar "você deve R$ 0,00" em vez de "quitado". Agora é arredondado para centavos, também no quadro "Saldo atual".
- **Estoque:** material com saldo negativo e preço 0 mostrava "R$ -0,00" no valor total.

Visto e sem defeito:
- criação de compra nova (a conta provisória local é trocada pelas do servidor);
- Ficha do cliente (já usa tolerância);
- nome de cliente nas vendas (já compara normalizado);
- formulário antigo de compra (o `om('compra')` é desviado pelo módulo novo).

Visto e deixado como está:
- `desmarcarCompraPaga` só vale para notinhas antigas com marca manual de pago (`_pagoUndo`), que nenhum código cria mais;
- mensagens de casos raros que dizem "solicite conciliação".

Testes:
- `test/payable-registry.test.js` (vale-transporte e conta fixa no servidor);
- `test/server-owned-payables-client.test.js` (as duas telas não criam conta só no navegador);
- `test/purchase-order-history-and-cheques.test.js` (data);
- teste de tela do vale-transporte: 3 contas criadas e mantidas depois do F5.

## Estoque zerado aparecia "OK" ou "-0.0 kg NEGATIVO" (23/11/2026, v269)

Depois de zerar os cobres, a tela mostrou:
- COBRE MEL com "0.0 kg" e situação OK;
- COBRE MISTO com "-0.0 kg", "R$ -0,00" e NEGATIVO.

As entradas têm mais casas do que a tela mostra (27.285,36 aparece como 27285.4). A cliente digitou nas saídas o número da tela, e sobraram ou faltaram 0,04 kg. A coluna mostra uma casa, mas a situação e o valor usavam o número exato.

Correção (`renderEstoque` e `editEstoque`): saldo com menos de 0,05 kg para mais ou para menos conta como zero. É o que a tela já mostrava como "0.0". Situação, valor total e o "Saldo atual" da edição usam esse número. Um saldo de verdade de 0,1 kg continua OK. O campo "Quanto tem no pátio agora?" (v268) usa as entradas exatas e não deixa essa sobra.

Teste de tela (5/5): COBRE MEL e COBRE MISTO com 0,04 kg de diferença aparecem ZERADO; um material com 0,1 kg continua OK; a edição mostra 0.0 kg.

## Estoque: "Quanto tem no pátio agora?" para acertar ou zerar (23/11/2026, v268)

A cliente perguntou como zerar o estoque de cobre: "estou colocando em saída mas não zera". Na edição do estoque, o campo "Saídas manuais adicionais" **substitui** o total lançado à mão, não soma. O saldo do quadro também não mudava enquanto ela digitava. E quando o saldo está negativo (vendeu mais do que entrou com aquele nome), colocar saída deixa ainda mais negativo. Não era defeito de cálculo, mas o campo enganava.

Melhoria (`editEstoque` no app-core):
- campo novo no topo, **"Quanto tem no pátio agora? (kg)"**. Ela digita o peso contado (0 para zerar) e a tela calcula sozinha (`_eeUsarSaldoReal`):
  - se precisa tirar, acerta "Saídas manuais";
  - se precisa pôr (saldo negativo), zera as saídas manuais e sobe o "Estoque inicial";
- o quadro mostra "Saldo atual" e "Depois de salvar" e se atualiza enquanto ela digita (`_eeAtualizarSaldo`);
- o rótulo virou "Saídas manuais (kg) — é o total lançado à mão, não soma com o que já estava";
- a conta considera os ajustes das variantes antigas do mesmo nome (ex.: latinha), como a tabela da v266.

A tabela de preços do fornecedor usa a mesma lista de materiais que a v266 limpa. A "latinha" repetida some dela quando a v266 estiver publicada e a página for recarregada.

Teste de tela (8/8):
- zerar COBRE com saldo positivo;
- zerar FERRO com saldo negativo (sobe o inicial);
- continua zerado depois do F5;
- tabela de preços com uma LATINHA só.

## Usar o adiantamento sem perder o que foi digitado; quadro Pagamento em linguagem simples (23/11/2026, v267)

A cliente perdeu quatro vezes o que tinha digitado na notinha da T750: tirou a varredura e escreveu observações, clicou "Usar adiantamento nesta compra", e a notinha reabriu sem as mudanças. A confirmação avisava, mas ela não lia, e o caminho certo (salvar, abrir de novo, compensar) era longo.

Melhorias (purchase-order.js):
- **Salvar antes de mexer no financeiro.** Ao abrir a edição, a tela guarda uma assinatura do formulário (`editFormSignature`: itens, desconto, frete, observações, ordem, datas, fornecedor). "Usar adiantamento nesta compra", "Usar da mais antiga para a mais nova" e "Tirar desta compra" comparam com ela (`editFormDirty`). Se houver mudança não salva, perguntam uma vez ("Você mudou esta notinha e ainda não salvou… Salvar agora e continuar?"), salvam pelo caminho normal (`phase4PurchaseSave({skipAdvanceOffer:true})`, que agora devolve `true` quando grava) e depois seguem com a confirmação de sempre, já com os valores novos. Sem mudança, nada muda. Saiu o aviso "Alterações… serão descartadas".
- **Quadro Pagamento na edição.**
  - A caixa "Adiantamentos / abatimentos" mostrava R$ 0,00 quando o adiantamento tinha sido usado depois do fechamento. Na edição ela vira **"Já descontado ou pago"**, com total menos saldo.
  - O texto técnico ("Histórico financeiro do pedido já registrado… Outras baixas ou ajustes… Saldo original… exigem conciliação") virou: "Esta notinha já está lançada. Já descontado ou pago: R$ X (no fechamento / depois do fechamento). Falta pagar: R$ Y. Se você mudar os itens, só a diferença do total vai para Contas a Pagar: nada é pago ou descontado de novo sozinho."

Teste de tela (5/5):
- notinha com varredura tirada e observação não salvas: "Usar adiantamento" salva e compensa o total novo, sem perder nada;
- quadro com "Já descontado ou pago";
- notinha sem mudança: só a confirmação de sempre.

## Saldo devedor anterior com o valor de antes; material repetido "latinha" (23/11/2026, v266)

**Notinha (T750).** A cliente descontou R$ 69.519,42 de uma sobra de adiantamento de R$ 131.977,80. Era o adiantamento de R$ 150.093,96, já usado em R$ 18.116,16 na T353. A impressão mostrava a linha "Saldo devedor anterior" com "—" no valor total e só os R$ 69.519,42 abatidos. Os R$ 131.977,80 não apareciam em lugar nenhum. Esse "—" foi decisão minha na v263, e escondia a informação. Agora:
- o resumo mostra "Saldo devedor anterior R$ 131.977,80" e "Saldo devedor anterior descontado nesta compra R$ 69.519,42". Quando a sobra é usada inteira, continua a linha única "Saldo devedor anterior descontado";
- a tabela mostra os R$ 131.977,80 na coluna de valor total.

O valor de antes vem do recibo de fechamento (aplicado + pendente). Para uso depois do fechamento, é o valor original do adiantamento menos o usado em outras compras até a data (`printAdvanceUsedElsewhereAmount`).

**Estoque: "LATINHA" e "latinha".** Uma venda com o item digitado "latinha" fez o sistema criar um segundo material. A recuperação de materiais com movimento (`_recuperarMateriaisComMovimento`) e `_garantirMetalCadastrado` comparavam o nome diferenciando maiúsculas de minúsculas. O cálculo do estoque não diferencia, então as duas linhas contavam a mesma entrada (38.173,7 kg) e o total ficava inflado. Excluir "latinha" era recusado e, se fosse liberado, apagaria também "LATINHA", porque a marca de exclusão não diferencia maiúsculas de minúsculas. Correção:
- os dois pontos acima não criam mais variante de maiúsculas e minúsculas;
- `_metaisSemVariantes` limpa a lista ao carregar, ao mesclar com a nuvem e em `_dedupeMetais`, mantendo a versão em maiúsculas;
- a tabela do estoque mostra uma linha por material e soma os ajustes manuais (inicial e saídas) das variantes antigas.

A mensagem de exclusão falava em "solicite sua inativação", opção que não existe. Agora diz que o material tem entradas ou saídas e não pode ser excluído.

**Não é defeito (é o jeito de usar):** "Usar adiantamento nesta compra" reabre o pedido e descarta o que não foi salvo. A confirmação avisa. O caminho é salvar primeiro e depois usar o adiantamento. Para corrigir uma notinha já compensada:
- se a correção não deixa o total abaixo do que foi compensado, basta editar e salvar;
- se deixa, clicar **Desfazer** no quadro amarelo (o que foi digitado fica), salvar, e o sistema pergunta se quer usar o adiantamento de novo.

Testes:
- `test/purchase-order-print.test.js` (caso T750);
- `test/stock-weighing-double-count.test.js` (variantes);
- teste de tela do estoque com LATINHA/latinha (4/4) e os de estoque anteriores.

## Notinha lista os adiantamentos usados depois do fechamento (23/11/2026, v265)

Caso André Felipe de Lima (T787, R$ 45.993,05). Ela lançou a notinha sem adiantamento e depois usou "Usar adiantamento nesta compra" com R$ 15.000,04 e R$ 10.000,00. A impressão mostrava só "Pagamentos registrados após o pedido: 23/11 Compensação de adiantamento R$ 25.000,04". Na do Ismael, em que os adiantamentos foram usados no fechamento, a tabela "Adiantamentos e abatimentos desta compra" mostrava cada um. A cliente esperava a mesma coisa.

Correção (purchase-order.js):
- O pagamento de Contas a Pagar guarda `adtUsos` (cada adiantamento e o valor usado). `printLaterAdvanceRows` lê esses dados das contas da notinha. Cada adiantamento entra na mesma tabela, com data, forma e valor total do adiantamento, e com "Adiantamento (usado em dd/mm/aaaa)" na origem. O rodapé vira "Total de adiantamentos abatidos (depois do fechamento)" ou "(no fechamento e depois)".
- A regra da v263 vale também aqui. Vira "Saldo devedor anterior" o adiantamento que já tinha sido usado em outra compra até a data da compensação (`printAdvanceUsedElsewhere`: recibo de fechamento de outra notinha ou `adtUsos` de outra conta). Também vira o que é anterior à última notinha que usou adiantamento. O resto é adiantamento novo, com o valor total.
- A compensação detalhada não se repete em "Pagamentos registrados após o pedido". Nessa lista fica só a parte paga em dinheiro. Pagamentos antigos sem `adtUsos` continuam como antes.

Testes: `test/purchase-order-print.test.js`, com o caso André e o caso T715 compensado depois, com sobra da T259, adiantamento novo e pagamento em dinheiro.

## Editar a notinha depois de uma compensação: "alterado em outra sessão" (23/11/2026, v264)

Caso T787. A cliente abriu a edição, clicou "Usar adiantamento nesta compra" (R$ 25.000,04), digitou nas observações "descontado adiantamento de 15.000,04 / 10.000,00" e clicou em Salvar. Apareceu "O pedido foi alterado em outra sessão. Reabra o histórico antes de editar." A tela ainda mostrava "Saldo a pagar R$ 45.993,05", mesmo com a compensação listada.

Causa: depois da compensação, a edição reabre e lê a notinha da nuvem. Essa leitura pode vir da cópia local do Firebase, que ainda não recebeu a gravação do servidor. Quem dá a resposta da API é o servidor, e a atualização da nuvem chega ao navegador um pouco depois. A edição ficou com a versão de antes da compensação. Ao salvar, a conferência ("a notinha na nuvem é a mesma que abri?") falhou e a gravação foi recusada. A recusa era correta, porque gravar a cópia velha desfaria a compensação, mas a mensagem não dizia o que fazer.

Correção (purchase-order.js):
- **Abrir a edição** (`phase4PurchaseEditTicket`): se a leitura da nuvem não bate com a notinha local em total, saldo ou situação, tenta de novo até 4 vezes (350 ms entre uma e outra) antes de montar a tela.
- **Salvar sem mudar valores** (observações, itens com o mesmo total, datas, ordem de compra), quando a notinha mudou na nuvem: `purchaseMergeEdit` grava por cima da versão atual só os campos que a edição mudou. Os campos de dinheiro (`PURCHASE_MONEY_FIELDS`: total, saldo, situação, adiantamento, parcelas, recibo, fornecedor…) ficam como estão na nuvem. Se a edição mexeu num campo de dinheiro, ou num campo que a outra tela também mudou, a gravação é recusada como antes. O aviso diz "Ele tinha um pagamento ou compensação registrado depois que você abriu: o saldo atual foi mantido."
- **Recusa por mudança** (`PURCHASE_CHANGED`, `TICKET_CHANGED`, `PAYABLE_CHANGED`, `ADVANCE_CHANGED`, `CREDIT_CHANGED`): a edição reabre sozinha com os valores atuais e mantém o que a pessoa digitou (itens, desconto, frete, observações, ordem e data). A mensagem explica que basta conferir e salvar de novo.

Testes: `test/purchase-edit-merge.test.js`. Teste de tela, 6/6:
- o caso da cliente;
- outra tela compensa com a edição aberta e a observação é gravada;
- mudança de preço com compensação no meio: reabre mantendo o preço e grava na segunda tentativa.

## Notinha mostra a sobra das compras anteriores como "saldo devedor anterior" (23/11/2026, v263)

Caso Ismael. Na primeira notinha (R$ 17.380,06), a cliente abateu o saldo devedor de R$ 15.377,15 e os adiantamentos de R$ 7.775,07 e R$ 5.000,00. Ela escreveu nas observações "ficando saldo devedor de 10.772,16". Na notinha seguinte (R$ 15.754,90), a impressão mostrava os dois adiantamentos separados: R$ 7.775,07 com R$ 5.772,16 aplicados, R$ 5.000,00 aplicados, mais as linhas "Valor total dos adiantamentos usados R$ 12.775,07" e "Já usado em compras anteriores R$ 2.002,91". Ela esperava só "saldo devedor R$ 10.772,16". Para ela, o que sobra depois de uma notinha vira saldo devedor do fornecedor, e na notinha seguinte é isso que se desconta.

Regra da impressão (`printHtml` / `printCarriedCutoff` em purchase-order.js). Um adiantamento aplicado no fechamento é **sobra de compra anterior** quando:
- já tinha sido usado em parte antes (`valorOriginal − valorAplicado − valorPendente > 0`); ou
- a forma é crédito/saldo; ou
- a data dele é até o último dia em que uma notinha anterior do mesmo fornecedor usou adiantamento, no fechamento ou depois, pelo Contas a Pagar. Só contam usos até a data desta notinha. "Notinha anterior" quer dizer data menor, ou mesma data com número menor.

A sobra aparece numa linha só, **"Saldo devedor anterior descontado"**, no resumo e na tabela ("Saldo devedor anterior · Sobra das compras anteriores"). Os adiantamentos novos (dados depois da notinha anterior) continuam com o valor total, como pedido na v253, agora com o nome "adiantamento novo" quando os dois aparecem juntos. Saiu a linha "Já usado em compras anteriores", que só existia para fechar a conta dos adiantamentos repartidos.

Testes: `test/purchase-order-print.test.js` cobre o caso Ismael, o caso T715 (saldo anterior mais adiantamento novo) e a sobra de adiantamento usado em parte antes.

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
