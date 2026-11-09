import {loadFirebaseCompat} from '/app/firebase-loader.js';
import {interpretarFala,normalizar} from '/rapido/parser.js';

const $=seletor=>document.querySelector(seletor);
const LIMITE_ARQUIVO=3*1024*1024;
const estado={auth:null,claims:{},opcoes:null,tipo:'compra',parte:null,itens:[],anexos:[],operationId:'',textoFalado:'',
  salvando:false,rascunho:{compra:null,venda:null}};

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const num=(v,casas=3)=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:casas});
const dataBR=iso=>iso?String(iso).split('-').reverse().join('/'):'';
const chave=v=>normalizar(v).toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
function lerNumero(texto){
  let s=String(texto??'').trim().replace(/\s/g,'').replace(/^R\$/i,'');
  if(!s)return null;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}
const paraCampo=n=>n==null||n===''?'':String(Math.round(Number(n)*10000)/10000).replace('.',',');
function novoId(){
  if(crypto.randomUUID)return crypto.randomUUID();
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
  const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
let avisoTimer=null;
function aviso(texto,tipo='',ms=4500){
  const el=$('#aviso');el.textContent=texto;el.className='aviso'+(tipo?' '+tipo:'');el.hidden=false;
  clearTimeout(avisoTimer);avisoTimer=setTimeout(()=>{el.hidden=true;},ms);
}

const TELAS=['tela-carregando','tela-bloqueado','tela-inicio','tela-lancamento','tela-conferir','tela-sucesso','tela-historico'];
function mostrar(id){
  $('#aviso').hidden=true;
  TELAS.forEach(t=>{const el=document.getElementById(t);if(el)el.hidden=t!==id;});
  window.scrollTo(0,0);
}
function irPara(tela,{substituir=false}={}){
  const id='tela-'+tela;
  if(substituir)history.replaceState({tela},'','#'+tela);else history.pushState({tela},'','#'+tela);
  mostrar(id);
  if(tela==='historico')carregarHistorico();
}
window.addEventListener('popstate',evento=>{
  const tela=evento.state?.tela||'inicio';
  if(estado.salvando){history.pushState({tela:'conferir'},'','#conferir');return;}
  if((tela==='lancamento'||tela==='conferir')&&(!estado.opcoes||estado.ultimoSalvo)){
    history.replaceState({tela:'inicio'},'','#inicio');mostrar('tela-inicio');return;
  }
  if(!$('#tela-lancamento').hidden&&tela!=='conferir')guardarRascunho();
  mostrar('tela-'+tela);
  if(tela==='historico')carregarHistorico();
});

function irParaLogin(){
  try{sessionStorage.removeItem('mm_sessao');}catch(e){}
  location.replace('/?destino=rapido');
}
async function sair(){
  try{await estado.auth?.signOut();}catch(e){}
  try{sessionStorage.removeItem('mm_sessao');sessionStorage.removeItem('erp_modo_completo');}catch(e){}
  location.replace('/');
}
function esperarUsuario(auth){
  return new Promise(resolve=>{
    if(auth.currentUser)return resolve(auth.currentUser);
    const parar=auth.onAuthStateChanged(u=>{parar();resolve(u||null);});
    setTimeout(()=>resolve(auth.currentUser||null),6000);
  });
}
const MENSAGENS={
  DATABASE_UNAVAILABLE:'A internet ou o banco oscilou. Toque em salvar de novo — não duplica.',
  SESSION_EXPIRED:'Sua sessão expirou. Entre de novo.',
  PURCHASE_IN_PROGRESS:'Outra operação deste fornecedor está em andamento. Aguarde alguns segundos e toque em salvar de novo.',
  QUICK_ENTRY_IN_PROGRESS:'Este lançamento já está sendo gravado. Aguarde e confira em "Meus lançamentos".',
  NETWORK_ERROR:'Sem conexão com a internet. Confira o sinal e tente de novo.'
};
async function api(caminho,{method='GET',body,repetir=true}={}){
  const usuario=estado.auth.currentUser;
  if(!usuario){irParaLogin();throw new Error('Sessão encerrada.');}
  const token=await usuario.getIdToken();
  let resposta;
  try{
    resposta=await fetch(caminho,{method,credentials:'same-origin',cache:'no-store',
      headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined});
  }catch(e){const erro=new Error(MENSAGENS.NETWORK_ERROR);erro.code='NETWORK_ERROR';throw erro;}
  const dados=await resposta.json().catch(()=>({}));
  if(resposta.status===401&&repetir){await usuario.getIdToken(true);return api(caminho,{method,body,repetir:false});}
  if(!resposta.ok){
    const erro=new Error(MENSAGENS[dados.code]||(resposta.status>=500?'O servidor não respondeu direito. Tente de novo em alguns segundos.':(dados.message||'Não foi possível concluir.')));
    erro.code=dados.code||'HTTP_'+resposta.status;erro.status=resposta.status;erro.retryAfterSeconds=dados.retryAfterSeconds;
    if(dados.code==='SESSION_EXPIRED')setTimeout(irParaLogin,2500);
    throw erro;
  }
  return dados;
}

async function iniciar(){
  try{
    const resposta=await fetch('/api/config',{credentials:'same-origin',cache:'no-store'});
    if(!resposta.ok)throw new Error('Configuração indisponível.');
    const config=await resposta.json();
    const {auth}=await loadFirebaseCompat(config);
    estado.auth=auth;
    const usuario=await esperarUsuario(auth);
    if(!usuario){irParaLogin();return;}
    $('#btn-sair').hidden=false;
    const token=await usuario.getIdTokenResult();
    estado.claims=token.claims||{};
    if(estado.claims.canQuickEntry!==true&&estado.claims.admin!==true){
      $('#msg-bloqueado').textContent='Seu usuário ainda não tem acesso ao Lançamento rápido. Peça para a administradora marcar "Lançamento rápido" no seu cadastro de usuário e entre de novo.';
      mostrar('tela-bloqueado');return;
    }
    $('#msg-carregando').textContent='Buscando fornecedores, clientes e materiais…';
    estado.opcoes=await api('/api/quick/options');
    const nome=String(estado.claims.erpUser||estado.opcoes.user?.login||'');
    const nomeExibido=nome?nome.charAt(0).toUpperCase()+nome.slice(1):'';
    $('#nome-usuario').textContent=nomeExibido;
    for(const id of ['#hdr-avatar','#bv-avatar']){$(id).textContent=(nomeExibido||'?').charAt(0);$(id).hidden=false;}
    const usaErp=estado.claims.admin===true||['canPurchasing','canSales','canFinance','canPayables','canAdvances'].some(c=>estado.claims[c]===true);
    $('#link-erp').hidden=!usaErp;
    const destino=(location.hash||'').replace('#','');
    history.replaceState({tela:'inicio'},'','#inicio');
    mostrar('tela-inicio');
    if(destino==='historico')irPara('historico');
  }catch(erro){
    console.error('[rapido] iniciar',erro);
    $('#msg-carregando').textContent=erro.message||'Não foi possível abrir. Verifique a internet.';
    const tentar=document.createElement('button');
    tentar.className='botao secundario';tentar.textContent='Tentar de novo';tentar.onclick=()=>location.reload();
    $('#tela-carregando').appendChild(tentar);
  }
}

function itemVazio(){return {material:'',kg:null,preco:null,voz:false,falado:''};}
function formularioTemConteudo(){
  return Boolean(estado.parte||estado.anexos.length||$('#texto-falado').value.trim()||estado.itens.some(i=>i.material||i.kg||i.preco));
}
function guardarRascunho(){
  if(!estado.opcoes)return;
  estado.rascunho[estado.tipo]={parte:estado.parte,itens:estado.itens,anexos:estado.anexos,operationId:estado.operationId,
    texto:$('#texto-falado').value,data:$('#data').value,vencimento:$('#vencimento').value,nf:$('#nf').value,obs:$('#observacao').value};
}
function abrirLancamento(tipo,{substituir=false}={}){
  if($('#tela-lancamento').hidden===false&&!estado.ultimoSalvo&&!substituir)guardarRascunho();
  estado.ultimoSalvo=false;
  estado.tipo=tipo;
  const r=estado.rascunho[tipo];
  estado.parte=r?.parte||null;
  estado.itens=r?.itens?.length?r.itens:[itemVazio()];
  estado.anexos=r?.anexos||[];
  estado.operationId=r?.operationId||novoId();
  const hoje=estado.opcoes.today;
  $('#texto-falado').value=r?.texto||'';
  $('#data').value=r?.data||hoje;
  $('#vencimento').value=r?.vencimento||hoje;
  $('#nf').value=r?.nf||'';
  $('#observacao').value=r?.obs||'';
  const compra=tipo==='compra';
  $('#titulo-lancamento').textContent=compra?'Nova compra':'Nova venda';
  $('#rotulo-parte').textContent=compra?'Fornecedor (de quem comprou)':'Cliente (para quem vendeu)';
  $('#rotulo-data').textContent=compra?'Data da compra':'Data da venda';
  $('#rotulo-venc').textContent=compra?'Vencimento (pagar até)':'Vencimento (receber até)';
  $('#campo-nf').hidden=compra;
  $('#dica-voz').textContent=compra
    ?'Exemplo: "Comprei 350 quilos de cobre mel do João a 42 reais."'
    :'Exemplo: "Vendi 2 toneladas de ferro para a Gerdau a 1 real e 20, vence dia 20."';
  $('#busca-parte').value='';$('#lista-parte').innerHTML='';
  const total=listaPartes().length;
  $('#busca-parte').placeholder=total?'Toque para ver a lista ou digite o nome ('+total+' cadastrados)'
    :'Nenhum '+(compra?'fornecedor':'cliente')+' encontrado no cadastro';
  $('#duvidas').hidden=true;
  for(const id of ['#data','#vencimento','#nf','#observacao'])$(id).classList.remove('preenchido-voz','erro-campo');
  renderParte();renderItens();renderAnexos();
  irPara('lancamento',{substituir});
}
function listaPartes(){return estado.tipo==='compra'?estado.opcoes.suppliers:estado.opcoes.customers;}
function definirParte(parte,{voz=false}={}){
  estado.parte=parte?{nome:parte.nome,cod:parte.cod||'',voz}:null;
  $('#busca-parte').value='';$('#lista-parte').innerHTML='';
  renderParte();renderItens();
}
function renderParte(){
  const el=$('#parte-escolhida');
  if(!estado.parte){el.hidden=true;$('#busca-parte').hidden=false;return;}
  el.hidden=false;$('#busca-parte').hidden=true;
  el.className='escolhido'+(estado.parte.voz?' preenchido-voz':'');
  el.innerHTML='<span>'+esc(estado.parte.nome)+'</span><button type="button" id="btn-trocar-parte">Trocar</button>';
  $('#btn-trocar-parte').onclick=()=>{estado.parte=null;renderParte();$('#busca-parte').focus();};
}
function buscarPartes(){
  const termo=chave($('#busca-parte').value);
  const alvo=$('#lista-parte');
  const partes=termo?termo.split(' '):[];
  const achados=listaPartes().filter(p=>{const n=chave(p.nome);return partes.every(t=>n.includes(t));}).slice(0,60);
  alvo.innerHTML=achados.length?achados.map((p,i)=>'<button type="button" class="opcao" data-parte="'+i+'">'+esc(p.nome)+'</button>').join('')
    :'<p class="dica">Nenhum '+(estado.tipo==='compra'?'fornecedor':'cliente')+' encontrado com esse nome. Cadastro novo é feito no escritório.</p>';
  alvo.querySelectorAll('[data-parte]').forEach(botao=>{botao.onclick=()=>definirParte(achados[Number(botao.dataset.parte)]);});
}
function precoTabela(material){
  if(!estado.parte||!material)return null;
  const tabelas=estado.tipo==='compra'?estado.opcoes.supplierPrices:estado.opcoes.customerPrices;
  const dono=estado.tipo==='compra'?estado.parte.cod:Object.keys(tabelas).find(k=>chave(k)===chave(estado.parte.nome));
  const tabela=dono?tabelas[dono]:null;
  if(!tabela)return null;
  const k=Object.keys(tabela).find(m=>chave(m)===chave(material));
  return k?tabela[k]:null;
}
function totalItem(item){return item.kg>0&&item.preco>0?Math.round(item.kg*item.preco*100)/100:0;}
function atualizarTotal(){
  const total=estado.itens.reduce((s,i)=>s+totalItem(i),0);
  $('#total').textContent=brl(total);
  return total;
}
function renderItens(){
  const opcoesMaterial=estado.opcoes.materials.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('');
  $('#itens').innerHTML=estado.itens.map((item,i)=>{
    const tabela=precoTabela(item.material);
    const marca=item.voz?' preenchido-voz':'';
    return '<div class="item" data-i="'+i+'">'+
      '<div class="item-topo"><span>Material '+(i+1)+'</span>'+(estado.itens.length>1?'<button type="button" data-remover="'+i+'">Tirar</button>':'')+'</div>'+
      '<select data-campo="material" class="'+(item.voz&&item.material?'preenchido-voz':'')+'" aria-label="Material '+(i+1)+'"><option value="">Escolha o material…</option>'+opcoesMaterial+'</select>'+
      (item.falado&&!item.material?'<div class="falado">Você falou: "'+esc(item.falado)+'" — escolha na lista acima.</div>':'')+
      '<div class="linha2">'+
        '<label><span>Peso (kg)</span><input data-campo="kg" inputmode="decimal" autocomplete="off" class="'+(item.voz&&item.kg!=null?marca.trim():'')+'" value="'+esc(paraCampo(item.kg))+'"></label>'+
        '<label><span>Preço por kg (R$)</span><input data-campo="preco" inputmode="decimal" autocomplete="off" class="'+(item.voz&&item.preco!=null?marca.trim():'')+'" value="'+esc(paraCampo(item.preco))+'"></label>'+
      '</div>'+
      (tabela&&!(item.preco>0)?'<button type="button" class="usar-tabela" data-tabela="'+i+'">Usar preço da tabela: '+brl(tabela)+' por kg</button>':'')+
      '<div class="subtotal" data-subtotal="'+i+'">'+(totalItem(item)?'= '+brl(totalItem(item)):'')+'</div>'+
    '</div>';
  }).join('');
  $('#itens').querySelectorAll('select[data-campo="material"]').forEach((sel,i)=>{sel.value=estado.itens[i].material||'';});
  atualizarTotal();
}
$('#itens').addEventListener('input',evento=>{
  const campo=evento.target.dataset.campo;const bloco=evento.target.closest('.item');
  if(!campo||!bloco)return;
  const i=Number(bloco.dataset.i),item=estado.itens[i];
  evento.target.classList.remove('preenchido-voz','erro-campo');
  if(campo==='kg')item.kg=lerNumero(evento.target.value);
  if(campo==='preco')item.preco=lerNumero(evento.target.value);
  const sub=bloco.querySelector('[data-subtotal]');
  if(sub)sub.textContent=totalItem(item)?'= '+brl(totalItem(item)):'';
  atualizarTotal();
});
$('#itens').addEventListener('change',evento=>{
  if(evento.target.dataset.campo!=='material')return;
  const i=Number(evento.target.closest('.item').dataset.i);
  estado.itens[i].material=evento.target.value;estado.itens[i].falado='';
  renderItens();
});
$('#itens').addEventListener('click',evento=>{
  const remover=evento.target.closest('[data-remover]');
  if(remover){estado.itens.splice(Number(remover.dataset.remover),1);if(!estado.itens.length)estado.itens.push(itemVazio());renderItens();return;}
  const tabela=evento.target.closest('[data-tabela]');
  if(tabela){const i=Number(tabela.dataset.tabela);estado.itens[i].preco=precoTabela(estado.itens[i].material);renderItens();}
});
$('#btn-add-item').onclick=()=>{estado.itens.push(itemVazio());renderItens();
  const blocos=document.querySelectorAll('#itens .item');blocos[blocos.length-1]?.scrollIntoView({behavior:'smooth',block:'center'});};
$('#busca-parte').addEventListener('input',buscarPartes);
$('#busca-parte').addEventListener('focus',buscarPartes);

const Reconhecimento=window.SpeechRecognition||window.webkitSpeechRecognition;
let reconhecedor=null,ouvindo=false;
function atualizarMicrofone(){
  $('#btn-falar').classList.toggle('ouvindo',ouvindo);
  $('#txt-falar').textContent=ouvindo?'Ouvindo… fale agora (toque para parar)':'Toque e fale';
}
function falar(){
  if(ouvindo){try{reconhecedor?.stop();}catch(e){}return;}
  if(!Reconhecimento){
    aviso('Este navegador não reconhece voz. Toque no campo de texto e use o microfone do teclado.','',7000);
    $('#texto-falado').focus();return;
  }
  const base=$('#texto-falado').value.trim();
  reconhecedor=new Reconhecimento();
  reconhecedor.lang='pt-BR';reconhecedor.interimResults=true;reconhecedor.continuous=false;reconhecedor.maxAlternatives=1;
  let ouviuAlgo=false;
  reconhecedor.onresult=evento=>{
    let texto='';
    for(let i=0;i<evento.results.length;i++)texto+=evento.results[i][0].transcript;
    ouviuAlgo=Boolean(texto.trim());
    $('#texto-falado').value=(base?base+' ':'')+texto.trim();
  };
  reconhecedor.onerror=evento=>{
    const mapa={'not-allowed':'O microfone está bloqueado. Toque no cadeado ao lado do endereço do site e permita o microfone.',
      'service-not-allowed':'O microfone está bloqueado. Permita o microfone nas configurações do navegador.',
      'no-speech':'Não ouvi nada. Toque e fale de novo, perto do celular.',
      'audio-capture':'Não encontrei o microfone do celular.',
      'network':'Sem internet para reconhecer a voz. Use o microfone do teclado.'};
    if(evento.error!=='aborted')aviso(mapa[evento.error]||'Não consegui ouvir. Tente de novo.','erro',6000);
  };
  reconhecedor.onend=()=>{
    ouvindo=false;atualizarMicrofone();
    if(ouviuAlgo)entender();
  };
  try{reconhecedor.start();ouvindo=true;atualizarMicrofone();}
  catch(e){ouvindo=false;atualizarMicrofone();aviso('Não consegui ligar o microfone. Tente de novo.','erro');}
}
$('#btn-falar').onclick=falar;

async function interpretar(texto){
  if(estado.opcoes.aiEnabled){
    try{return await api('/api/quick/interpret',{method:'POST',body:{texto,tipo:estado.tipo}});}
    catch(erro){console.warn('[rapido] IA indisponível, usando interpretador do aparelho',erro);}
  }
  return interpretarFala(texto,{materiais:estado.opcoes.materials,fornecedores:estado.opcoes.suppliers,
    clientes:estado.opcoes.customers,tipo:estado.tipo,hoje:estado.opcoes.today});
}
async function entender(){
  const texto=$('#texto-falado').value.trim();
  if(!texto){aviso('Fale ou escreva o lançamento primeiro.');return;}
  const botao=$('#btn-entender');botao.disabled=true;botao.lastChild.textContent='Entendendo…';
  try{
    let resultado=await interpretar(texto);
    const falado=resultado.tipoFalado||(resultado.fonte==='ia'?resultado.tipo:'');
    let trocou='';
    if((falado==='compra'||falado==='venda')&&falado!==estado.tipo){
      guardarRascunho();
      estado.rascunho[falado]=null;
      abrirLancamento(falado,{substituir:true});
      $('#texto-falado').value=texto;
      resultado=await interpretar(texto);
      trocou=falado;
    }
    aplicarInterpretacao(resultado,trocou);
  }finally{botao.disabled=false;botao.lastChild.textContent='Preencher com o que eu falei';}
}
$('#btn-entender').onclick=entender;

function aplicarInterpretacao(r,trocou=''){
  estado.textoFalado=$('#texto-falado').value.trim();
  const duvidas=(r.duvidas||[]).filter(d=>!/^Você falou em (compra|venda), mas está na tela/.test(d));
  if(r.parte){
    const parte=listaPartes().find(p=>chave(p.nome)===chave(r.parte.nome));
    if(parte)definirParte(parte,{voz:true});
  }else if(!estado.parte){
    duvidas.unshift('Não entendi '+(estado.tipo==='compra'?'o fornecedor':'o cliente')+'. Procure pelo nome abaixo.');
  }
  const itens=(r.itens||[]).filter(it=>it.material||it.materialFalado||it.quantidadeKg||it.precoKg);
  if(itens.length){
    estado.itens=itens.map(it=>({material:it.material||'',kg:it.quantidadeKg??null,preco:it.precoKg??null,voz:true,falado:it.material?'':(it.materialFalado||'')}));
  }else{
    if(estado.itens.every(i=>i.voz||(!i.material&&!i.kg&&!i.preco)))estado.itens=[itemVazio()];
    duvidas.push('Não entendi o material e o peso. Fale o nome do material como está no cadastro, ou escolha abaixo.');
  }
  if(!r.parte&&!itens.length)duvidas.push('Dica: fale o material, o peso, o preço e o nome. Exemplo: "'+
    (estado.tipo==='compra'?'Comprei 100 quilos de '+(estado.opcoes.materials[0]||'cobre')+' do '+(estado.opcoes.suppliers[0]?.nome||'fornecedor')+' a 40 reais':
      'Vendi 1 tonelada de '+(estado.opcoes.materials[0]||'ferro')+' para '+(estado.opcoes.customers[0]?.nome||'o cliente')+' a 2 reais')+'".');
  if(r.data){$('#data').value=r.data;$('#data').classList.add('preenchido-voz');}
  if(r.vencimento){$('#vencimento').value=r.vencimento;$('#vencimento').classList.add('preenchido-voz');}
  if(r.nf&&estado.tipo==='venda'){$('#nf').value=r.nf;$('#nf').classList.add('preenchido-voz');}
  if(r.observacao){$('#observacao').value=r.observacao;$('#observacao').classList.add('preenchido-voz');}
  renderItens();
  renderDuvidas(duvidas,'');
  if(trocou)aviso('Você falou em '+trocou+': mudei para '+(trocou==='compra'?'COMPRA':'VENDA')+'. Confira os campos em amarelo.','ok',6000);
  else aviso(itens.length||r.parte?'Pronto! Confira os campos em amarelo.':'Não consegui entender. Veja as dicas no quadro amarelo.',itens.length||r.parte?'ok':'erro');
}
function renderDuvidas(duvidas,outroTipo){
  const caixa=$('#duvidas');
  if(!duvidas.length&&!outroTipo){caixa.hidden=true;return;}
  caixa.hidden=false;
  caixa.innerHTML='<strong>Confira:</strong><ul>'+duvidas.map(d=>'<li>'+esc(d)+'</li>').join('')+'</ul>'+
    (outroTipo?'<button type="button" class="botao secundario" id="btn-trocar-tipo">Isto é uma '+(outroTipo==='venda'?'VENDA':'COMPRA')+' — mudar</button>':'');
  if(outroTipo)$('#btn-trocar-tipo').onclick=()=>{
    const texto=$('#texto-falado').value;
    estado.rascunho[outroTipo]=null;abrirLancamento(outroTipo);
    $('#texto-falado').value=texto;entender();
  };
}

function lerImagem(arquivo){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(arquivo);const img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Não consegui abrir esta foto. Tente tirar de novo.'));};
    img.src=url;
  });
}
async function prepararArquivo(arquivo){
  if(arquivo.type==='application/pdf'||/\.pdf$/i.test(arquivo.name)){
    if(arquivo.size>LIMITE_ARQUIVO)throw new Error('O PDF "'+arquivo.name+'" passa de 3 MB.');
    return {nome:arquivo.name,tipo:'application/pdf',blob:arquivo};
  }
  if(!String(arquivo.type).startsWith('image/'))throw new Error('Envie foto ou PDF.');
  const img=await lerImagem(arquivo);
  const escala=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(img.naturalWidth*escala);canvas.height=Math.round(img.naturalHeight*escala);
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
  if(!blob)throw new Error('Não consegui preparar a foto.');
  if(blob.size>LIMITE_ARQUIVO)throw new Error('A foto ficou grande demais.');
  return {nome:(arquivo.name||'foto').replace(/\.[^.]+$/,'')+'.jpg',tipo:'image/jpeg',blob};
}
async function paraBase64(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let binario='';
  for(let i=0;i<bytes.length;i+=0x8000)binario+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
  return btoa(binario);
}
async function anexar(arquivos){
  for(const arquivo of arquivos){
    if(estado.anexos.length>=(estado.opcoes.limits?.attachments||8)){aviso('Máximo de 8 anexos por lançamento.','erro');break;}
    const item={local:novoId(),nome:arquivo.name||'arquivo',status:'Preparando…',previa:''};
    estado.anexos.push(item);renderAnexos();
    try{
      const pronto=await prepararArquivo(arquivo);
      if(pronto.tipo.startsWith('image/'))item.previa=URL.createObjectURL(pronto.blob);
      item.nome=pronto.nome;item.status='Enviando…';renderAnexos();
      const r=await api('/api/quick/attachment',{method:'POST',body:{nome:pronto.nome,tipo:pronto.tipo,conteudo:await paraBase64(pronto.blob)}});
      Object.assign(item,r.anexo,{status:'Enviado'});
    }catch(erro){
      item.status='Falhou: '+(erro.message||'erro');item.falhou=true;
    }
    renderAnexos();
  }
}
function renderAnexos(){
  $('#lista-anexos').innerHTML=estado.anexos.map((a,i)=>'<li>'+(a.previa?'<img src="'+esc(a.previa)+'" alt="">':'<span class="tipo-arquivo" aria-hidden="true">PDF</span>')+
    '<span class="nome">'+esc(a.nome)+'<br><span class="status">'+esc(a.status||'')+'</span></span>'+
    '<button type="button" data-tirar-anexo="'+i+'" aria-label="Tirar anexo">Tirar</button></li>').join('');
}
$('#lista-anexos').addEventListener('click',evento=>{
  const botao=evento.target.closest('[data-tirar-anexo]');
  if(botao){estado.anexos.splice(Number(botao.dataset.tirarAnexo),1);renderAnexos();}
});
for(const id of ['#arq-camera','#arq-galeria']){
  $(id).addEventListener('change',evento=>{const arquivos=[...evento.target.files];evento.target.value='';if(arquivos.length)anexar(arquivos);});
}

