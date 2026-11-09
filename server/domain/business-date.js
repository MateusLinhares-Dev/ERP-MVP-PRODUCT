// Data de negócio da empresa (America/Sao_Paulo). A Vercel executa em UTC:
// new Date().toISOString() gera o dia SEGUINTE entre 21h e 23h59 no Brasil.
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});

export function businessTodayISO(now=Date.now()){
  return formatter.format(new Date(now));
}
