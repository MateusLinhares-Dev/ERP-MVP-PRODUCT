function normalizedTabs(profile = {}) {
  return new Set(
    Array.isArray(profile.tabs)
      ? profile.tabs
          .map((tab) => String(tab || '').trim())
          .filter(Boolean)
      : [],
  );
}

function hasAny(tabs, values) {
  return values.some((value) => tabs.has(value));
}

export function buildSecurityClaims(
  profile = {},
  { admin = false } = {},
) {
  const tabs = normalizedTabs(profile);
  const isAdmin = Boolean(admin);

  return {
    canChat:
      isAdmin ||
      tabs.has('chat'),

    canEmployeeDocs:
      isAdmin ||
      tabs.has('funcionarios'),

    canBusinessDocs:
      isAdmin ||
      hasAny(tabs, [
        'clientes',
        'fornecedores',
        'documentos_empresas',
      ]),

    canFleetDocs:
      isAdmin ||
      hasAny(tabs, [
        'frota',
        'caminhoes',
      ]),

    canPartyBanks:
      isAdmin ||
      hasAny(tabs, [
        'clientes',
        'fornecedores',
        'bancos',
        'contas_pagar',
        'contas_receber',
        'adiantamentos',
      ]),

    canCalendar:
      isAdmin ||
      hasAny(tabs, [
        'afazeres',
        'calendario',
      ]),

    canOwnerBills:
      isAdmin,

    canFiscalRead:
      isAdmin ||
      hasAny(tabs, [
        'fiscal',
        'contas_receber',
        'vendas',
      ]),

    canFiscalWrite:
      isAdmin ||
      tabs.has('fiscal'),

    canReceivables:
      isAdmin ||
      tabs.has('contas_receber'),

    canPasswords:
      Boolean(
        isAdmin &&
        tabs.has('senhas')
      ),

    canSupport:
      Boolean(
        isAdmin &&
        tabs.has('suporte_tecnico')
      ),

    // Claims para migração de regras por coleção. Nenhuma regra de produção é
    // alterada automaticamente: o sincronizador legado ainda grava em lote.
    canPurchasing: isAdmin || hasAny(tabs, ['compra_sucata','canhoto_compra','rod_balanca','balanceiro']),
    canSales: isAdmin || tabs.has('vendas'),
    canInventory: isAdmin || hasAny(tabs, ['estoque','compra_sucata','vendas']),
    canCustomers: isAdmin || hasAny(tabs, ['clientes','fin_clientes','precos_clientes']),
    canSuppliers: isAdmin || hasAny(tabs, ['fornecedores','precos_fornecedores','compra_sucata']),
    canFinance: isAdmin || hasAny(tabs, ['contas_pagar','contas_receber','fluxo_caixa','adiantamentos','cheques','cheques_compensar','contas_banco']),
    canBanking: isAdmin || hasAny(tabs, ['contas_banco','bancos']),
    canPayroll: isAdmin || tabs.has('folha_pagamento'),
    canHR: isAdmin || hasAny(tabs, ['funcionarios','ponto','folha_pagamento','vales']),
    canFleet: isAdmin || hasAny(tabs, ['caminhoes','frota','viagem_motorista','combustivel_rudnick']),
    canContracts: isAdmin || tabs.has('contratos'),
    canCoordination: isAdmin || hasAny(tabs, ['almoxarifado','coordenacao']),
  };
}

export function canAccessProfileTab(
  profile = {},
  tab,
) {
  return normalizedTabs(profile).has(
    String(tab || '').trim(),
  );
}
