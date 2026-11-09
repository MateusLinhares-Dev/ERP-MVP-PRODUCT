# Lançamento rápido (celular + voz)

Tela simplificada, separada do ERP, para lançar **Compra** e **Venda** pelo celular falando.
Endereço: `https://<domínio do ERP>/rapido/`. O login é o mesmo do ERP (só a senha).

## Como funciona

1. A pessoa entra com a senha na tela de login normal.
2. Se o perfil dela tem só "Lançamento rápido", ela vai direto para `/rapido/`. O ERP não é carregado.
3. Toca em **COMPRA** ou **VENDA**, depois no microfone, e fala, por exemplo:
   - "Comprei 350 quilos de cobre mel do João a 42 reais."
   - "Vendi 2 toneladas de ferro para a Gerdau a 1 real e 20, vence dia 20."
   - "Comprei cobre mel 120 quilos a 45 e 50 e latão 80 quilos a 30 da Maria."
4. Os campos são preenchidos e ficam **amarelos** para conferir. O que não foi dito fica vazio.
   - O que ficou em dúvida aparece no quadro "Confira". Por exemplo, "Qual cobre? COBRE MEL / COBRE MISTO".
   - Se a tabela de preços tiver valor, aparece o botão "Usar preço da tabela".
5. **Conferir e salvar** mostra um resumo em linguagem simples, e só **"Está certo, SALVAR"** grava.
6. **Fotos e PDF** são opcionais: tirar foto do ticket ou da nota, ou escolher um arquivo. As fotos são reduzidas automaticamente.
7. **Meus lançamentos** mostra o histórico, a situação ("A pagar", "Pago", "A receber"…) e os anexos.

O que é gravado no ERP:

| Lançamento | Registros criados |
|---|---|
| Compra | Pedido `T###` em Compra de Sucata (origem "celular") + conta a pagar `CPPO_T###`, com vencimento escolhido. Usa a mesma API da tela de compra: travas, recibo idempotente, nunca duplica. |
| Venda | Venda em Vendas + conta a receber pendente, gravadas juntas. |

Pagamento, recebimento, adiantamentos e cheques continuam sendo feitos no ERP pelo escritório.

## Configuração (uma vez)

1. **Publicar** esta versão (Vercel) e pedir que todos recarreguem a página.
2. **Criar o usuário do dono** em Usuários → Novo usuário:
   - marcar só **"Lançamento rápido (celular/voz)"**;
   - não marcar administrador.
3. **Dar acesso a quem já usa o ERP** (opcional): marcar também "Lançamento rápido" no usuário. Aparece o botão **🎤 Lançamento rápido** no cabeçalho do ERP. Administradores já veem o botão e, no histórico do celular, os lançamentos de todos.
4. **Instalar no celular do dono**:
   - abrir o endereço `/rapido/` no Chrome (Android) ou Safari (iPhone);
   - fazer login;
   - no menu do navegador, escolher **"Adicionar à tela inicial"**. Vira um ícone verde "Lançar".
5. **Microfone**: na primeira vez o navegador pergunta; tocar em **Permitir**. Se o navegador não tiver reconhecimento de voz, use o microfone 🎤 do teclado no campo de texto. Funciona igual.

### IA para entender a fala (opcional)

- **Sem configurar nada**, o celular usa o interpretador local. Ele é gratuito e entende:
  - números falados e toneladas;
  - "1 real e 20";
  - vários materiais na mesma frase;
  - nomes parciais;
  - "vence dia 20", "para 15 dias" e "nota 4521".
- **Para usar a IA (Claude)**, cadastre na Vercel (Settings → Environment Variables), de preferência na conta da empresa:
  - `ANTHROPIC_API_KEY`: chave da API da Anthropic. Sem ela, o interpretador local é usado automaticamente.
  - `ANTHROPIC_MODEL` (opcional): o padrão é `claude-opus-5-5`.
- A IA só pode escolher nomes que existem no cadastro, e o servidor confere de novo tudo o que ela devolve. A fala nunca grava nada sozinha.
- O fallback automático do servidor fica ativado (`fallbacks: "default"`).
- **Custo**: cada interpretação manda à IA a lista de materiais e de fornecedores/clientes. O custo varia com o tamanho do cadastro e é cobrado pela Anthropic. Confira o consumo no painel da Anthropic na primeira semana.

## Limites da V1 (conforme proposta ELT-ERP-2026-003)

- Somente Compra e Venda. Compra sem adiantamento ou cheque (o escritório compensa em Contas a Pagar).
- Fornecedor, cliente e material precisam estar cadastrados no ERP. Cadastro novo é feito no escritório.
- Anexos: JPG, PNG ou PDF de até 3 MB e até 8 por lançamento. Ficam no Firebase Storage em `lancamento-rapido/`.
- Precisa de internet. Não há modo offline.

## Técnico

- Tela: `public/rapido/` (`index.html`, `rapido.js`, `parser.js`, `rapido.css`, manifest e ícones).
- API: `api/quick/{options,purchase,sale,history,attachment,interpret}.js`.
- Regras de negócio: `server/application/quick-entry.js` e `server/application/quick-interpret.js`.
- Permissão:
  - aba `lancamento_rapido` → claim `canQuickEntry` (`server/domain/access.js`), válida após novo login;
  - admin sempre tem.
- Nós do RTDB: `erp/quickEntries`, `erp/quickUploads` e `erpQuickLocks`. Não têm regra própria, então ficam bloqueados para o navegador; só o servidor (Admin SDK) acessa. **Não é preciso publicar regras.**
- `vercel.json`: `microphone=(self)`, liberado só para o próprio site; antes estava bloqueado. `maxDuration` de 30 s em interpret, purchase e attachment.
- Testes:
  - `test/quick-entry.test.js`: SDK real contra o RTDB simulado. Cobre compra, venda, idempotência, número de pedido, anexos, histórico, IA, interpretador e redirecionamento do login.
  - A tela foi testada em Chromium com tela de celular: preencher pela fala, conferir, salvar, voltar, venda manual, anexo e histórico.
