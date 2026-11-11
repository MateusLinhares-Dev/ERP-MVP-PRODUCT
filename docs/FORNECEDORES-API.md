# Fornecedores pelo servidor (12/11/2026)

O cadastro de fornecedores passou a ser gravado **só pelo servidor**. Antes, cada tela gravava a lista inteira pela sincronização do navegador.

## API

`POST /api/master-data/suppliers`
- Exige `canSuppliers`; "restaurar todos" exige administração.
- Envie sempre um `operationId`: repetir a mesma operação devolve o resultado já gravado, sem duplicar.

| `action` | O que faz |
|---|---|
| `create` | Cria com o próximo código `F###`, pulando códigos de fornecedores excluídos. Recusa nome vazio, CPF/CNPJ inválido e CPF/CNPJ já usado por outro fornecedor |
| `update` | Altera só os campos do cadastro. Mantém documentos, contas e outros campos. Com `expectedUpdate`, recusa se outra tela alterou antes |
| `delete` | Marca como excluído (`erp/fornDeleted`). Recusa se houver adiantamento em aberto, dinheiro a repassar ou compra com saldo a pagar. Não deixa excluir todos de uma vez |
| `restore-all` | Remove todas as exclusões (só administração) |
| `import` | Até 500 por vez. Pula CPF/CNPJ já cadastrado e, sem documento, nome igual. Aponta as linhas inválidas |
| `set-docs` | Grava a lista de documentos do fornecedor |

- Código: `server/modules/suppliers/` (`domain/supplier-rules.ts` e `application/supplier-registry.ts`).
- Testes: `test/supplier-registry.test.js`, com o SDK real do Firebase sobre o banco simulado.

## Na tela

- `public/legacy/app-core.js`:
  - `_fornApi` chama a API e `_fornAplicarResultado` atualiza a lista em memória (`FORNECEDORES`), as listas de escolha e o aviso `erp:catalog-updated`;
  - a lista de excluídos vinda do Firebase passa a ser a verdade, e não só somada; assim "restaurar" chega a todas as telas.
- `public/modules/master-data/master-data-forms.js`:
  - "Novo fornecedor" e "Editar" enviam todos os campos à API;
  - editar um fornecedor antigo não preenche mais "Fornecedor desde" com a data de hoje (o mesmo vale para clientes).
- Excluir, excluir vários, restaurar, importar planilha e documentos usam a API.
- Foram removidas as funções antigas de editar e salvar fornecedor do `app-core.js`.
- `public/legacy/firebase-sync.js` não grava mais `fornecedores`, `fornDeleted` nem as exclusões de fornecedor (`fornecedoresDeleted`).

## Regras do Firebase

`fornecedores`, `fornDeleted` e `fornecedoresDeletedV2` ficaram com `.write: false` (o servidor grava com permissão própria). Essas regras são geradas por `npm run generate:rules:candidate`, e o servidor passou a gravar o resultado das operações em `supplierOperations`.

**Ordem de implantação:**
1. Publique o código, primeiro em HML.
2. Espere todos recarregarem o ERP. Uma aba antiga mostra a faixa vermelha "versão desatualizada".
3. Só então rode `npm run deploy:rules:hml` (e depois `deploy:rules:prod`).

Se as regras forem publicadas antes, uma aba antiga que ainda grava fornecedores terá aquele envio recusado. O envio vai em lote, então os outros dados do mesmo lote também não são gravados.

## Próximo passo

Tela de Fornecedores em React (lista, busca, cadastro), usando esta API.
