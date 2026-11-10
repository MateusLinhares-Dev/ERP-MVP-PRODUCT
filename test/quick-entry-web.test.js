import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const draftModule = () => import('../web/modules/quick-entry/domain/entry-draft.ts');
const decimalModule = () => import('../web/shared/domain/decimal.ts');
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const options = {
  suppliers: [
    { cod: 'F1', nome: 'JOÃO SILVA SUCATAS' },
    { cod: 'F2', nome: 'JOANA METAIS' },
  ],
  customers: [{ cod: 'C1', nome: 'GERDAU AÇOS LONGOS' }],
  materials: ['COBRE MEL', 'FERRO'],
  supplierPrices: { F1: { 'COBRE MEL': 40 } },
  customerPrices: { 'GERDAU AÇOS LONGOS': { FERRO: 1.2 } },
  today: '2026-11-10',
  user: { login: 'elaine', admin: true },
  aiEnabled: false,
};

function ids() {
  let next = 0;
  return () => `id-${++next}`;
}

test('números digitados no celular: vírgula, milhar e R$', async () => {
  const { parseDecimal, toFieldText } = await decimalModule();
  assert.equal(parseDecimal('1.234,56'), 1234.56);
  assert.equal(parseDecimal('1.500'), 1500);
  assert.equal(parseDecimal('R$ 42,5'), 42.5);
  assert.equal(parseDecimal('2.5'), 2.5);
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('abc'), null);
  assert.equal(toFieldText(1.2), '1,2');
  assert.equal(toFieldText(null), '');
});

test('rascunho novo: datas de hoje, um material vazio e operação própria', async () => {
  const { createDraft, hasContent, draftTotal } = await draftModule();
  const draft = createDraft('compra', '2026-11-10', ids());
  assert.equal(draft.date, '2026-11-10');
  assert.equal(draft.dueDate, '2026-11-10');
  assert.equal(draft.items.length, 1);
  assert.equal(draft.operationId, 'id-1');
  assert.equal(hasContent(draft), false);
  assert.equal(draftTotal(draft), 0);
});

test('validação mostra o que falta e marca os campos', async () => {
  const { createDraft, validateDraft, itemField } = await draftModule();
  const draft = { ...createDraft('venda', '2026-11-10', ids()), dueDate: '2026-11-01' };
  const { problems, invalid } = validateDraft(draft);
  assert.deepEqual(problems, [
    'Escolha o cliente.',
    'Escolha o material 1.',
    'Informe o peso do material 1.',
    'Informe o preço por kg do material 1.',
    'O vencimento não pode ser antes da data.',
  ]);
  const item = draft.items[0].id;
  assert.deepEqual(invalid, ['party', itemField(item, 'material'), itemField(item, 'kg'), itemField(item, 'price')]);
  const uploading = {
    ...draft,
    attachments: [{ localId: 'a', nome: 'foto.jpg', status: 'Enviando…', preview: '', failed: false, ref: null }],
  };
  assert.match(validateDraft(uploading).problems.join(' '), /Aguarde terminar de enviar as fotos/);
});

test('o que foi falado preenche fornecedor, materiais e datas, marcados em amarelo', async () => {
  const { createDraft, applyInterpretation, itemField, draftTotal } = await draftModule();
  const next = ids();
  const draft = createDraft('compra', '2026-11-10', next);
  const result = {
    fonte: 'aparelho',
    tipo: 'compra',
    tipoFalado: 'compra',
    parte: { nome: 'JOAO SILVA SUCATAS', cod: 'F1' },
    itens: [{ material: 'COBRE MEL', materialFalado: 'cobre mel', quantidadeKg: 350, precoKg: 42 }],
    data: null,
    vencimento: '2026-11-25',
    nf: '123',
    observacao: null,
    duvidas: ['Você falou em compra, mas está na tela de venda. Confira.', 'Considerei 350 como quilos. Confira.'],
  };
  const filled = applyInterpretation(draft, result, options, next);
  assert.deepEqual(filled.party, { nome: 'JOÃO SILVA SUCATAS', cod: 'F1' }, 'usa o nome do cadastro');
  assert.equal(filled.items.length, 1);
  assert.equal(filled.items[0].kgText, '350');
  assert.equal(filled.items[0].priceText, '42');
  assert.equal(draftTotal(filled), 14700);
  assert.equal(filled.dueDate, '2026-11-25');
  assert.equal(filled.invoice, '', 'nota fiscal só vale para venda');
  assert.deepEqual(filled.doubts, ['Considerei 350 como quilos. Confira.'], 'aviso de tela trocada não aparece');
  const id = filled.items[0].id;
  for (const field of ['party', 'dueDate', itemField(id, 'material'), itemField(id, 'kg'), itemField(id, 'price')]) {
    assert.ok(filled.speechFilled.includes(field), field);
  }
});

