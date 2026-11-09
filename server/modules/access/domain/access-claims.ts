import type { SecurityClaims } from '../../../shared/auth/identity.js';

interface ProfileWithTabs {
  tabs?: unknown;
}

function normalizedTabs(profile: ProfileWithTabs | null | undefined = {}): Set<string> {
  const tabs = profile?.tabs;
  return new Set(
    Array.isArray(tabs) ? tabs.map((tab: unknown) => String(tab || '').trim()).filter(Boolean) : [],
  );
}

function hasAny(tabs: ReadonlySet<string>, values: readonly string[]): boolean {
  return values.some((value) => tabs.has(value));
}

export function buildSecurityClaims(
  profile: ProfileWithTabs | null | undefined = {},
  { admin = false }: { admin?: boolean } = {},
): SecurityClaims {
  const tabs = normalizedTabs(profile);
  const isAdmin = Boolean(admin);
  const either = (...values: string[]): boolean => isAdmin || hasAny(tabs, values);
  return {
    canChat: either('chat'),
    canEmployeeDocs: either('funcionarios'),
    canBusinessDocs: either('clientes', 'fornecedores', 'documentos_empresas'),
    canFleetDocs: either('frota', 'caminhoes'),
    canPartyBanks: either('clientes', 'fornecedores', 'bancos', 'contas_pagar', 'contas_receber'),
    canCalendar: either('afazeres', 'calendario'),
    canOwnerBills: isAdmin,
    canFiscalRead: either('fiscal', 'contas_receber', 'vendas'),
    canFiscalWrite: either('fiscal'),
    canReceivables: either('contas_receber'),
    canPasswords: isAdmin && tabs.has('senhas'),
    canSupport: isAdmin && tabs.has('suporte_tecnico'),
    canPurchasing: either('compra_sucata', 'canhoto_compra', 'rod_balanca', 'balanceiro'),
    canSales: either('vendas'),
    canQuickEntry: either('lancamento_rapido'),
    canInventory: either('estoque', 'compra_sucata', 'vendas'),
    canCustomers: either('clientes', 'fin_clientes', 'precos_clientes'),
    canSuppliers: either('fornecedores', 'precos_fornecedores', 'compra_sucata'),
    canAdvances: either('adiantamentos'),
    canPayables: either('contas_pagar'),
    canExpenses: either('despesas_grupo'),
    canFinance: either(
      'contas_pagar',
      'contas_receber',
      'fluxo_caixa',
      'cheques',
      'cheques_compensar',
      'contas_banco',
    ),
    canBanking: either('contas_banco', 'bancos'),
    canPayroll: either('folha_pagamento'),
    canHR: either('funcionarios', 'ponto', 'folha_pagamento', 'vales'),
    canFleet: either('caminhoes', 'frota', 'viagem_motorista', 'combustivel_rudnick'),
    canContracts: either('contratos'),
    canShoppingList: either('lista_compras'),
    canTasks: either('afazeres'),
    canDeliveryAgenda: either('agenda_entregas'),
    canCoordination: either('almoxarifado', 'coordenacao'),
  };
}

export function canAccessProfileTab(profile: ProfileWithTabs | null | undefined, tab: unknown): boolean {
  return normalizedTabs(profile).has(String(tab || '').trim());
}