function validar(){
  const problemas=[];
  document.querySelectorAll('.erro-campo').forEach(el=>el.classList.remove('erro-campo'));
  if(!estado.parte){problemas.push('Escolha '+(estado.tipo==='compra'?'o fornecedor':'o cliente')+'.');$('#busca-parte').classList.add('erro-campo');}
  const blocos=document.querySelectorAll('#itens .item');
  estado.itens.forEach((item,i)=>{
    const b=blocos[i];
    if(!item.material){problemas.push('Escolha o material '+(i+1)+'.');b?.querySelector('select')?.classList.add('erro-campo');}
    if(!(item.kg>0)){problemas.push('Informe o peso do material '+(i+1)+'.');b?.querySelector('[data-campo="kg"]')?.classList.add('erro-campo');}
    if(!(item.preco>0)){problemas.push('Informe o preço por kg do material '+(i+1)+'.');b?.querySelector('[data-campo="preco"]')?.classList.add('erro-campo');}
  });
  const data=$('#data').value,venc=$('#vencimento').value;
  if(!data)problemas.push('Informe a data.');
  if(venc&&data&&venc<data)problemas.push('O vencimento não pode ser antes da data.');
  if(estado.anexos.some(a=>!a.id&&!a.falhou))problemas.push('Aguarde terminar de enviar as fotos.');
  return problemas;
}
function conferir(){
  const problemas=validar();
  if(problemas.length){
    renderDuvidas(problemas,'');
    $('#duvidas').scrollIntoView({behavior:'smooth',block:'center'});
    aviso('Falta preencher algumas coisas.','erro');return;
  }
  const compra=estado.tipo==='compra';
  const total=atualizarTotal();
  const venc=$('#vencimento').value||$('#data').value;
  const anexos=estado.anexos.filter(a=>a.id);
  $('#resumo').innerHTML='<h2>'+(compra?'Compra de ':'Venda para ')+esc(estado.parte.nome)+'</h2>'+
    estado.itens.map(i=>'<div class="linha"><span>'+esc(i.material)+'<br><small>'+num(i.kg)+' kg × '+brl(i.preco)+'</small></span><strong>'+brl(totalItem(i))+'</strong></div>').join('')+
    '<div class="total-resumo">Total: '+brl(total)+'</div>'+
    '<div class="efeito">Data: <b>'+dataBR($('#data').value)+'</b><br>'+
      (compra?'Vai gerar <b>conta a pagar</b> de '+brl(total)+' com vencimento em <b>'+dataBR(venc)+'</b>.'
        :'Vai gerar <b>conta a receber</b> de '+brl(total)+' com vencimento em <b>'+dataBR(venc)+'</b>.'+($('#nf').value.trim()?'<br>Nota fiscal: '+esc($('#nf').value.trim()):''))+
      (anexos.length?'<br>Anexos: '+anexos.length:'')+
      ($('#observacao').value.trim()?'<br>Observação: '+esc($('#observacao').value.trim()):'')+'</div>';
  irPara('conferir');
}
$('#btn-conferir').onclick=conferir;
$('#btn-corrigir').onclick=()=>history.back();
$('#btn-voltar-corrigir').onclick=()=>history.back();

