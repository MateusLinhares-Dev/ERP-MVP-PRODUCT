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
      "icon": "🏭"
    },
    "gratus": {
      "label": "Gratus Metais",
      "shortLabel": "Gratus",
      "icon": "🏪"
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
      "description": "Santander, Sicredi, Itaú e outros (14 contas)",
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
      "description": "Frota: 10 caminhões + 4 empilhadeiras",
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
      "description": "Despesas das empresas do grupo (Mabor, Gratus, Manuela)",
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
  "chequeBanks": [
    {
      "name": "Mabor Sicredi",
      "code": "BAN005",
      "slug": "MS",
      "color": "#c0392b",
      "order": 1,
      "aliases": [
        "mabor"
      ]
    },
    {
      "name": "Gratus Acredi",
      "code": "BAN008",
      "slug": "GA",
      "color": "#1565c0",
      "order": 2,
      "aliases": [
        "acred"
      ]
    },
    {
      "name": "Gratus Sicredi",
      "code": "BAN007",
      "slug": "GS",
      "color": "#2e7d32",
      "order": 3,
      "aliases": [
        "sicredi"
      ]
    },
    {
      "name": "Gratus Itaú",
      "code": "BAN006",
      "slug": "GI",
      "color": "#e67e22",
      "order": 4,
      "aliases": [
        "itau",
        "itaú"
      ]
    },
    {
      "name": "Manuela Santander",
      "code": "BAN001",
      "slug": "MSA",
      "color": "#8e44ad",
      "order": 5,
      "aliases": [
        "santander",
        "manuela"
      ]
    },
    {
      "name": "Cheque de Terceiro",
      "code": "",
      "slug": "CT",
      "color": "#00838f",
      "order": 6,
      "aliases": [
        "terceiro"
      ]
    }
  ],
  "defaultChequeBank": "Mabor Sicredi",
  "thirdPartyChequeBank": "Cheque de Terceiro",
  "chequeTemplateExamples": [
    [
      1,
      "Mabor Sicredi",
      "01/06/2026",
      "Ademir",
      11267.96,
      "11/06/2026",
      "COMPENSADO"
    ],
    [
      2,
      "Mabor Sicredi",
      "01/07/2026",
      "Ademir",
      11267.96,
      "",
      "PENDENTE"
    ],
    [
      3,
      "Gratus Sicredi",
      "01/08/2026",
      "Carlos",
      5000.0,
      "",
      "PENDENTE"
    ],
    [
      4,
      "Mabor Sicredi",
      "01/09/2026",
      "Jose",
      8000.0,
      "",
      "PENDENTE"
    ]
  ]
};
