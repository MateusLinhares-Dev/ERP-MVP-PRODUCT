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

## Tela em React (12/11/2026)

- A lista e o formulário de fornecedores de compra estão em React e usam esta API. Ver `docs/ARCHITECTURE.md`, etapa 5.
- O botão "Restaurar excluídos" não aparece, como já acontecia antes (o `phase2-feedback.js` o escondia). A ação `restore-all` continua no servidor, para uso do suporte.

## Fornecedor renomeado (17/11/2026, v243)

Problema da cliente: depois de editar o nome do fornecedor Jorge, a notinha T178 parou de abrir para editar ("Fornecedor do pedido não está mais ativo no cadastro."). A compra guarda o código (`fornecedorCod`) e o nome da época. A tela de compra, porém, procurava o fornecedor só pelo nome.

O que mudou:

- **Editar pedido e fechar pesagem** (`purchase-order.js`, `supplierForTicket`): a busca usa primeiro o código. Se o pedido não tiver código, compara o nome atual e depois os nomes anteriores. Espaços repetidos e maiúsculas/minúsculas não contam. O formulário mostra o nome atual. O servidor não troca o nome gravado na compra, porque o código é o mesmo e para ele não houve troca de fornecedor.
- **Nomes anteriores**: ao renomear pela API, o servidor guarda o nome antigo em `nomesAnteriores` no cadastro. São no máximo 10, sem repetir e sem o nome atual. A tela não consegue gravar esse campo, porque `cleanSupplier` só aceita os campos do formulário.
- **Telas antigas** (`app-core.js`): `_fornPorNome` e `_ticketDoForn` comparam pelo código quando os dois lados têm código e, se não tiverem, pelo nome atual ou anterior. Usam essa regra:
  - escolher o fornecedor no Lançamento (`csCarregarForn`), que carrega as pesagens aguardando preço;
  - o Balanceiro (`balIniciarNovaSessao`), que guarda só o nome na sessão e assim não abre uma segunda sessão para o mesmo fornecedor;
  - a Ficha do fornecedor.
- O caso do Jorge não tem nome anterior guardado, porque foi renomeado antes desta versão. A busca pelo código resolve: a T178 tem `fornecedorCod`.

Não muda: um fornecedor de fato inativo ou excluído continua bloqueando a edição. A mensagem agora mostra o nome gravado no pedido e diz para reativá-lo em Fornecedores.

## Preço da tabela na notinha e contas PIX (17/11/2026, v244)

- **Preço da tabela:** ao escolher o material numa linha da notinha, a tela usa o preço da "Tabela de Preços de Compra por Fornecedor" do fornecedor escolhido (`tablePrice` em `purchase-order.js`, sem diferenciar maiúsculas e minúsculas).
  - Antes, isso só acontecia nas pesagens que vinham da balança; na linha digitada à mão o preço ficava vazio.
  - Um preço digitado à mão não é trocado ao mudar o material.
  - Trocar o fornecedor preenche as linhas sem preço.
- **Excluir conta bancária/PIX do fornecedor:** a janela "Contas / PIX" (Fornecedores → 💳) ganhou o botão "✏️ Editar ou excluir contas". Ele abre o cadastro de contas (`phase3OpenPartyBanks`), que tem o ✕ de cada conta e o Salvar. É o mesmo cadastro do botão "Contas bancárias" no formulário do fornecedor.

## Contas antigas do fornecedor nas duas janelas (17/11/2026, v246)

Problema da cliente: a janela 💳 "Contas / PIX" do fornecedor Samoel mostrava 5 contas, mas "Contas bancárias e PIX" (onde se edita e exclui) mostrava só 1.

Causa:
- Enquanto o fornecedor não tem a lista oficial (`partyBanks/fornecedor-<cód>`), a janela de PIX juntava a conta principal do cadastro com as contas guardadas em campos antigos (`contas`, `contasBancarias`, `contas_bancarias`, `contasPix`, `dadosBancarios`).
- O cadastro de contas lia só a principal.
- Salvar ali gravava a lista oficial só com essa conta, e as outras sumiam também do PIX.

Agora `bankList` (`phase3-homologation.js`) monta uma lista só, e as duas janelas usam ela (`ERPPartyBanks.list`):
- **Ordem:** a conta principal vem primeiro, depois os campos antigos, na mesma ordem de antes. Ao salvar, a primeira conta continua sendo a principal do cadastro, e a conta de um terceiro não vira a principal.
- **Repetidas:** contas iguais escritas de jeitos diferentes (ex.: "769 839-9" e "769839-9" no mesmo banco, agência e PIX) aparecem uma vez só. Se a principal não tinha titular próprio, fica o titular da conta antiga.
- **Campos antigos aproveitados:** `ag`, `numeroConta`, `chave_pix`, `pais` (Brasil → BR) e `tipoConta` (C/C → Corrente). Valores fora da lista das regras ficam "Não informado".
- Depois de salvar uma vez, vale só a lista oficial, como antes.
