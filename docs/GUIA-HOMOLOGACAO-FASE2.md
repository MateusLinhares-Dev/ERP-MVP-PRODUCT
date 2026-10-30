# Guia de Homologação — Fase 2 / feedback 20/10/2026

Execute **somente em HML** e, para operações que alteram dados financeiros/estoque, use registros de teste identificáveis. Antes de iniciar, faça backup/snapshot quando disponível.

## 0. Smoke técnico

1. Publicar o pacote na branch `hml`.
2. Abrir o ERP com Elaine/admin.
3. DevTools → Console: não deve haver erro de sintaxe/carregamento de `phase2-feedback.js`.
4. No console, `window.__PHASE2_FEEDBACK_READY__` deve retornar `true`.
5. Dar F5 e confirmar que os dados persistem.

**Aceite:** aplicação inicia, menus carregam e não há regressão que impeça navegação.

---

## 1. Compra de Sucata — observações no histórico

1. Abrir uma compra existente com 2 materiais.
2. Informar observação diferente em cada material durante a compra, se o fluxo permitir.
3. Finalizar/salvar.
4. Abrir o detalhe/histórico da mesma compra.
5. Na coluna **Observação**, editar um dos textos, por exemplo `Material com impureza - teste HML`.
6. Sair do detalhe, dar F5 e abrir novamente.

**Aceite:** observação é individual por material, editável no histórico e continua salva após F5. Não pode alterar peso, preço ou observação de outro item por engano.

---

## 2. Clientes / Fornecedores / dados bancários

### 2.1 Cliente com múltiplas contas

1. Clientes → abrir dados bancários de `CLIENTE TESTE 1`.
2. Cadastrar pelo menos 4 contas com Banco, Agência, Conta e PIX.
3. Redimensionar o navegador para uma largura menor.
4. Salvar, fechar, reabrir e dar F5.

**Aceite:** nenhum input sai para fora do modal; não existe scroll horizontal causado pela linha; todas as contas reaparecem.

### 2.2 Fornecedor sem multibanco/restauração

1. Abrir Fornecedores.
2. Conferir a linha de um fornecedor.
3. Abrir cadastro/edição.

**Aceite:** não existe botão de múltiplos bancos na listagem e não existe botão **Restaurar**. Cadastro normal de fornecedor continua funcionando.

---

## 3. Calendário / Afazeres

1. Abrir Calendário.
2. Confirmar que a visão anual com 12 caixas não está mais ocupando a tela.
3. Usar **Hoje**.
4. Trocar o mês no seletor.
5. Pesquisar parte do texto de um compromisso digitando uma palavra inteira sem clicar novamente no input.
6. Abrir **Histórico** e fechá-lo novamente.
7. Abrir um dia e adicionar/alterar um afazer.

**Aceite:** visão principal é compacta, mês e dia ficam organizados, próximos compromissos aparecem sem poluição, histórico fica recolhível e a pesquisa mantém o foco enquanto digita.

---

## 4. Campos numéricos

Verificar pelo menos: preço, quantidade do Almoxarifado, valor de EPI, valor de conta e Fiscal.

**Aceite:** inputs numéricos não exibem as setas nativas de aumentar/diminuir valor no lado direito. Digitação e validação continuam normais.

---

## 5. Preços Fornecedor / Preços Clientes

### Preços Fornecedor

1. Abrir Preços Forn.
2. Digitar parte do nome de um fornecedor na nova busca.
3. Selecionar o fornecedor.
4. Digitar parte de um material na busca de material.

### Preços Clientes

Repetir com `CLIENTE TESTE 1`.

**Aceite:** busca de pessoa reduz as opções sem perder foco; busca de material filtra as linhas/opções; preço salvo continua persistindo.

---

## 6. Cheques — sequência, duplicidade, busca e limpeza visual

Use um banco de teste, por exemplo `BANCO TESTE HML`.

1. Abrir Cheques (Controle).
2. Confirmar que não existe o bloco amarelo de instruções antigo e nem **Sincronizar aba antiga**.
3. Cadastrar cheque nº `198` no banco de teste.
4. Cadastrar cheque nº `200` no mesmo banco.
5. Ao informar 200, confirmar o aviso de que `199` será pulado e salvar conscientemente.
6. Na tela, conferir o indicador **Faltando: 199**.
7. Tentar cadastrar novamente nº `198` no mesmo banco.
8. Confirmar que a duplicidade é bloqueada.
9. Editar o cheque 200 sem alterar o número e salvar — não deve acusar o próprio registro como duplicado.
10. Cadastrar nº `199` e confirmar que a lacuna desaparece.
11. Na pesquisa, digitar `CLIENTE TESTE 1` inteiro sem reclicar letra a letra.

**Aceite:** sequência é calculada **por banco** usando os números reais dos cheques; duplicidade no mesmo banco é bloqueada; pulo é alertado; busca preserva foco; tela antiga redundante não aparece.

---

## 7. Contas a Pagar empresarial × Contas da Dona

### 7.1 Empresa

