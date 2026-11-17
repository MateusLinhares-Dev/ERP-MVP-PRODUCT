import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const phase3 = read('public/modules/phase3/phase3-homologation.js');
const core = read('public/legacy/app-core.js');

const slice = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'trecho não encontrado: ' + start);
  return source.slice(from, to);
};

const installments = (ticket, values) =>
  values.map((valor, index) => ({
    id: `CPPO_${ticket}-${index + 1}`,
    ticket,
    valor,
    status: 'Pendente',
    parcela: index + 1,
    parcelas: values.length,
  }));

function reconcileContext(tickets, payables) {
  const calls = { saved: 0 };
  const context = {
    TICKETS_DB: tickets,
    CONTAS_PAGAR: payables,
    ADT_POR_FORN: {},
    ticketRefIndex: new Map(),
    saveContasPagar: () => calls.saved++,
    saveDB: () => {},
    fbSalvarImediato: () => {},
    renderTickets: () => {},
    renderContasPagar: () => {},
    console,
  };
  const code =
    slice(phase3, 'function ticketDb(){', 'function captureTicketMappings(){') +
    slice(phase3, 'function resolveTicketKey(ref){', '\n}\n') +
    '\n}\n' +
    slice(phase3, 'function linkedAdvanceRecords(ticket){', 'function scheduleAdvanceReconcile(') +
    ';this.reconcileKnownLinkedAdvances=reconcileKnownLinkedAdvances;this.updateTicketAdvance=updateTicketAdvance;';
  runInNewContext(code, context);
  return { context, calls };
}

test('reconciliação automática não troca o valor da 1ª parcela pelo saldo inteiro da compra', () => {
  const ticket = {
    ticket: 'T827843',
    totalGeral: 1212,
    adiantamento: 0,
    saldoPagar: 1212,
    status: 'Pendente',
    _purchaseOperationId: 'op-1',
    reciboFinanceiro: { versao: 2, total: 0, adiantamentos: [], cheques: [] },
  };
  const payables = installments('T827843', [606, 303, 151.5, 75.75, 37.87, 18.94, 18.94]);
  const { context, calls } = reconcileContext({ T827843: ticket }, payables);
  context.reconcileKnownLinkedAdvances();
  assert.deepEqual(
    payables.map((row) => row.valor),
    [606, 303, 151.5, 75.75, 37.87, 18.94, 18.94],
  );
  assert.equal(context.updateTicketAdvance('T827843', 100), false);
  assert.equal(payables[0].valor, 606);
  assert.equal(ticket.saldoPagar, 1212);
  assert.equal(calls.saved, 0);
});

test('compra paga pelo Contas a Pagar não volta a "Pendente" na tela', () => {
  const ticket = {
    ticket: 'T900',
    totalGeral: 500,
    adiantamento: 0,
    saldoPagar: 0,
    status: 'Pago',
    _purchaseOperationId: 'op-2',
    reciboFinanceiro: { versao: 2, total: 0, adiantamentos: [], cheques: [] },
  };
  const payables = [{ id: 'CPPO_T900', ticket: 'T900', valor: 500, status: 'Pago', dataPgto: '08/11/2026' }];
  const { context } = reconcileContext({ T900: ticket }, payables);
  context.reconcileKnownLinkedAdvances();
  assert.equal(ticket.status, 'Pago');
  assert.equal(ticket.saldoPagar, 0);
  assert.deepEqual(payables[0], { id: 'CPPO_T900', ticket: 'T900', valor: 500, status: 'Pago', dataPgto: '08/11/2026' });
});

test('compras antigas, lançadas sem o servidor, continuam sendo reconciliadas', () => {
  const ticket = { ticket: 'T100', totalGeral: 1000, adiantamento: 0, saldoPagar: 1000, status: 'Pendente', _phase3AdvanceBase: 300 };
  const payables = [{ id: 'CP1', ticket: 'T100', valor: 1000, status: 'Pendente' }];
  const { context } = reconcileContext({ T100: ticket }, payables);
  context.reconcileKnownLinkedAdvances();
  assert.equal(ticket.saldoPagar, 700);
  assert.equal(payables[0].valor, 700);
});

