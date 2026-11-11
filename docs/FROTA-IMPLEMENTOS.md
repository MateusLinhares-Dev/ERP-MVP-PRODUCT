# Frota: implementos (11/11/2026)

Pedido da cliente: separar os implementos dos caminhões, para ver a quantidade e achar rápido.

- **Tipos novos:** Carreta, Carretinha, Semirreboque, Garra e Outro implemento.
- **Grupos dos tipos** (`FROTA_GRUPOS`, em `public/legacy/app-core.js`):
  - Veículos: Caminhão e Carro;
  - Implementos: os tipos novos;
  - Equipamentos: Empilhadeira, Máquina, Balança, Prensa, Moedor, Retroescavadeira e Outros.
  - Tipo desconhecido vai para Equipamentos.
- **Abas acima da lista:**
  - Todos, Veículos, Implementos e Equipamentos, cada uma com a quantidade;
  - a aba escolhida fica guardada no navegador;
  - a busca procura em placa, modelo, marca, ano, capacidade, local e status, dentro da aba.
- **Cartão "Implementos"**, depois de Caminhões, com a quantidade por tipo (ex.: "1 semirreboque · 1 garra").
- **Botão de cadastro:**
  - na aba Implementos, vira "+ Novo Implemento" e o formulário já vem com o tipo Carreta;
  - "Placa / ID" aceita um nome quando não há placa (ex.: GARRA-01);
  - ID repetido não é aceito.
- Os campos são os mesmos dos caminhões: ano, modelo, marca e capacidade. Documento (CRLV) e fotos vão em 📎 Docs/Fotos.

## Notinha (pedido de compra)

- **O que acontecia:** a tabela "Adiantamentos e abatimentos desta compra" ganhou a coluna "Valor do adiantamento", mas as larguras do CSS eram de 4 colunas. A coluna nova ficou com largura zero: o título saiu em letras na vertical e os valores ficaram um sobre o outro.
- **Agora:** todas as tabelas da notinha têm uma largura definida para cada coluna (`colgroup`), somando 100%.
- Teste: `test/purchase-order-print.test.js`.