1. Abrir Contas a Pagar.
2. Confirmar que não existe a aba `Contas a Pagar Fixas` misturada ao módulo.
3. Confirmar que **Vencimentos de hoje** está recolhível.
4. Abrir/fechar **Filtros avançados**.
5. Filtrar por fornecedor/categoria/status e confirmar que os filtros continuam funcionando.
6. Abrir uma conta empresarial e pagar/editar em registro de teste.

**Aceite:** fluxo principal fica limpo, sem perder filtros e ações existentes.

### 7.2 Dona

1. Com Elaine/admin, abrir **Contas da Dona** no menu.
2. Cadastrar `Energia casa HML`, valor `250`, vencimento dia `10`, categoria `Casa`.
3. Salvar e dar F5.
4. Inativar/reativar.
5. Voltar para Contas a Pagar empresarial.

**Aceite:** conta pessoal persiste no módulo da dona e **não** cria uma conta empresarial. Usuário sem permissão de dona/admin não deve receber esse módulo.

---

## 8. Adiantamentos

1. Abrir Adiantamentos → **Em aberto**.
2. Criar adiantamento para fornecedor sem preencher **Compra relacionada (opcional)**.
3. Confirmar que salva como crédito geral do fornecedor.
4. Criar outro adiantamento e selecionar/digitar um ticket real na Compra relacionada.
5. Abater um adiantamento em compra de teste.
6. Abrir **Histórico / quitados**.
7. Pesquisar fornecedor digitando o nome inteiro.

**Aceite:** ticket não é obrigatório; a interface deixa claro quando usar; valor abatido passa para histórico/quitados; pesquisa mantém foco.

---

## 9. Almoxarifado + EPI — fluxo único

### 9.1 Quantidade unitária

1. Criar/usar item `LUVA HML`, unidade `un`, estoque `4`.
2. Tentar editar/cadastrar quantidade `0,01`.
3. Tentar movimentar `0,5` unidade.

**Aceite:** ambos são bloqueados. Para item `un`, somente inteiros são aceitos. Se existir resíduo histórico `3,99` proveniente do bug anterior e estiver dentro da correção segura, deve normalizar para `4` uma vez.

### 9.2 Entrada x entrega de EPI

1. Em **Movimentação**, fazer uma **Entrada** de 2 luvas.
2. Confirmar estoque `6`.
3. Abrir **Entrega de EPI** dentro do Almoxarifado.
4. O dropdown de EPI deve mostrar somente itens EPI existentes no Almoxarifado com saldo; não o catálogo fixo antigo.
5. Selecionar funcionário ativo e entregar 1 `LUVA HML`.
6. Confirmar estoque `5`.
7. Conferir histórico do funcionário: deve existir **um** registro de entrega.
8. Conferir movimentação: deve existir **uma** saída vinculada.
9. Trocar funcionário no painel integrado.

**Aceite:** entrada aumenta estoque; entrega ao funcionário reduz estoque uma única vez. Não pode ocorrer dupla baixa. Histórico mostra somente o funcionário selecionado.

### 9.3 Editar por funcionário

1. No histórico integrado ou Por Funcionário, editar a entrega de `1` para `2`.
2. Salvar.

**Aceite:** estoque diminui somente a diferença adicional de 1; histórico e movimentação passam a 2. Editar de 2 para 1 deve devolver 1 ao estoque.

### 9.4 Funcionário inativo

**Aceite:** funcionário inativo não aparece como destino de nova entrega.

---

## 10. Frota / Manutenção

1. Abrir veículo com pelo menos 2 manutenções em datas diferentes.
2. Abrir ficha do veículo.
3. Conferir KPIs: gasto total, gasto no ano, quantidade, última manutenção.
4. Pesquisar por oficina/serviço/tipo.
5. Filtrar `Concluída`, `Em Andamento`, `Agendada`.
6. Editar uma manutenção e reabrir a ficha.
7. Cadastrar nova manutenção.

**Aceite:** manutenções aparecem em ordem cronológica decrescente correta para `dd/mm/aaaa`, em cartões legíveis; filtros não alteram dados; edição/cadastro continuam funcionando.

---

## 11. Viagem Motorista

Criar viagem de teste:

- Saída: hoje
- Volta: dia seguinte
- Destino: `ROTA HML`
- Diária: `80`
- Pernoite: `40`
- Alimentação: valores de teste
- Gastos extras: `30`
- Adiantamento ao motorista: `300`

Fluxo:

1. Conferir as etapas **1 Dados da viagem**, **2 Diária e pernoite**, **3 Refeições**, **4 Prestação de contas**.
2. Abrir as refeições somente quando necessário.
3. Conferir resumo de Diárias, Refeições, Combustível, Outras despesas e saldo de prestação.
4. Registrar.
5. Conferir cartão do histórico.
6. Abrir **Ver tabela detalhada**.

**Aceite:** cartão usa `totalDiarias`, `totalRefeicoes`, `gastosExtras`, `dinheiroAlim` e o acerto correto. A tela deve deixar claro se o motorista **devolve** saldo ou se a empresa **reembolsa**.