test('fala sem nada reconhecível dá dicas e não apaga o que a pessoa digitou', async () => {
  const { createDraft, applyInterpretation, editItem } = await draftModule();
  const next = ids();
  let draft = createDraft('compra', '2026-11-10', next);
  draft = editItem(draft, draft.items[0].id, 'kg', '100');
  const empty = {
    fonte: 'aparelho',
    tipo: 'compra',
    parte: null,
    itens: [],
    data: null,
    vencimento: null,
    nf: null,
    observacao: null,
    duvidas: [],
  };
  const result = applyInterpretation(draft, empty, options, next);
  assert.equal(result.items[0].kgText, '100', 'material digitado à mão fica');
  assert.match(result.doubts[0], /Não entendi o fornecedor/);
  assert.match(result.doubts.join(' '), /Dica: fale o material/);
  assert.match(result.doubts.join(' '), /COBRE MEL do JOÃO SILVA SUCATAS/);
});

test('troca de tela: fala de compra estando em venda (aparelho e IA)', async () => {
  const { spokenKindOf, isUnderstood } = await draftModule();
  assert.equal(spokenKindOf({ fonte: 'aparelho', tipo: 'venda', tipoFalado: 'compra' }), 'compra');
  assert.equal(spokenKindOf({ fonte: 'aparelho', tipo: 'venda', tipoFalado: '' }), null);
  assert.equal(spokenKindOf({ fonte: 'ia', tipo: 'venda' }), 'venda');
  assert.equal(spokenKindOf({ fonte: 'ia', tipo: 'indefinido' }), null);
  assert.equal(isUnderstood({ parte: null, itens: [{ material: null, materialFalado: '', quantidadeKg: 0 }] }), false);
  assert.equal(isUnderstood({ parte: { nome: 'X', cod: '' }, itens: [] }), true);
});

test('preço da tabela: fornecedor pelo código, cliente pelo nome', async () => {
  const { tablePrice, applyTablePrice, createDraft, chooseParty } = await draftModule();
  assert.equal(tablePrice(options, 'compra', { cod: 'F1', nome: 'X' }, 'cobre mel'), 40);
  assert.equal(tablePrice(options, 'compra', { cod: 'F2', nome: 'X' }, 'COBRE MEL'), null);
  assert.equal(tablePrice(options, 'venda', { cod: 'C1', nome: 'Gerdau Aços Longos' }, 'FERRO'), 1.2);
  const next = ids();
  const draft = chooseParty(createDraft('compra', '2026-11-10', next), options.suppliers[0]);
  const priced = applyTablePrice(draft, draft.items[0].id, 40);
  assert.equal(priced.items[0].priceText, '40');
});

test('busca de fornecedor por pedaços do nome, sem acento', async () => {
  const { searchParties } = await draftModule();
  assert.deepEqual(
    searchParties(options.suppliers, 'jo').map((p) => p.cod),
    ['F1', 'F2'],
  );
  assert.deepEqual(
    searchParties(options.suppliers, 'joão suc').map((p) => p.cod),
    ['F1'],
  );
  assert.equal(searchParties(options.suppliers, '').length, 2, 'campo vazio mostra a lista');
});

test('tirar o único material deixa uma linha vazia; editar limpa a marcação', async () => {
  const { createDraft, removeItem, editItem, itemField, addItem } = await draftModule();
  const next = ids();
  let draft = createDraft('compra', '2026-11-10', next);
  const first = draft.items[0].id;
  draft = { ...draft, speechFilled: [itemField(first, 'kg')], invalid: [itemField(first, 'kg')] };
  const edited = editItem(draft, first, 'kg', '12');
  assert.deepEqual(edited.speechFilled, []);
  assert.deepEqual(edited.invalid, []);
  const removed = removeItem(draft, first, next);
  assert.equal(removed.items.length, 1);
  assert.notEqual(removed.items[0].id, first);
  assert.deepEqual(removed.speechFilled, []);
  assert.equal(addItem(draft, next).items.length, 2);
});

