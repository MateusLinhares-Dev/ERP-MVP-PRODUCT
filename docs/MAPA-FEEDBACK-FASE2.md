# Mapa de feedback — revisão HML 20/10/2026

Este documento relaciona cada ponto levantado na homologação com a solução aplicada. O arquivo principal da revisão é `public/modules/phase2/phase2-feedback.js`, com estilos em `phase2-feedback.css`.

| Feedback | Ajuste aplicado | Validação principal |
|---|---|---|
| Observação da Compra de Sucata também precisa existir no histórico | Detalhe/histórico da compra ganha coluna **Observação** editável por material e persiste no ticket | Reabrir a mesma compra e confirmar o texto salvo |
| Modal de bancos do cliente estourando layout | Grid responsivo, `min-width:0`, largura limitada e inputs contidos | Cadastrar 4+ contas no cliente sem overflow horizontal |
| Fornecedor não deve ter multibanco | Botão multibanco removido de Fornecedores; permanece somente em Clientes | Abrir Clientes e Fornecedores e comparar ações |
| Botão Restaurar de Fornecedores não faz sentido | Ação removida da interface de Fornecedores | Confirmar ausência do botão |
| Calendário poluído | Visão anual removida; toolbar compacta, mês atual, busca, próximos compromissos, histórico recolhível e área mês/dia lado a lado | Abrir Calendário e navegar mês/dia/histórico |
| Pesquisa perde foco a cada caractere | Buscas críticas deixam de disparar render completo; filtragem ocorre no DOM preservando foco | Digitar uma palavra inteira sem reclicar no input |
| Spinners/setas em campos numéricos | Removidos via CSS global para `input[type=number]` | Conferir valor/quantidade/preço em Chrome/Edge |
| Preços Fornecedor/Cliente sem busca | Incluídas busca de pessoa e busca de material | Pesquisar parte do nome e do material |
| Cheques com ajuda antiga e “Sincronizar aba antiga” | Bloco legado e botão removidos; cabeçalho simplificado | Abrir Controle de Cheques |
| Cheques não detectavam numeração pulada | Regra corrigida para os campos reais `b` (banco) e `n` (número); lacunas por banco, duplicidade e aviso no cadastro | Cadastrar 198 e depois 200 no mesmo banco e ver 199 faltante |
| Contas a Pagar Fixas eram pessoais da dona | Criado **Contas da Dona**, isolado do Contas a Pagar empresarial e visível apenas para dona/admin | Criar conta pessoal e confirmar que não entra no CP empresarial |
| Contas a Pagar muito poluído | Vencimentos de hoje recolhíveis, filtros densos em “Filtros avançados”, KPIs/tabela compactos | Fluxo principal deve caber sem abrir filtros avançados |
| Adiantamento confuso / “Vinculado Ticket” | Campo renomeado para **Compra relacionada (opcional)**, datalist de compras, explicação e Histórico/quitados destacado | Criar adiantamento geral sem ticket e outro ligado a compra |
| Almoxarifado aceitava 0,01 para item unitário e ficou 3,99 | Quantidade unitária exige inteiro; correção pontual de resíduos próximos do inteiro (ex.: 3,99→4) | Item `un`: tentar 0,01 e validar bloqueio |
| EPI mostrava catálogo que não existe no Almoxarifado | Entrega integrada lista somente EPIs existentes no estoque com saldo | Criar apenas uma luva no Almox e confirmar única opção |
| EPI/Almox duplicavam/confundiam baixa | Fluxo único: entrega reduz estoque **uma vez** + cria movimento + histórico EPI vinculados | Estoque 4 → entregar 1 → estoque 3, um movimento e um histórico |
| Histórico por funcionário não editava | Retiradas e entregas vinculadas ganham edição de quantidade/data/observação, reconciliando saldo | Editar 1→2 e verificar saldo correspondente |
| Frota/manutenção ruim de acompanhar | Ficha redesenhada em timeline com KPIs, busca, filtro de status e manutenção em cartões | Abrir veículo com 2+ manutenções e filtrar |
| Viagem Motorista agrupada e confusa | Formulário organizado em 4 etapas, refeições recolhíveis, prestação de contas e histórico em cartões; tabela detalhada opcional | Registrar viagem com alimentação, extras e adiantamento |
| Fiscal por nossa conta / campos incompletos | Cadastro fiscal próprio PF/PJ com CNPJ/CPF, IE, IM, indicador IE, SUFRAMA, regime, contatos, e-mail NF-e/XML, endereço, IBGE, etc. | Cadastrar Cliente Fiscal e Fornecedor Fiscal completos e editar |
| Lançamento Fiscal ainda pegava cliente/fornecedor comercial | Modal Fiscal passa a usar somente `fiscalParties`; listas do Comercial não são fonte fiscal | Comercial “CLIENTE X” não deve aparecer se não existir no Fiscal |
| Despesas Grupo poluído | Entrada padrão no extrato/despesas do mês; abas e busca simplificadas | Abrir módulo e confirmar que formulário pesado não é a primeira visão |
| Contrato não permite renomear arquivo | Ação **Nome arquivo** preservando extensão do anexo | `contrato.pdf` → `contrato-2026.pdf` e abrir anexo |
| Casa e Casa Glória duplicadas | Dados/tabs Casa Glória consolidados em Casa; configuração filtrada para não recriar | Não pode existir tab Casa Glória após F5 |
| Funcionário inativo ainda aparece na Coordenação | Participantes, cards e filtros eliminam funcionários inativos | Inativar usuário e confirmar ausência após F5 |
| Tipo de Coordenação vazio | Restaurados tipos padrão: Reunião, DDS, Treinamento, Inspeção/Segurança e Outro, com ajuda inline | Abrir nova reunião/DDS e selecionar tipo |
| Bags sem regra clara | Textos explicam origem: bag recebida com carga gera saldo do fornecedor, lavagem transforma suja→limpa e retorno só existe quando houver saldo de origem | Validar texto e fluxo com fornecedor/ticket |

## Arquivos alterados/adicionados

- `public/app/bootstrap.js`
- `public/modules/phase1/phase1-usability.js`
- `public/modules/phase1/phase1-finance.js`
- `public/modules/phase1/phase1-requirements.js`
- `public/modules/phase2/phase2-feedback.js`
- `public/modules/phase2/phase2-feedback.css`
- `test/phase2-feedback.test.js`
