# Logs, calendário e avisos (10/11/2026)

## Filtro de logs (Engenharia → Auditoria e logs)

**Problema:** filtrar pelo módulo `phase1` não trazia nada, embora houvesse eventos.

**Causa:**
- o servidor lia só os 150 registros mais recentes e aplicava o filtro só neles;
- eventos de um módulo mais antigo ficavam fora dessa janela;
- a lista vinha ordenada pela chave, e não pela data.

**Agora** (`server/modules/audit/application/audit-log.ts`):
- o servidor lê em lotes de 300, do mais novo para o mais antigo, até completar a página;
- analisa no máximo 6.000 registros por consulta;
- se o limite for atingido sem completar a página, devolve `nextCursor`, e "Próxima" continua de onde parou;
- a resposta traz `scanned`, o número de registros analisados;
- a tela mostra, por exemplo, "3 evento(s) exibido(s) · 900 registro(s) analisado(s)" ou "Nenhum evento nos 6000 registros mais recentes analisados. Toque em Próxima para continuar procurando.";
- o resultado é ordenado pela data do evento, do mais novo para o mais antigo.

Testes: `test/audit-log-query.test.js` e `test/engineering-web.test.js`.

## Calendário e avisos

| Problema | Correção |
|---|---|
| A tela de Avisos lia os compromissos de uma cópia antiga e parada da agenda | Lê do calendário novo (`erpCalendarUpcoming`), que é atualizado em tempo real |
| O número no menu "Avisos" podia ser somado duas vezes | Um único contador, calculado pelo calendário novo |
| O quadro antigo "Meus serviços (agenda)" aparecia junto com o novo | Não aparece mais quando o calendário novo está ativo |
| Nome de funcionário com HTML era interpretado pela tela | Os nomes são mostrados como texto |
| Concluir um compromisso não atualizava a tela de Avisos | A tela e o contador são atualizados na hora |
| A cópia das tarefas antigas para o calendário podia rodar para qualquer usuário | Só roda para administradores e grava pelo `Phase1Store` |
| O aviso de capacitações era redesenhado mesmo sem nada para mostrar | Só mexe na tela quando há aviso |

Os Avisos mostram os compromissos **do próprio usuário**, de hoje e dos próximos dias. Não entram compromissos concluídos, vencidos, distantes ou de outra pessoa. Os vencidos continuam no calendário.

## Como testar em HML

1. Engenharia → Auditoria e logs: filtre por módulo `phase1`. Os eventos devem aparecer, e o texto acima da tabela mostra quantos registros foram analisados.
2. Calendário: crie um compromisso para hoje para o seu usuário. Em Avisos, ele aparece e o número no menu aumenta.
3. Conclua o compromisso. Ele some dos Avisos e o número diminui.