async function salvar(){
  if(estado.salvando)return;
  estado.salvando=true;
  const botao=$('#btn-salvar');botao.disabled=true;botao.lastChild.textContent='Salvando… não feche';
  const compra=estado.tipo==='compra';
  const corpo={operationId:estado.operationId,data:$('#data').value,vencimento:$('#vencimento').value||$('#data').value,
    observacao:$('#observacao').value.trim(),textoFalado:$('#texto-falado').value.trim(),
    itens:estado.itens.map(i=>({material:i.material,quantidadeKg:i.kg,precoKg:i.preco})),
    anexos:estado.anexos.filter(a=>a.id).map(a=>a.id)};
  if(compra)corpo.fornecedorCod=estado.parte.cod;else{corpo.cliente=estado.parte.nome;corpo.nf=$('#nf').value.trim();}
  try{
    let resultado=null;
    for(let tentativa=1;tentativa<=3&&!resultado;tentativa++){
      try{resultado=await api(compra?'/api/quick/purchase':'/api/quick/sale',{method:'POST',body:corpo});}
      catch(erro){
        const passageiro=['NETWORK_ERROR','DATABASE_UNAVAILABLE','QUICK_ENTRY_IN_PROGRESS','PURCHASE_IN_PROGRESS'].includes(erro.code)||erro.status>=502;
        if(!passageiro||tentativa===3)throw erro;
        botao.lastChild.textContent='A conexão oscilou, tentando de novo…';
        await new Promise(r=>setTimeout(r,Math.min(6,Math.max(2,Number(erro.retryAfterSeconds)||tentativa*2))*1000));
      }
    }
    const entrada=resultado.entry;
    estado.rascunho[estado.tipo]=null;
    estado.anexos.forEach(a=>{if(a.previa)URL.revokeObjectURL(a.previa);});
    $('#msg-sucesso').textContent=(compra?'Compra '+entrada.referencia:'Venda')+' lançada!';
    $('#msg-sucesso-detalhe').textContent=entrada.parte+' — '+brl(entrada.total)+(compra?' · conta a pagar gerada':' · conta a receber gerada');
    estado.operationId=novoId();
    estado.ultimoSalvo=true;estado.parte=null;estado.itens=[itemVazio()];estado.anexos=[];
    history.replaceState({tela:'sucesso'},'','#sucesso');mostrar('tela-sucesso');
  }catch(erro){
    aviso(erro.message||'Não foi possível salvar.','erro',9000);
  }finally{
    estado.salvando=false;botao.disabled=false;botao.lastChild.textContent='Está certo, SALVAR';
  }
}
$('#btn-salvar').onclick=salvar;
$('#btn-outro').onclick=()=>abrirLancamento(estado.tipo);

