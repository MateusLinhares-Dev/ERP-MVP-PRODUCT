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
