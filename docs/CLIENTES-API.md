# Cadastro de clientes pelo servidor

Endereço: `POST /api/master-data/customers` ([api/master-data/customers.ts](../api/master-data/customers.ts)), módulo `server/modules/customers`.

Precisa de `erpAccess` e `canCustomers`. Toda chamada leva um `operationId` (UUID): repetir a mesma operação devolve o resultado guardado (`alreadyCommitted: true`) em vez de gravar duas vezes.

## Ações

| Ação | Corpo | O que faz |
|---|---|---|
| `create` | `{ customer }` | Cria com o próximo código livre `C001`, `C002`... (o antigo usava "quantidade + 1" e repetia código depois de uma exclusão). |
| `update` | `{ id, customer, expectedUpdate? }` | Altera os campos enviados. Com `expectedUpdate` diferente do `_upd` gravado, recusa (`CUSTOMER_CHANGED`). |
| `delete` | `{ ids: [] }` | Apaga (`clientes/<id>: null`) e marca `clientesDeleted/<id>: true`. Bloqueia cliente com conta a receber, adiantamento ou cheque em aberto. |
| `merge` | `{ from \| fromName, into }` | Só administração. Junta o histórico de um cliente (ou de um nome antigo sem cadastro) dentro de outro e apaga o cadastro juntado. |
| `set-docs` | `{ id, docs }` | Grava a lista de documentos (só metadados; o arquivo fica em `empresaDocs`). |

`id` é a chave do cliente no Firebase (`CL...` nos antigos, igual ao código nos novos).

## Regras

- Nome obrigatório, em maiúsculas, sem repetir outro cliente ativo (ignora acentos e espaços).
- Nome novo não pode ter `. # $ [ ] /`: o histórico do cliente é guardado com o nome como chave no Firebase (adiantamentos, cheques, ficha, preços) e esses caracteres derrubariam a gravação.
- CPF e CNPJ (inclusive alfanumérico) validados; documento repetido em outro cliente é recusado.
- **Trocar o nome leva o histórico junto**, numa gravação só: `vendas.cliente`, `contasReceber.cli`, `adtCli`, `chequesCli`, `fcLanc`, `fcSaldoIni`, `precosCli` e pesagens de venda (`tickets` com `tipo: 'venda'`). Antes, renomear separava o cliente do próprio histórico.

## Tela

O ERP antigo chama a API por `window.erpCustomerRequest` (`_cliApi` no `app-core.js`) e aplica o resultado na memória (`_cliAplicarResultado`), inclusive a troca de nome nas vendas, contas a receber e ficha. Passam pela API:

- cadastro e edição (casca de cadastros);
- novo cliente dentro de Contas a Receber e da Agenda;
- exclusão, documentos e contas bancárias do cliente;
- "Juntar clientes" da Ficha.

A sincronização do navegador não grava mais `clientes` nem `clientesDeleted`.

## Regras do Firebase

`clientes` e `clientesDeleted` ficam com `.write: false`; `customerOperations` fechado. As pesagens (`tickets`) ganharam `.indexOn: ['tipo']` para a troca de nome buscar só as pesagens de venda.

**Ordem de publicação:** primeiro o código (Vercel), esperar todos recarregarem o ERP, e só depois `npm run deploy:rules:hml` / `prod`. Com as regras novas e uma tela antiga aberta, salvar cliente pelo navegador seria recusado.