function classeSituacao(s){
  if(/^(Pago|Recebido|Permuta)$/.test(s))return 'ok';
  if(/Excluído/.test(s))return 'excluido';
  return 'aberto';
}
async function carregarHistorico(){
  const alvo=$('#lista-historico');
  alvo.innerHTML='<p class="dica">Carregando…</p>';
  try{
    const r=await api('/api/quick/history');
    $('#titulo-historico').textContent=r.viewAll?'Lançamentos pelo celular':'Meus lançamentos';
    if(!r.entries.length){alvo.innerHTML='<p class="dica">Nenhum lançamento ainda.</p>';return;}
    alvo.innerHTML=r.entries.map(e=>{
      const quando=new Date(Number(e.criadoEm)||0);
      return '<article class="historico-item">'+
        '<div class="cab"><span>'+(e.tipo==='compra'?'Compra '+esc(e.referencia):'Venda')+'</span><span>'+brl(e.total)+'</span></div>'+
        '<div class="meta">'+esc(e.parte)+' · '+dataBR(e.data)+(r.viewAll&&e.criadoPor?' · por '+esc(e.criadoPor):'')+'</div>'+
        '<span class="situacao '+classeSituacao(e.situacao)+'">'+esc(e.situacao)+'</span>'+
        '<details><summary>Ver detalhes</summary>'+
          (e.itens||[]).map(i=>'<div>'+esc(i.material)+': '+num(i.quantidadeKg)+' kg × '+brl(i.precoKg)+' = '+brl(i.total)+'</div>').join('')+
          '<div class="meta">Vencimento: '+dataBR(e.vencimento)+(e.nf?' · NF '+esc(e.nf):'')+' · lançado em '+quando.toLocaleString('pt-BR')+'</div>'+
          (e.observacao?'<div class="meta">Observação: '+esc(e.observacao)+'</div>':'')+
          (e.textoFalado?'<div class="meta">Falado: "'+esc(e.textoFalado)+'"</div>':'')+
          (e.anexos||[]).map(a=>'<button type="button" class="anexo-link" data-dono="'+esc(a.dono)+'" data-id="'+esc(a.id)+'" data-tipo="'+esc(a.tipo)+'" data-nome="'+esc(a.nome)+'">'+(a.tipo==='application/pdf'?'PDF · ':'Foto · ')+esc(a.nome)+'</button>').join('')+
        '</details></article>';
    }).join('');
  }catch(erro){alvo.innerHTML='<p class="dica">'+esc(erro.message)+'</p>';}
}
$('#lista-historico').addEventListener('click',async evento=>{
  const botao=evento.target.closest('.anexo-link');
  if(!botao)return;
  botao.disabled=true;
  try{
    const token=await estado.auth.currentUser.getIdToken();
    const resposta=await fetch('/api/quick/attachment?dono='+encodeURIComponent(botao.dataset.dono)+'&id='+encodeURIComponent(botao.dataset.id),
      {credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token}});
    if(!resposta.ok)throw new Error('Não consegui abrir o anexo.');
    const url=URL.createObjectURL(await resposta.blob());
    if(botao.dataset.tipo.startsWith('image/')){$('#img-visualizador').src=url;$('#visualizador').hidden=false;}
    else{const a=document.createElement('a');a.href=url;a.download=botao.dataset.nome||'anexo.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  }catch(erro){aviso(erro.message,'erro');}
  finally{botao.disabled=false;}
});
$('#btn-fechar-visualizador').onclick=()=>{const img=$('#img-visualizador');if(img.src.startsWith('blob:'))URL.revokeObjectURL(img.src);img.removeAttribute('src');$('#visualizador').hidden=true;};

document.addEventListener('click',evento=>{
  const novo=evento.target.closest('[data-novo]');
  if(novo){abrirLancamento(novo.dataset.novo);return;}
  const ir=evento.target.closest('[data-ir]');
  if(ir){
    if(ir.dataset.ir==='inicio'&&!$('#tela-lancamento').hidden&&!estado.ultimoSalvo)guardarRascunho();
    irPara(ir.dataset.ir);
  }
});
for(const id of ['#data','#vencimento','#nf','#observacao'])$(id).addEventListener('input',evento=>evento.target.classList.remove('preenchido-voz','erro-campo'));
$('#btn-sair').onclick=sair;
$('#btn-bloqueado-sair').onclick=sair;
window.addEventListener('beforeunload',evento=>{
  if(estado.salvando||(!$('#tela-lancamento').hidden&&!estado.ultimoSalvo&&formularioTemConteudo())){evento.preventDefault();evento.returnValue='';}
});

iniciar();
