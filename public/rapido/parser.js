
export function normalizar(texto){
  return String(texto??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
}
const chave=texto=>normalizar(texto).toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();

const UNIDADES={zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,
  catorze:14,quatorze:14,quinze:15,dezesseis:16,dezasseis:16,dezessete:17,dezoito:18,dezenove:19};
const DEZENAS={vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90};
const CENTENAS={cem:100,cento:100,duzentos:200,duzentas:200,trezentos:300,trezentas:300,quatrocentos:400,quatrocentas:400,
  quinhentos:500,quinhentas:500,seiscentos:600,seiscentas:600,setecentos:700,setecentas:700,oitocentos:800,oitocentas:800,
  novecentos:900,novecentas:900};
function valorPalavra(p){
  if(p in UNIDADES)return {v:UNIDADES[p],ordem:p in {dez:1,onze:1,doze:1,treze:1,catorze:1,quatorze:1,quinze:1,dezesseis:1,dezasseis:1,dezessete:1,dezoito:1,dezenove:1}?2:1};
  if(p in DEZENAS)return {v:DEZENAS[p],ordem:2};
  if(p in CENTENAS)return {v:CENTENAS[p],ordem:3};
  return null;
}

export function palavrasParaNumeros(texto){
  const tokens=normalizar(texto).replace(/(\d)\s*kg\b/g,'$1 kg').split(/\s+/).filter(Boolean);
  const saida=[];
  let i=0;
  while(i<tokens.length){
    const inicio=valorPalavra(tokens[i]);
    const ehMil=tokens[i]==='mil';
    if(!inicio&&!ehMil){saida.push(tokens[i]);i++;continue;}
    let total=0,grupo=0,ultimaOrdem=99,j=i,consumido=i;
    while(j<tokens.length){
      const t=tokens[j];
      if(t==='mil'){total+=(grupo||1)*1000;grupo=0;ultimaOrdem=99;j++;consumido=j;continue;}
      if(/^(milhao|milhoes)$/.test(t)){total=(total+(grupo||1))*1000000;grupo=0;ultimaOrdem=99;j++;consumido=j;continue;}
      const w=valorPalavra(t);
      if(w&&w.ordem<ultimaOrdem){grupo+=w.v;ultimaOrdem=w.ordem;j++;consumido=j;continue;}
      if(t==='e'&&j+1<tokens.length){
        const prox=valorPalavra(tokens[j+1]);
        if(prox&&prox.ordem<ultimaOrdem){j++;continue;}
      }
      break;
    }
    saida.push(String(total+grupo));
    i=consumido;
  }
  return saida.join(' ');
}

function numeroBR(token){
  let s=String(token).replace(/^r\$/,'');
  if(!/^\d[\d.,]*$/.test(s))return null;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}

const PALAVRAS_VAZIAS=new Set(['DE','DA','DO','DAS','DOS','E','A','O','AS','OS','EM','NO','NA','PARA','PRA','PRO','COM',
  'LTDA','ME','EPP','EIRELI','SA','S','COMERCIO','COMERCIAL','INDUSTRIA','METAIS','METAL','SUCATA','SUCATAS','RECICLAGEM','RECICLAVEIS']);

export function parecido(a,b){
  if(a===b)return true;
  if(a.length<5||b.length<5||Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,erros=0;
  while(i<a.length&&j<b.length){
    if(a[i]===b[j]){i++;j++;continue;}
    if(++erros>1)return false;
    if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}
  }
  return erros+(a.length-i)+(b.length-j)<=1;
}
function encontrarParte(tokens,partes,palavrasMaterial){
  const presentes=[...new Set(tokens.map(t=>chave(t)).filter(Boolean))];
  const temPalavra=t=>presentes.some(p=>parecido(p,t));
  let melhores=[],melhor=0;
  for(const parte of partes){
    const nomeTokens=chave(parte.nome).split(' ').filter(t=>t.length>=3&&!PALAVRAS_VAZIAS.has(t)&&!palavrasMaterial.has(t));
    if(!nomeTokens.length)continue;
    const acertos=nomeTokens.filter(temPalavra).length;
    if(!acertos)continue;
    const nota=acertos+(acertos===nomeTokens.length?0.5:0);
    if(nota>melhor){melhor=nota;melhores=[parte];}
    else if(nota===melhor)melhores.push(parte);
  }
  return melhores;
}

function indiceMateriais(materiais){
  return materiais.map(nome=>({nome,tokens:chave(nome).split(' ').filter(Boolean)})).filter(m=>m.tokens.length);
}

function mencoesMaterial(tokens,indice,ignorar=new Set()){
  const T=tokens.map(t=>t.toUpperCase());
  const mencoes=[];
  for(let i=0;i<T.length;){
    if(ignorar.has(i)){i++;continue;}
    let achou=null;
    for(const m of indice){
      if(m.tokens.length&&m.tokens.every((tok,k)=>T[i+k]===tok&&!ignorar.has(i+k))&&(!achou||m.tokens.length>achou.tokens.length))achou=m;
    }
    if(achou){mencoes.push({pos:i,fim:i+achou.tokens.length,material:achou.nome,falado:tokens.slice(i,i+achou.tokens.length).join(' '),candidatos:[achou.nome]});i+=achou.tokens.length;continue;}
    if(T[i].length>=3&&!PALAVRAS_VAZIAS.has(T[i])){
      const candidatos=indice.filter(m=>m.tokens[0]===T[i]).map(m=>m.nome);
      if(candidatos.length){
        const exato=candidatos.find(nome=>chave(nome)===T[i]);
        mencoes.push({pos:i,fim:i+1,material:exato||(candidatos.length===1?candidatos[0]:null),falado:tokens[i],candidatos});
      }
    }
    i++;
  }
  return mencoes;
}

const UNIDADE_KG=/^(kg|kgs|quilo|quilos|kilo|kilos|quilograma|quilogramas)$/;
const UNIDADE_T=/^(t|ton|tonelada|toneladas)$/;
const MARCA_UNITARIO=/^(a|preco)$/;
const MARCA_TOTAL=/^(por|valor|total|deu|pago|paguei|cobrei|custou|ficou|fica|vale)$/;
const MOEDA=/^(real|reais|r\$)$/;

function lerFatos(tokens,ignorar=new Set()){
  const fatos=[];
  for(let i=0;i<tokens.length;i++){
    if(ignorar.has(i))continue;
    let n=numeroBR(tokens[i]);
    if(tokens[i]==='meia'&&UNIDADE_T.test(tokens[i+1]||'')){fatos.push({pos:i,fim:i+2,tipo:'qtd',valor:500});i++;continue;}
    if(n==null)continue;
    let fim=i+1;
    const antes=tokens[i-1]||'',depois=tokens[i+1]||'';
    const centavosApos=(k)=>tokens[k]==='e'&&/^\d{1,2}$/.test(tokens[k+1]||'')&&!UNIDADE_KG.test(tokens[k+2]||'')&&!UNIDADE_T.test(tokens[k+2]||'');
    if(UNIDADE_KG.test(depois)){fatos.push({pos:i,fim:i+2,tipo:'qtd',valor:n});i++;continue;}
    if(UNIDADE_T.test(depois)){fatos.push({pos:i,fim:i+2,tipo:'qtd',valor:n*1000});i++;continue;}
    let m=i-1;
    while(m>=0&&/^(r\$|de)$/.test(tokens[m]))m--;
    const marca=tokens[m]||'';
    const marcaTotal=MARCA_TOTAL.test(marca);
    let preco=marcaTotal||MARCA_UNITARIO.test(marca)||antes==='r$'||tokens[i].startsWith('r$');
    if(MOEDA.test(depois)){preco=true;fim=i+2;}
    if(preco){
      if(centavosApos(fim)){n=n+Number(tokens[fim+1])/(tokens[fim+1].length===1?10:100);fim+=2;if(tokens[fim]==='centavos')fim++;}
      let unidade='';
      for(let k=fim;k<Math.min(tokens.length,fim+3);k++){
        if(UNIDADE_T.test(tokens[k])){unidade='t';fim=k+1;break;}
        if(UNIDADE_KG.test(tokens[k])){unidade='kg';fim=k+1;break;}
        if(!/^(o|a|por|cada|de|do|da)$/.test(tokens[k]))break;
      }
      const total=marcaTotal&&!unidade;
      fatos.push({pos:i,fim,tipo:'preco',valor:unidade==='t'?n/1000:n,porTonelada:unidade==='t',total});
      i=fim-1;continue;
    }
    fatos.push({pos:i,fim,tipo:'numero',valor:n});
  }
  return fatos;
}

function posicoesIgnoradas(tokens,parte){
  const ignorar=new Set();
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i],prox=tokens[i+1]||'';
    if(t==='dia'&&/^\d{1,2}$/.test(prox)){ignorar.add(i);ignorar.add(i+1);}
    if(/^\d{1,3}$/.test(t)&&/^dias?$/.test(prox)){ignorar.add(i);ignorar.add(i+1);}
    if(/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(t))ignorar.add(i);
    if(t==='placa'&&prox){ignorar.add(i+1);}
    if(t==='nota'){
      let k=i+1;
      while(['fiscal','numero','n','no','nf'].includes(tokens[k]))k++;
      if(/^\d{1,10}$/.test(tokens[k]||'')){for(let x=i;x<=k;x++)ignorar.add(x);}
    }
  }
  if(parte){
    const nome=chave(parte.nome).split(' ').filter(Boolean);
    const T=tokens.map(t=>t.toUpperCase());
    for(let i=0;i+nome.length<=T.length;i++){
      if(nome.length>1&&nome.every((tok,k)=>T[i+k]===tok))for(let k=0;k<nome.length;k++)ignorar.add(i+k);
    }
  }
  return ignorar;
}

