const project=String(process.env.FIREBASE_PROJECT_ID||'');
const host=String(process.env.FIREBASE_EMULATOR_HOST||'127.0.0.1');
const port=Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT||9000);
if(!project.startsWith('demo-')||!['127.0.0.1','localhost'].includes(host)||!Number.isInteger(port)){
  console.error('[DIAGNOSTICO] Execução permitida SOMENTE no Firebase Emulator demo local.');
  process.exit(2);
}
const mode=process.argv[2];
async function read(node){
  const url=`http://${host}:${port}/erp/${encodeURIComponent(node)}.json?ns=${encodeURIComponent(project)}`;
  const res=await fetch(url);
  if(!res.ok)throw new Error(`Leitura RTDB /${node}: ${res.status}`);
  return res.json();
}
function rows(raw){return Array.isArray(raw)?raw.filter(Boolean):Object.values(raw||{}).filter(Boolean);}
try{
  if(mode==='banks'){
    const raw=await read('bancos');
    const list=rows(raw);
    const ids=Object.keys(raw||{});
    const byCod=new Map();
    list.forEach(b=>{const cod=String(b.cod||'?');byCod.set(cod,(byCod.get(cod)||0)+1);});
    console.log('[RTDB/erp/bancos] Registros físicos:',list.length);
    console.log('[RTDB/erp/bancos] Chaves:',ids.length);
    console.log('[RTDB/erp/bancos] Códigos repetidos:',[...byCod].filter(([,q])=>q>1));
    console.log('Compare estes totais com a tela Bancos. Nada foi modificado.');
  }else if(mode==='finance'){
    const cli=String(process.argv[3]||'').trim();
    if(!cli){console.error('Informe o nome exato do cliente entre aspas.');process.exit(2);}
    const keys=['adtCli','chequesCli','fcLanc','fcSaldoIni','contasReceber','vendas','chequesControle'];
    for(const key of keys){
      const value=await read(key);
      let found=0;
      if(['adtCli','chequesCli','fcLanc','fcSaldoIni'].includes(key)){
        const entry=value && typeof value==='object' ? value[cli] : null;
        found=Array.isArray(entry)?entry.filter(Boolean).length:(entry?1:0);
      }else if(key==='contasReceber'){
        found=rows(value).filter(v=>String(v.cli||'').trim()===cli).length;
      }else if(key==='vendas'){
        found=rows(value).filter(v=>String(v.cliente||'').trim()===cli).length;
      }else{
        found=rows(value).filter(v=>String(v.clienteNome||v.c||'').trim()===cli).length;
      }
      console.log(`RTDB/erp/${key}: ${found} registro(s) para o nome informado`);
    }
    console.log('Históricos legítimos sem cadastro podem existir. NÃO os exclua automaticamente.');
  }else{
    console.error('Uso: npm run diagnose:emulator -- banks | finance "NOME EXATO"');
    process.exitCode=2;
  }
}catch(e){console.error('[DIAGNOSTICO] Falha de leitura:',e.message);process.exitCode=1;}
