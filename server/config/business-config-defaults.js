export const DEFAULT_BUSINESS_CONFIG = {
  "primaryCompanyKey": "Manuela Metais",
  "branding": {
    "logoPrefix": "Manuela",
    "logoAccent": "Metais",
    "tagline": "Reciclagem de Metais Não Ferrosos",
    "title": "ERP – Manuela Metais"
  },
  "companies": {
    "Manuela Metais": {
      "nome": "MANUELA METAIS",
      "razaoSocial": "Manuela Metais LTDA",
      "cnpj": "28.071.250/0001-31",
      "ie": "258373946",
      "endereco": "Av. Santos Dumont, 4805 – Galpão 5, Zona Industrial Norte, Joinville/SC – CEP 89219-730",
      "enderecoCurto": "Av. Santos Dumont, 4805 – Galpão 5 · Joinville/SC",
      "financeiro": "(47) 99971-7071",
      "escritorio": "(47) 98420-8184",
      "compras": "(47) 98442-7379",
      "email": "manuelametais@gmail.com",
      "responsavel": "Elaine"
    },
    "Gratus Metais": {
      "nome": "GRATUS METAIS",
      "razaoSocial": "Gratus Metais",
      "cnpj": "44.467.308/0001-17",
      "ie": "261445545",
      "endereco": "Av. Odilon Rocha Ferreira, 848, Jardim Iririú, Joinville/SC – CEP 89224-424"
    },
    "Mabor": {
      "nome": "MABOR",
      "razaoSocial": "Mabor",
      "cnpj": "53.357.758/0001-48",
      "ie": "",
      "endereco": "Rua Bernardo Welter, 520, Sala 1, Costa e Silva, Joinville/SC"
    }
  },
  "financeCompanies": [
    "Manuela Metais",
    "Gratus Metais",
    "Mabor"
  ],
  "employeeCompanies": [
    "Manuela Metais",
    "Mabor",
    "Gratus",
    "MEI"
  ],
  "transferCompanies": [
    "Manuela Metais",
    "Gratus Metais",
    "Mabor"
  ],
  "chequeCompanies": [
    "Mabor",
    "Gratus",
    "Manuela",
    "Elaine",
    "Rafael"
  ],
  "expenseGroupCompanyMap": {
    "Manuela Metais": "MANUELA",
    "Gratus Metais": "GRATUS",
    "Mabor": "MABOR"
  },
  "fiscalCompanies": {
    "manuela": {
      "label": "Manuela Metais",
      "shortLabel": "Manuela Metais",
      "icon": "🏭",
      "dataPrefix": ""
    },
    "gratus": {
      "label": "Gratus Metais",
      "shortLabel": "Gratus",
      "icon": "🏪",
      "dataPrefix": "g-"
    }
  },
  "bankDisplayTokens": {
    "manuela": "Manuela Metais",
    "mabor": "Mabor",
    "gratus": "Gratus"
  },
  "dashboardModules": {
    "compra_sucata": {
      "description": "Entrada de material dos fornecedores com ticket e pesagem",
      "responsible": "Thais"
    },
    "estoque": {
      "description": "Saldo atual por tipo de metal",
      "responsible": "Derick"
    },
    "vendas": {
      "description": "Registro de vendas para clientes",
      "responsible": "Derick"
    },
    "contas_pagar": {
      "description": "Despesas e contas a vencer",
      "responsible": "Elaine"
    },
    "contas_receber": {
      "description": "Valores a receber de clientes",
      "responsible": "Elaine"
    },
    "fluxo_caixa": {
      "description": "Resumo financeiro mensal anual",
      "responsible": "Elaine"
    },
    "funcionarios": {
      "description": "Cadastro de colaboradores",
      "responsible": "Elaine"
    },
    "ponto": {
      "description": "Controle de presença e horas",
      "responsible": "Thais"
    },
    "folha_pagamento": {
      "description": "Cálculo mensal com INSS e IRRF",
      "responsible": "Elaine"
    },
    "contas_banco": {
      "description": "Contas bancárias e movimentações financeiras",
      "responsible": "Elaine"
    },
    "precos_fornecedores": {
      "description": "Tabela de preços de compra por fornecedor/kg",
      "responsible": "Rafael"
    },
    "precos_clientes": {
      "description": "Tabela de preços de venda por cliente/kg",
      "responsible": "Rafael"
    },
    "caminhoes": {
      "description": "Cadastro e manutenção da frota e equipamentos",
      "responsible": "Derick"
    },
    "adiantamentos": {
      "description": "Adiantamentos a fornecedores por carga",
      "responsible": "Thais"
    },
    "cheques": {
      "description": "Controle de cheques emitidos e compensações bancárias",
      "responsible": "Elaine"
    },
    "rod_balanca": {
      "description": "Pesagem de entrada e saída de caminhões",
      "responsible": "Thais"
    },
    "balanceiro": {
      "description": "Lançamento de bags, impureza e fechamento de tickets",
      "responsible": "Thais"
    },
    "canhoto_compra": {
      "description": "Emissão e controle de canhotos de compra",
      "responsible": "Thais"
    },
    "fornecedores": {
      "description": "Cadastro completo de fornecedores de sucata",
      "responsible": "Elaine"
    },
    "clientes": {
      "description": "Cadastro de clientes compradores de metal",
      "responsible": "Elaine"
    },
    "vales": {
      "description": "Controle de vales adiantados a funcionários",
      "responsible": "Elaine"
    },
    "despesas_grupo": {
      "description": "Controle de despesas por empresa e centro responsável",
      "responsible": "Elaine"
    },
    "contratos": {
      "description": "Gestão de contratos e acordos comerciais",
      "responsible": "Elaine"
    },
    "custo_casa": {
      "description": "Controle de gastos residenciais",
      "responsible": "Elaine"
    },
    "viagem_motorista": {
      "description": "Diárias, pernoites e custos de viagem por motorista",
      "responsible": "Derick"
    },
    "combustivel_rudnick": {
      "description": "Controle de abastecimento da frota",
      "responsible": "Derick"
    },
    "almoxarifado": {
      "description": "Controle de insumos e materiais internos",
      "responsible": "Derick"
    },
    "chat": {
      "description": "Comunicação interna entre usuários do sistema",
      "responsible": "Todos"
    },
    "suporte_tecnico": {
      "description": "Diagnóstico, reparo e backup do sistema ERP",
      "responsible": "Elaine"
    }
  },
  "expenseGroups": [
    "MABOR",
    "GRATUS",
    "MANUELA",
    "ELAINE",
    "RAFAEL"
  ],
  "expenseGroupColors": {
    "MABOR": "#1a5276",
    "GRATUS": "#1e8449",
    "MANUELA": "#a04000",
    "ELAINE": "#6c3483",
    "RAFAEL": "#0e6655"
  },
  "chequeBanks": [],
  "defaultChequeBank": "",
  "thirdPartyChequeBank": "Cheque de Terceiro",
  "chequeTemplateExamples": [],
  "fiscalDefaults": {
    "monthlyDepreciation": 0
  },
  "legacyRepairs": {
    "bankMovement": {
      "cutoffDate": ""
    }
  },
  "employeeBenefits": {
    "voucherPaymentDay": 20
  },
  "homeCostAreas": [
    { "name": "Casa", "icon": "🏠" },
    { "name": "Sítio", "icon": "🌳" },
    { "name": "Casa Glória", "icon": "🏡" },
    { "name": "Veículos Pessoais", "icon": "🚗", "vehicleExpenses": true }
  ],
  "homeCostDefaultArea": "Casa",
  "payrollDefaults": {
    "employerCostRate": 0.28
  }
};