---

## 12. Fiscal — cadastros próprios e fonte exclusiva

### 12.1 Fornecedor Fiscal

Criar `FORNECEDOR FISCAL HML` preenchendo, quando aplicável:

- Pessoa Jurídica
- Razão social e fantasia
- CNPJ
- IE / IM
- Indicador IE
- SUFRAMA (se aplicável; pode ficar vazio)
- Regime tributário
- E-mail e e-mail NF-e/XML
- Telefone
- CEP, UF, país, código IBGE município
- Logradouro, número, complemento, bairro e cidade

Salvar, editar um campo e dar F5.

### 12.2 Cliente Fiscal

Criar `CLIENTE FISCAL HML` com o mesmo conjunto apropriado.

### 12.3 Isolamento dos módulos Comercial/Fiscal

1. Garantir que exista `CLIENTE TESTE 1` no módulo Comercial, mas não no Fiscal.
2. Fiscal → Lançar Saída: abrir lista/datalist de cliente.
3. `CLIENTE TESTE 1` **não** deve ser oferecido.
4. `CLIENTE FISCAL HML` deve aparecer.
5. Fiscal → Lançar Entrada: somente fornecedores fiscais ativos devem ser oferecidos.
6. Trocar tipo dentro do modal quando aplicável e confirmar que a fonte continua fiscal.

**Aceite:** os lançamentos não reutilizam `CLIENTES`/`FORNECEDORES` do ERP comercial. Inativar cadastro fiscal remove-o das novas sugestões sem apagar histórico fiscal já existente.

---

## 13. Despesas do Grupo

1. Abrir Despesas Grupo.
2. A visão inicial deve ser **Despesas do mês**, não o formulário pesado de lançamento.
3. Pesquisar uma despesa.
4. Abrir `＋ Nova despesa` somente quando necessário.
5. Conferir Histórico e Por fornecedor.

**Aceite:** módulo abre em visão de consulta limpa e mantém lançamento disponível como ação secundária.

---

## 14. Contratos — renomear anexo

1. Abrir contrato que tenha PDF/anexo.
2. Clicar **Nome arquivo**.
3. Alterar de `contrato.pdf` para `contrato-2026`.
4. Reabrir/listar novamente.
5. Abrir o arquivo.

**Aceite:** nome salvo vira `contrato-2026.pdf`, preservando a extensão e o conteúdo do arquivo.

---

## 15. Custo Casa

1. Abrir Custo Casa.
2. Confirmar que não existe aba `Casa Glória`.
3. Registros antigos de Casa Glória devem estar sob `Casa`.
4. Dar F5.
5. Navegar Casa, Sítio, Veículos Pessoais e Resumo.

**Aceite:** Casa Glória não volta a ser criada pela configuração nem pelos dados históricos; não ocorre duplicidade de área.

---

## 16. Coordenação

### 16.1 Funcionário inativo

1. Inativar `TESTE FUNCIONÁRIO` no RH.
2. Abrir Coordenação.
3. Nova Reunião/DDS → participantes.
4. Abrir aba Funcionários.

**Aceite:** inativo não aparece nos participantes nem nos cartões/gráficos funcionais.

### 16.2 Tipo

Abrir novo registro e conferir:

- Reunião
- DDS — Diálogo Diário de Segurança
- Treinamento
- Inspeção / Segurança
- Outro

**Aceite:** lista não fica vazia e existe ajuda explicando que não há cadastro externo de tipos.

### 16.3 Bags

1. Abrir Bags.
2. Ler bloco **Como funciona**.
3. Conferir termos: `Bag recebida com carga de fornecedor`, lavagem e `Registrar retorno ao fornecedor`.
4. Em um fluxo real de teste, retorno ao fornecedor deve fazer sentido apenas para saldo originado daquele fornecedor/ticket.

**Aceite:** tela não usa “devolver bags” sem indicar a origem/regra.

---

## 17. Regressão obrigatória da Fase 1

Depois desta revisão, repetir pelo menos:

1. Balança Rodoviária → fluxo somente Rodoviária → Compra de Sucata.
2. Balança Rodoviária → Balanceiro → retorno/peso final → Compra de Sucata.
3. Compra de Sucata → cálculo de materiais/preços/total.
4. Cliente e Fornecedor persistem após F5 sem misturar as coleções.
5. Agenda Entregas continua salvando e listando.
6. Venda continua baixando estoque e gerando Contas a Receber conforme status.
7. Preço Cliente/Fornecedor continua persistindo.
8. Login/permissões: usuário restrito não ganha módulos que não possui.

**Aceite:** nenhuma melhoria visual/regra desta Fase 2 quebra o fluxo operacional já validado.

---

## Resultado da homologação

Para cada bloco marque: `OK`, `ERRO`, `AJUSTE`, com print e registro utilizado. Não promover para produção enquanto houver erro de regra de negócio, persistência, permissão ou cálculo.