test('envio: compra manda o código do fornecedor; venda manda cliente e nota', async () => {
  const { createDraft, chooseParty, editItem, buildSaveBody } = await draftModule();
  const next = ids();
  let purchase = chooseParty(createDraft('compra', '2026-11-10', next), options.suppliers[0]);
  const item = purchase.items[0].id;
  purchase = editItem(editItem(editItem(purchase, item, 'material', 'COBRE MEL'), item, 'kg', '1.500'), item, 'price', '42,5');
  purchase = {
    ...purchase,
    dueDate: '',
    note: '  pago na hora ',
    spokenText: ' comprei ',
    attachments: [
      { localId: 'a', nome: 'f.jpg', status: 'Enviado', preview: '', failed: false, ref: { id: 'ANX1', nome: 'f.jpg', tipo: 'image/jpeg', tamanho: 1, dono: 'erp_elaine' } },
      { localId: 'b', nome: 'g.jpg', status: 'Falhou', preview: '', failed: true, ref: null },
    ],
  };
  assert.deepEqual(buildSaveBody(purchase), {
    operationId: 'id-1',
    data: '2026-11-10',
    vencimento: '2026-11-10',
    observacao: 'pago na hora',
    textoFalado: 'comprei',
    itens: [{ material: 'COBRE MEL', quantidadeKg: 1500, precoKg: 42.5 }],
    anexos: ['ANX1'],
    fornecedorCod: 'F1',
  });
  const sale = { ...chooseParty(createDraft('venda', '2026-11-10', next), options.customers[0]), invoice: ' 4521 ' };
  const body = buildSaveBody(sale);
  assert.equal(body.cliente, 'GERDAU AÇOS LONGOS');
  assert.equal(body.nf, '4521');
  assert.equal('fornecedorCod' in body, false);
});

test('salvar tenta de novo só em falha passageira, esperando de 2 a 6 segundos', async () => {
  const { isTransientSaveError, retryDelaySeconds, statusTone } = await draftModule();
  assert.equal(isTransientSaveError('NETWORK_ERROR', 0), true);
  assert.equal(isTransientSaveError('PURCHASE_IN_PROGRESS', 409), true);
  assert.equal(isTransientSaveError('HTTP_502', 502), true);
  assert.equal(isTransientSaveError('ITEMS_REQUIRED', 422), false);
  assert.equal(retryDelaySeconds(null, 1), 2);
  assert.equal(retryDelaySeconds(30, 1), 6);
  assert.equal(retryDelaySeconds(3, 2), 3);
  assert.equal(statusTone('Pago'), 'ok');
  assert.equal(statusTone('Excluído no ERP'), 'deleted');
  assert.equal(statusTone('Em aberto'), 'open');
});

test('tela nova: código em web/, página antiga removida e build aponta para o pacote React', () => {
  const html = read('web/pages/rapido/index.html');
  assert.match(html, /<script type="module" src="\.\.\/\.\.\/modules\/quick-entry\/main\.tsx"><\/script>/);
  assert.match(html, /<link rel="manifest" href="\/rapido\/manifest\.webmanifest"/);
  for (const old of ['index.html', 'rapido.js', 'parser.js', 'rapido.css']) {
    assert.equal(existsSync(new URL(`../public/rapido/${old}`, import.meta.url)), false, `public/rapido/${old}`);
  }
  for (const kept of ['manifest.webmanifest', 'icone-192.png', 'icone-512.png', 'icone.svg']) {
    assert.ok(existsSync(new URL(`../public/rapido/${kept}`, import.meta.url)), `public/rapido/${kept}`);
  }
  assert.match(read('scripts/build.mjs'), /buildWeb\(\{configFile:path\.join\(root,'vite\.config\.ts'\)/);
  const vercel = JSON.parse(read('vercel.json'));
  const immutable = vercel.headers.find((rule) => rule.source === '/web/(.*)');
  assert.match(immutable.headers[0].value, /immutable/);
});
