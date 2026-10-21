const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'public/modules/phase3/phase3-homologation.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/modules/phase3/phase3-homologation.css'),'utf8');
const boot=fs.readFileSync(path.join(root,'public/app/bootstrap.js'),'utf8');
const phase2=fs.readFileSync(path.join(root,'public/modules/phase2/phase2-feedback.js'),'utf8');
const has=(...xs)=>xs.forEach(x=>assert.ok(js.includes(x),`Faltou: ${x}`));

test('bootstrap carrega phase3 após phase2',()=>{assert.ok(boot.includes("/modules/phase3/phase3-homologation.js"));assert.ok(boot.indexOf('/modules/phase3/phase3-homologation.js')>boot.indexOf('/modules/phase2/phase2-feedback.js'));});
test('ticket da Compra é resolvido localmente ou recuperado da nuvem',()=>has('resolveTicketKey','ensureTicketKey','erp/tickets','orderByChild(\'ticket\')','global.abrirDetalheCompra','global.csAbrirImpureza'));
test('clientes e fornecedores recebem multibanco compartilhado',()=>has("'partyBanks'",'phase3OpenPartyBanks','phase3BankSave','ERPPartyBanks','saveFornecedores','saveClientes'));
test('preços usam combobox pesquisável direto na lista e removem a barra duplicada da fase2',()=>{has('ensurePriceCombo','phase3-price-combo','renderPriceComboList',"tab.querySelectorAll('.phase2-price-searches').forEach(x=>x.remove())");assert.ok(css.includes('.phase3-price-combo-list'));});
test('calendário unifica legado, filtra por datas ou meses e lembra 5 3 1',()=>has("'calendarEvents'",'migrateLegacyAfazeres','calendarRangeMode','monthFrom','monthTo','userKey','[5,3,1]','checkCalendarPopups'));
test('calendário injeta compromissos na aba Avisos',()=>has('injectCalendarAvisos','Meus compromissos','avisosAtualizarBadge'));
test('cheques explicam Abate compra e recalculam KPIs ao excluir',()=>has('Abate compra?','adiantamento ao fornecedor','legacyChequeDelete','live=Object.entries(CHQ_CTRL'));
test('contas pessoais da dona possuem vencimento, filtro mensal e pagamento',()=>has('ownerDueDate','Vence hoje','phase3OwnerPay','phase3OwnerReopen','type="month"'));
test('adiantamento preserva correção manual e soma lançamentos vinculados',()=>has('Compra relacionada (opcional)','supplierTicketOptions','externalAdvanceSum','advanceSumForTicket','reconcileKnownLinkedAdvances','updateTicketAdvance'));
test('EPI corrige ReferenceError data e faz uma única baixa',()=>{has('deliveryDate','data:deliveryDate','Estoque insuficiente','O estoque foi baixado uma única vez');assert.ok(phase2.includes('data:deliveryDate'));});
test('funcionários ativos usam regra consistente em módulos operacionais',()=>{has('activeEmployee','getEmployees','vg-motorista','reu-partic-list','adv-mat');assert.ok(phase2.includes("['inativo','demitido','desligado','rescindido']"));assert.ok(!phase2.includes("&&!f.dataRescisao"));});
test('próxima revisão da frota vira data e filtro é reaplicado',()=>has("el.type='date'",'phase2FrotaFilter','phase2-maint-card'));
test('edição da viagem possui gastos extras e remove inativos',()=>has('p3-vg-edit-extra','gastosExtras','vg-edit-motorista'));
test('contas a receber ganham vínculo fiscal sem misturar cadastros',()=>has('fiscalLinks','Cliente Fiscal','Fluxo consolidado','phase3ReceivableFiscal'));
test('Casa Glória é consolidada em Casa e removida da navegação',()=>has("norm(x.area)==='casa gloria'","x.area='Casa'",'removeCasaGloria'));
test('Coordenação repovoa reuniões e advertências com todos funcionários ativos',()=>has('fixCoordination','reu-partic-list','adv-mat','getEmployees'));
test('layout possui responsividade para calendário, bancos e contas pessoais',()=>{assert.ok(css.includes('@media(max-width:1000px)'));assert.ok(css.includes('.p3-cal-layout'));assert.ok(css.includes('.phase3-bank-row'));assert.ok(css.includes('.p3-owner-calendar'));});

