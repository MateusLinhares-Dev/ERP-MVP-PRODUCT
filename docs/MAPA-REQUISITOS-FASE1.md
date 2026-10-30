# Mapa de implementação — Fase 1 ERP Manuela Metais

Base: Especificação Funcional Fase 1 REVISADA, versão 1.1.

## Implementado nesta entrega

| Bloco | Requisitos |
|---|---|
| Balança / Balanceiro | BAL-01 a BAL-07 |
| Compra de Sucata | COM-01 a COM-08 |
| Agenda | AGE-01 a AGE-03 |
| Comercial / Vendas / Ficha | VEN-01 a VEN-07 |
| Usabilidade transversal | GER-01 a GER-09 |
| Financeiro | FIN-01, FIN-02, RN-02, RN-03, RN-04, RN-05, RN-06 |
| RH / Frota / Viagem | RH-01, RH-02, RH-03, FRO-01, VIA-01 |
| Fiscal | FIS-01 |
| Administração | ADM-01 a ADM-06 |

A implementação preserva histórico e evita migrações destrutivas automáticas. Novos cadastros estruturais auxiliares usam o repositório do Firebase e trilha de auditoria.

## Não implementado por depender de definição da cliente

| ID | Motivo |
|---|---|
| AD-01 | Descontinuações financeiras adicionais além das remoções já aprovadas precisam ser definidas pela contratante. |
| AD-02 | Campos finais dos cadastros fiscais ainda serão fornecidos pela contratante. |
| FIS-02 | Depende diretamente de AD-02. Nenhum campo fiscal foi inventado. |
| AD-03 | Estrutura final da reestruturação maior de RH/Ponto/Folha ainda será definida. |
| RN-07 | Depende diretamente de AD-03. |

## Fora desta entrega funcional

| ID | Motivo |
|---|---|
| FIS-03 | Certificado digital / acesso do contador depende de aceite comercial ou aditivo. |

## Arquitetura adicionada

```text
public/modules/
├── weighing/
│   ├── road-weighing-domain.js
│   ├── road-weighing-view.js
│   ├── road-weighing-flow.js
│   └── road-weighing-flow.css
└── phase1/
    ├── phase1-requirements.js
    ├── phase1-store.js
    ├── phase1-dom.js
    ├── phase1-purchase.js
    ├── phase1-purchase.css
    ├── phase1-agenda.js
    ├── phase1-agenda.css
    ├── phase1-alerts.js
    ├── phase1-alerts.css
    ├── phase1-commercial.js
    ├── phase1-commercial.css
    ├── phase1-usability.js
    ├── phase1-usability.css
    ├── phase1-finance.js
    ├── phase1-finance.css
    ├── phase1-operations.js
    ├── phase1-operations.css
    ├── phase1-fiscal-admin.js
    └── phase1-fiscal-admin.css
```

`public/app/bootstrap.js` é o composition root: carrega primeiro o legado, depois a Prioridade 1 e, por último, os módulos da Fase 1. O `app-core.js` não é substituído nesta entrega.