test('navegador não apaga nem mescla contas a pagar (só o servidor grava; parcelas iguais nunca somem)', () => {
  for (const name of ['_cpAutoLimparDuplicatas', '_cpLimparDuplicatasExatas', '_mesclarContasPagarComNuvem', '_removerCPporIndice'])
    assert.doesNotMatch(core, new RegExp('function ' + name + '\\('), name);
  const sync = read('public/legacy/firebase-sync.js');
  assert.doesNotMatch(sync, /_patchIncremental\(dados, 'contasPagar'|contasPagarDeleted\/'\+id|_mesclarContasPagarComNuvem/);
  const rules = JSON.parse(read('database.rules.json')).rules.erp;
  assert.equal(rules.contasPagar['.write'], false);
  assert.equal(rules.contasPagarDeleted['.write'], false);
});

test('detalhe antigo da compra não altera compra confirmada pelo servidor', () => {
  for (const name of ['salvarAdiantamentoCompra', 'adicionarItemTicket', 'lancarValorCompra', 'removerAcrescimoCompra']) {
    const body = slice(core, `function ${name}(`, '\n}\n');
    assert.match(body, /if\(_compraConfirmadaNoServidor\(t\)\)\{ _avisarCompraDoServidor\(\); return; \}/, name);
  }
  assert.match(phase3, /if\(serverConfirmedPurchase\(t\)\)\{notify\('Esta compra foi confirmada pelo servidor/);
});

test('marca de excluída nunca esconde conta de pedido de compra (CPPO), nem vinda do Firebase nem do navegador', () => {
  const context = { CONTAS_PAGAR_DELETED: new Set(), localStorage: { setItem() {} } };
  runInNewContext(
    slice(core, 'function _cpTombstoneDoCliente(id){', 'function _cpDeletedCarregarDeRemoto(remotoBruto){') +
      slice(core, 'function _cpDeletedCarregarDeRemoto(remotoBruto){', 'function _criarSincroniaPorChave(') +
      ';this.load=_cpDeletedCarregarDeRemoto;',
    context,
  );
  context.load({ 'CPPO_T827843-7': true, CPX1: true });
  context.load(['CPPO_T1', 'CP2']);
  assert.deepEqual([...context.CONTAS_PAGAR_DELETED].sort(), ['CP2', 'CPX1']);
  assert.doesNotMatch(core, /ref\('erp\/contasPagarDeleted'\)\.update/, 'o navegador não regrava marcas de exclusão');
  assert.match(core, /JSON\.parse\(_cpd\)\.forEach\(id=>\{ if\(_cpTombstoneDoCliente\(id\)\) CONTAS_PAGAR_DELETED\.add\(id\); \}\)/);
  const sync = read('public/legacy/firebase-sync.js');
  assert.doesNotMatch(sync, /dados\['contasPagarDeleted\/'\+id\]/, 'o navegador não grava marca de exclusão: quem exclui é o servidor');
});

test('lixeira de Contas a Pagar não apaga parcela de pedido de compra', () => {
  const workspace = readFileSync(new URL('../web/modules/payables/ui/PayablesWorkspace.tsx', import.meta.url), 'utf8');
  const remove = workspace.slice(workspace.indexOf('const askDelete = useCallback('), workspace.indexOf('const askEdit = useCallback('));
  assert.match(remove, /if \(row\.fromPurchase\) return port\.notify\(PURCHASE_MESSAGE, 'info'\);/);
  const bulk = workspace.slice(workspace.indexOf('const deleteSelected = () => {'), workspace.indexOf('const pickDay ='));
  assert.match(bulk, /row\.fromPurchase/);
  const actions = readFileSync(new URL('../web/modules/payables/ui/actions.ts', import.meta.url), 'utf8');
  assert.match(actions, /Histórico de compras/);
});
