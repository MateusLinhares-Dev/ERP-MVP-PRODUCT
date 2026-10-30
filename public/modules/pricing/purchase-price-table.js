(function(global){
'use strict';

const IMAGE_WIDTH=430;
const BOX_PADDING='16px 18px';

function number(value){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:0;
}

function formatMoney(value){
  return number(value).toLocaleString('pt-BR',{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  });
}

function escapeHtml(value){
  return String(value==null?'':value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function activeSupplier(){
  const code=document.getElementById('pf-forn-sel')?.value||'';
  if(!code)return null;
  let supplier=null;
  try{supplier=(FORNECEDORES||[]).find(item=>item&&item.cod===code)||null;}catch(error){}
  return {code,name:supplier?.nome||code};
}

function activePrices(code){
  let data={};
  try{data=(PRECOS_FORN_DATA&&PRECOS_FORN_DATA[code])||{};}catch(error){}
  return Object.entries(data)
    .filter(([material,value])=>material!=='_datas'&&number(value)>0)
    .map(([material,value])=>({material,value:number(value)}));
}

function renderCompactImage(box,supplier,items){
  const date=new Date().toLocaleDateString('pt-BR');
  box.style.display='block';
  box.style.width=`${IMAGE_WIDTH}px`;
  box.style.padding=BOX_PADDING;
  box.style.boxSizing='border-box';
  box.style.background='#fff';
  box.style.fontFamily='Arial, sans-serif';
  box.style.color='#222';
  box.innerHTML=`
    <div style="margin-bottom:8px;border-bottom:2px solid #1a3a2a;padding-bottom:7px">
      <div style="font-size:14px;font-weight:900;color:#1a3a2a;line-height:1.15">🏷️ TABELA DE PREÇOS DE COMPRA</div>
      <div style="font-size:10.5px;color:#444;margin-top:3px;line-height:1.2">Fornecedor: <b>${escapeHtml(supplier.name)}</b> · Emitida em: ${date}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;line-height:1.1">
      <colgroup><col style="width:66%"><col style="width:34%"></colgroup>
      <thead>
        <tr style="background:#1a3a2a;color:#fff">
          <th style="padding:5px 8px;text-align:left;font-weight:900">Material</th>
          <th style="padding:5px 8px;text-align:left;font-weight:900">Preço R$/kg</th>
        </tr>
      </thead>
      <tbody>${items.map((item,index)=>`
        <tr style="background:${index%2===0?'#f7f8f7':'#fff'}">
          <td style="padding:4px 8px;border-bottom:1px solid #e7ebe8;font-weight:800;vertical-align:middle">${escapeHtml(item.material)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #e7ebe8;text-align:left;font-weight:900;color:#1a3a2a;vertical-align:middle;white-space:nowrap">R$ ${formatMoney(item.value)}/kg</td>
        </tr>`).join('')}</tbody>
    </table>
    <div style="margin-top:7px;font-size:9.5px;color:#777;text-align:center;line-height:1.15">
      <i>Preços sujeitos a alteração sem aviso prévio.</i>
    </div>`;
}

function downloadOrShare(canvas,supplier,button,box){
  canvas.toBlob(async(blob)=>{
    try{
      if(!blob)throw new Error('Não foi possível gerar a imagem.');
      const filename=`precos-${supplier.name.replace(/[^a-zA-Z0-9]/g,'-').toLowerCase()}.png`;
      const file=new File([blob],filename,{type:'image/png'});
      if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
        try{await navigator.share({files:[file],title:`Tabela de Preços – ${supplier.name}`});}catch(error){}
      }else{
        const url=URL.createObjectURL(blob);
        const link=document.createElement('a');
        link.href=url;
        link.download=filename;
        link.click();
        URL.revokeObjectURL(url);
        global.alert('✅ Imagem salva! Envie o arquivo via WhatsApp.');
      }
    }finally{
      box.style.display='none';
      button.innerHTML='📷 Imagem WhatsApp';
      button.disabled=false;
    }
  },'image/png');
}

async function sharePurchasePriceImage(){
  const supplier=activeSupplier();
  if(!supplier){global.alert('Selecione um fornecedor primeiro.');return;}
  const items=activePrices(supplier.code);
  if(!items.length){global.alert('Nenhum preço definido para este fornecedor.');return;}
  const box=document.getElementById('pf-img-box');
  const button=document.getElementById('pf-img-btn');
  if(!box||!button){global.alert('Área de geração da tabela não encontrada.');return;}
  if(typeof global.html2canvas!=='function'){global.alert('Gerador de imagem indisponível. Recarregue a página e tente novamente.');return;}

  renderCompactImage(box,supplier,items);
  button.textContent='⏳ Gerando...';
  button.disabled=true;

  try{
    const canvas=await global.html2canvas(box,{
      scale:2,
      useCORS:true,
      backgroundColor:'#ffffff',
      logging:false,
      width:IMAGE_WIDTH,
      windowWidth:IMAGE_WIDTH
    });
    downloadOrShare(canvas,supplier,button,box);
  }catch(error){
    box.style.display='none';
    button.innerHTML='📷 Imagem WhatsApp';
    button.disabled=false;
    global.alert(`Erro ao gerar imagem: ${error.message}`);
  }
}

global.compartilharImagemPrecosForn=sharePurchasePriceImage;
global.PurchasePriceTable=Object.freeze({
  shareImage:sharePurchasePriceImage,
  imageWidth:IMAGE_WIDTH
});
})(window);