test('detalhe da compra limpa campos verdes e observação salva durante digitação',()=>{
  has('resetPurchaseDetailInputs','dc-add-valor','dc-add-valor-obs');
  assert.ok(phase2.includes('oninput="phase2PurchaseObsSave'));
});
test('limpeza de cheques não remove mais o container da tabela',()=>{
  assert.ok(phase2.includes("const hasTable=!!el.querySelector?.('table')"));
  assert.ok(phase2.includes('isLegacyHelp=!hasTable'));
});
test('datas do cheque são controles de calendário e persistem em formato legado',()=>{
  assert.ok(phase2.includes("input.type='date'"));
  assert.ok(phase2.includes('chequeDateToBR'));
  assert.ok(phase2.includes('chequeDateToIso'));
});
test('Contas da Dona usa o id real tab-contas_dona',()=>{
  assert.ok(js.includes("#tab-contas_dona"));
  assert.ok(!js.includes("#tab-contas-dona"));
});
test('edição de viagem injeta gasto extra fora do grid legado e não zera se campo faltar',()=>{
  has('p3-vg-edit-extra-row','extraEl?parseBR(extraEl.value):null');
  assert.ok(css.includes('.p3-trip-edit-extra'));
});
test('participantes da Coordenação possuem cards espaçados',()=>{
  has('p3-coord-participants','p3-coord-person');
  assert.ok(css.includes('.p3-coord-participants'));
});


test('observação da Compra fica sticky e não some na rolagem', () => {
  assert.match(phase2,/className='phase2-purchase-history-obs'/);
  assert.match(css,/position:sticky!important;right:88px/);
});

test('adiantamento usa snapshot financeiro como base e soma somente lançamentos externos', () => {
  assert.match(js,/ticketSnapshotAdvanceCodes/);
  assert.match(js,/reciboFinanceiro\?\.total/);
  assert.match(js,/externalAdvanceSum/);
  assert.match(js,/reconcileKnownLinkedAdvances/);
  assert.match(js,/_phase3AdvanceBase/);
});


test('detalhe da compra mantém a chave atual para correções subsequentes',()=>{
  has("let currentPurchaseTicketKey=''",'currentPurchaseTicketKey=k','resolveTicketKey(currentPurchaseTicketKey)');
});

test('calendário mantém toda interface antiga oculta após rerender legado',()=>{
  has('hideLegacyCalendarUi','legacyRenderAfazeresPhase3','phase3-calendar-legacy');
  assert.match(css,/\.phase3-calendar-legacy[^\{]*\{display:none!important\}/);
});

test('reconciliação de adiantamento preserva saldo anterior da compra',()=>{
  assert.ok(js.includes("saldoAnterior=Number(t.saldoAnterior||0)"));
  assert.ok(js.includes('total-adt+saldoAnterior'));
});

test('fase2 não recria barra duplicada de preços depois do combobox novo',()=>{
  assert.ok(phase2.includes("if(tab.querySelector('.phase3-price-combo'))return;"));
});

test('Editar Impureza usa o ticket corrente quando o modal legado zera _dcDbKey',()=>{
  has('const target=normalizeTicketRef(ref)||currentPurchaseTicketKey','return legacyImp.call(this,k)');
});

test('marcadores do calendário mensal não dependem do filtro de período',()=>{
  has("String(e.date||'').slice(0,7)===calendarMonth","calendarFrom=d;calendarTo=d");
});

test('preços exibem a lista cadastrada permanentemente e filtram na própria lista',()=>{
  has("typeof getFornAtivos==='function'?getFornAtivos():(FORNECEDORES||[])","(CLIENTES||[]).filter(Boolean)",'phase3-price-count');
  assert.match(css,/\.phase3-price-combo-list\{display:block!important;position:static!important/);
  assert.match(css,/\.phase3-price-combo-list button\.selected/);
});

test('botões de Contas da Dona usam cursor de ação',()=>{
  assert.match(css,/\.p3-owner-head button[^\{]*,[^\n]*\.p3-owner-calendar button[^\{]*\{cursor:pointer!important\}/);
});

test('correção manual de adiantamento é override exato e não é desfeita pela reconciliação automática',()=>{
  has('purchaseAdvanceOverride','_phase3AdvanceOverride={total:novo,ignoredCodes','override?.ignoredCodes','if(override)return override.total','correcaoAdiantamento');
});

test('calendário de Contas a Pagar limpa filtros conflitantes antes de filtrar o dia',()=>{
  has('resetPayableCalendarFilters','_cpFiltroTipo=\'todos\'','_cpMesFiltro=\'\'','_cpFiltroEmpresa=\'\'','_cpFiltroDia=iso||\'\'','Filtrado pelo calendário');
});

test('intervalo de Contas a Pagar deixa de ficar preso ao mês e Vencimentos de hoje nunca abre vazio',()=>{
  has('bindPayableRange','fixPayableToday','Nenhuma conta vencendo hoje.','_cpMesFiltro=\'\';_cpFiltroDia=\'\'');
  assert.ok(css.includes('.p3-payable-today-empty'));
});