function hojeMais(hojeISO,dias){
  const d=new Date(hojeISO+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+dias);return d.toISOString().slice(0,10);
}
function diaDoMes(hojeISO,dia){
  const [a,m]=hojeISO.split('-').map(Number);
  const d=new Date(Date.UTC(a,m-1,dia,12));
  return d.getUTCMonth()===m-1?d.toISOString().slice(0,10):null;
}

const fmt=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:4});

export function interpretarFala(texto,{materiais=[],fornecedores=[],clientes=[],tipo='',hoje}={}){
  const original=String(texto||'').trim();
  const duvidas=[];
  const base=normalizar(original)
    .replace(/r\$\s*/g,'r$ ')
    .replace(/(\d)\s*(kg|t)\b/g,'$1 $2')
    .replace(/[;:!?()"]/g,' ')
    .replace(/(\D)[.,](\s|$)/g,'$1 $2')
    .replace(/,(\s)/g,' $1');
  const tokens=palavrasParaNumeros(base).split(/\s+/).filter(Boolean).map(t=>t.replace(/^r\$(\d)/,'$1'));
  const tokensSemNumero=tokens.filter(t=>!/^\d/.test(t));

  let tipoDetectado='';
  const compra=/\b(compr\w*|peguei|pegamos|recebi|recebemos|entrou)\b/.test(base);
  const venda=/\b(vend\w*|entreguei|entregamos|saiu)\b/.test(base);
  if(compra&&!venda)tipoDetectado='compra';
  else if(venda&&!compra)tipoDetectado='venda';
  const tipoFinal=tipo==='compra'||tipo==='venda'?tipo:(tipoDetectado||'indefinido');
  if(tipo&&tipoDetectado&&tipo!==tipoDetectado)duvidas.push('Você falou em '+tipoDetectado+', mas está na tela de '+tipo+'. Confira.');

  const indice=indiceMateriais(materiais);
  const palavrasMaterial=new Set(indice.flatMap(m=>m.tokens));

  let parte=null;
  const lista=tipoFinal==='venda'?clientes:tipoFinal==='compra'?fornecedores:[];
  if(lista.length){
    const achados=encontrarParte(tokensSemNumero,lista,palavrasMaterial);
    if(achados.length===1)parte={nome:achados[0].nome,cod:achados[0].cod||''};
    else if(achados.length>1)duvidas.push('Qual '+(tipoFinal==='venda'?'cliente':'fornecedor')+'? '+achados.slice(0,5).map(p=>p.nome).join(' / ')+'.');
  }

  const ignorar=posicoesIgnoradas(tokens,parte);
  const mencoes=mencoesMaterial(tokens,indice,ignorar);
  const fatos=lerFatos(tokens,ignorar);
  const eventos=[...mencoes.map(m=>({...m,tipo:'material'})),...fatos].sort((a,b)=>a.pos-b.pos);
  const itens=[];
  let atual=null;
  const novo=()=>{atual={material:null,materialFalado:'',quantidadeKg:null,precoKg:null,_total:null,_semUnidade:false,_candidatos:[]};itens.push(atual);};
  for(const ev of eventos){
    if(ev.tipo==='material'){
      if(!atual||atual.material||atual.materialFalado)novo();
      atual.material=ev.material;atual.materialFalado=ev.falado;atual._candidatos=ev.candidatos;
    }else if(ev.tipo==='qtd'){
      if(!atual||atual.quantidadeKg!=null&&(atual.material||atual.materialFalado))novo();
      atual.quantidadeKg=ev.valor;
    }else if(ev.tipo==='preco'){
      if(!atual)novo();
      if(atual.precoKg!=null||atual._total!=null)novo();
      if(ev.total)atual._total=ev.valor;
      else atual.precoKg=ev.valor;
      if(ev.porTonelada)duvidas.push('Preço por tonelada convertido para R$ '+fmt(ev.valor)+' por kg.');
    }else{
      if(!atual)novo();
      if(atual.quantidadeKg==null){atual.quantidadeKg=ev.valor;atual._semUnidade=true;}
      else if(atual.precoKg==null)atual.precoKg=ev.valor;
      else{novo();atual.quantidadeKg=ev.valor;atual._semUnidade=true;}
    }
  }
  for(const it of itens){
    if(it._total==null)continue;
    if(it.quantidadeKg>0){
      it.precoKg=Math.round(it._total/it.quantidadeKg*10000)/10000;
      duvidas.push('Calculei R$ '+fmt(it.precoKg)+' por kg (total de R$ '+fmt(it._total)+' ÷ '+fmt(it.quantidadeKg)+' kg). Confira.');
    }else if(it.material||it.materialFalado){
      duvidas.push('Você disse o valor total de R$ '+fmt(it._total)+(it.material?' do '+it.material:'')+', mas não o peso. Informe o peso e o preço por kg.');
    }else{
      duvidas.push('Entendi o valor de R$ '+fmt(it._total)+', mas não qual material nem o peso.');
    }
  }
  const limpos=itens.filter(it=>it.material||it.materialFalado||it.quantidadeKg!=null).map(it=>{
    if(!it.material&&it._candidatos.length>1)duvidas.push('Qual material para "'+it.materialFalado+'"? '+it._candidatos.slice(0,6).join(' / ')+'.');
    else if(!it.material&&it.materialFalado)duvidas.push('Material "'+it.materialFalado+'" não encontrado no cadastro. Escolha na lista.');
    else if(!it.material)duvidas.push('Escolha o material da linha com '+(it.quantidadeKg!=null?fmt(it.quantidadeKg)+' kg':'o valor informado')+'.');
    if(it._semUnidade&&it.quantidadeKg!=null)duvidas.push('Considerei '+fmt(it.quantidadeKg)+' como quilos'+(it.materialFalado?' de '+it.materialFalado:'')+'. Confira.');
    if(it.precoKg==null&&(it.material||it.materialFalado))duvidas.push('Falta o preço por kg'+(it.material?' de '+it.material:'')+'.');
    return {material:it.material,materialFalado:it.materialFalado,quantidadeKg:it.quantidadeKg,precoKg:it.precoKg};
  });

  const ref=/^\d{4}-\d{2}-\d{2}$/.test(String(hoje||''))?hoje:null;
  let data=null,vencimento=null;
  if(ref){
    if(/\bontem\b/.test(base))data=hojeMais(ref,-1);
    const prazo=/\b(?:para|pra|em|com)\s+(\d{1,3})\s+dias\b/.exec(tokens.join(' '));
    if(prazo)vencimento=hojeMais(data||ref,Number(prazo[1]));
    const venceDia=/\b(?:vence|vencimento|pagar|pagamento)\b(?:\s+\w+){0,2}?\s+dia\s+(\d{1,2})\b/.exec(tokens.join(' '));
    if(!vencimento&&venceDia){
      vencimento=diaDoMes(ref,Number(venceDia[1]));
      if(vencimento&&vencimento<(data||ref)){const [a,m]=ref.split('-').map(Number);const prox=new Date(Date.UTC(a,m,Number(venceDia[1]),12));vencimento=prox.toISOString().slice(0,10);}
    }
    if(!vencimento&&/\b(?:vence|pagar|pagamento|vencimento)\s+amanha\b/.test(base))vencimento=hojeMais(ref,1);
  }
  const nf=/\bnota(?:\s+fiscal)?(?:\s+(?:numero|n|no))?\s+(\d{1,10})\b/.exec(tokens.join(' '));

  return {fonte:'aparelho',tipo:tipoFinal,tipoFalado:tipoDetectado,parte,itens:limpos,data,vencimento,nf:nf?nf[1]:null,observacao:null,duvidas:[...new Set(duvidas)]};
}
