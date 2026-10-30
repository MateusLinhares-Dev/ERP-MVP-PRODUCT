(function(global){
'use strict';
const original={
  loadSupplier:global.csCarregarForn,
  confirmPurchase:global.csConfirmarEntrada,
  detail:global.abrirDetalheCompra,
  tickets:global.renderTickets,
  receipt:global.imprimirCanhoto
};
function money(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function kg(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:3});}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function tickets(){try{return TICKETS_DB||{};}catch(e){return {};}}
function saveAll(){try{saveDB();}catch(e){} try{if(typeof saveContasPagar==='function')saveContasPagar();}catch(e){} }
function ticketFrom(ref){
  if(ref&&tickets()[ref])return [ref,tickets()[ref]];
  try{if(typeof _dcDbKey!=='undefined'&&_dcDbKey&&tickets()[_dcDbKey])return [_dcDbKey,tickets()[_dcDbKey]];}catch(e){}
  const input=document.getElementById('ticket-input');
  const key=String(input?.value||'').trim().toUpperCase();
  if(key&&tickets()[key])return [key,tickets()[key]];
  return null;
}
function itemGross(item){return Number(item?.pesoBruto!=null?item.pesoBruto:(item?.br!=null?item.br:(item?.pesoLiq||item?.lq||0)));}
function itemNet(item){return Number(item?.pesoLiqAjust!=null?item.pesoLiqAjust:(item?.pesoLiq!=null?item.pesoLiq:(item?.lq!=null?item.lq:itemGross(item))));}
function normalizeMaterial(base){return String(base||'').trim();}
try{global._matEfetivoEstoque=function(base){return normalizeMaterial(base);};}catch(e){}
function sourceItems(body){
  let arr=[];try{arr=JSON.parse(body?.dataset?.itensData||'[]');}catch(e){}
  const keys=(()=>{try{return JSON.parse(body?.dataset?.ticketKeys||'[]');}catch(e){return [];}})();
  const byMaterial={};
  keys.forEach(key=>{
    const t=tickets()[key];
    (t?.itens||[]).forEach(it=>{
      const name=normalizeMaterial(it.mat||it.matBase);
      if(!name)return;
      if(!byMaterial[name])byMaterial[name]={gross:0,notes:[]};
      byMaterial[name].gross+=itemGross(it);
      if(it.obs)byMaterial[name].notes.push(String(it.obs));
    });
    (t?.pesagensCompra||[]).forEach(it=>{
      const name=normalizeMaterial(it.material);
      if(!name)return;
      if(!byMaterial[name])byMaterial[name]={gross:0,notes:[]};
      byMaterial[name].gross+=Number(it.pesoLiquido||0);
    });
  });
  return arr.map(it=>{
    const name=normalizeMaterial(it.mat||it.matBase);
    return Object.assign({},it,{mat:name,matBase:name,ident:'',pesoBruto:Number(it.pesoBruto||byMaterial[name]?.gross||it.pesoLiq||0),obs:it.obs||byMaterial[name]?.notes?.join(' | ')||''});
  });
}
function enhancePurchaseForm(){
  const body=document.getElementById('cs-lanc-body');if(!body||body.dataset.phase1Enhanced==='1')return;
  const items=sourceItems(body);if(!items.length)return;
  body.dataset.itensData=JSON.stringify(items);
  const table=body.querySelector('table');if(!table)return;
  const head=table.querySelector('thead tr');
  if(head&&!head.querySelector('[data-phase1="gross"]')){
    const th=document.createElement('th');th.dataset.phase1='gross';th.textContent='Peso Bruto';th.style.cssText='padding:8px 12px;text-align:right;font-size:.8rem;color:#555';
    head.insertBefore(th,head.children[1]||null);
    const obs=document.createElement('th');obs.dataset.phase1='obs';obs.textContent='Observação do material';obs.style.cssText='padding:8px 12px;text-align:left;font-size:.8rem;color:#555;min-width:180px';head.appendChild(obs);
  }
  Array.from(table.querySelectorAll('tbody tr')).forEach((row,index)=>{
    const item=items[index];if(!item)return;
    if(!row.querySelector('[data-phase1="gross"]')){
      const td=row.insertCell(1);td.dataset.phase1='gross';td.style.cssText='padding:10px 12px;text-align:right;font-size:.92rem';td.textContent=kg(item.pesoBruto)+' kg';
    }
    if(!row.querySelector('.phase1-purchase-item-obs')){
      const td=document.createElement('td');td.style.cssText='padding:7px 8px';
      td.innerHTML=`<input class="phase1-purchase-item-obs" data-index="${index}" value="${esc(item.obs||'')}" placeholder="Observação deste material" style="width:100%;min-width:170px;padding:7px 9px;border:1px solid #cfd8d3;border-radius:7px;box-sizing:border-box">`;
      row.appendChild(td);
    }
  });
  const wrapper=document.createElement('div');wrapper.id='phase1-purchase-adjustments';wrapper.className='phase1-purchase-adjustments';
  wrapper.innerHTML=`<div class="phase1-purchase-adjust-title">Ajustes da compra</div>
    <div class="phase1-purchase-adjust-grid">
      <label><span>Desconto da compra R$</span><input id="phase1-purchase-discount" inputmode="decimal" placeholder="0,00"></label>
      <label><span>Valor extra R$</span><input id="phase1-purchase-extra-value" inputmode="decimal" placeholder="0,00"></label>
      <label class="phase1-purchase-reason"><span>Motivo do valor extra</span><input id="phase1-purchase-extra-reason" placeholder="Frete, mão de obra, lâmpada, outro..."></label>
      <button type="button" onclick="phase1PurchaseAddExtra()">＋ Adicionar valor</button>
    </div><div id="phase1-purchase-extra-list"></div>`;
  table.parentElement.insertAdjacentElement('afterend',wrapper);
  body.dataset.phase1Extras='[]';body.dataset.phase1Enhanced='1';
}
function parseBR(raw){
  let s=String(raw||'').trim().replace(/[^0-9,.-]/g,'');if(!s)return 0;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Number(s)||0;
}
global.phase1PurchaseAddExtra=function(){
  const body=document.getElementById('cs-lanc-body');if(!body)return;
  const value=parseBR(document.getElementById('phase1-purchase-extra-value')?.value);
  const reason=String(document.getElementById('phase1-purchase-extra-reason')?.value||'').trim();
  if(!(value>0)){try{showToast('Informe o valor extra.','error');}catch(e){}return;}
  if(!reason){try{showToast('Informe o motivo do valor extra.','error');}catch(e){}return;}
  let extras=[];try{extras=JSON.parse(body.dataset.phase1Extras||'[]');}catch(e){}
  extras.push({v:value,obs:reason,quando:new Date().toISOString().slice(0,10)});body.dataset.phase1Extras=JSON.stringify(extras);
  const v=document.getElementById('phase1-purchase-extra-value');const r=document.getElementById('phase1-purchase-extra-reason');if(v)v.value='';if(r)r.value='';renderExtraList();
};
global.phase1PurchaseRemoveExtra=function(index){
  const body=document.getElementById('cs-lanc-body');if(!body)return;let extras=[];try{extras=JSON.parse(body.dataset.phase1Extras||'[]');}catch(e){}
  extras.splice(index,1);body.dataset.phase1Extras=JSON.stringify(extras);renderExtraList();
};
function renderExtraList(){
  const body=document.getElementById('cs-lanc-body');const host=document.getElementById('phase1-purchase-extra-list');if(!body||!host)return;let extras=[];try{extras=JSON.parse(body.dataset.phase1Extras||'[]');}catch(e){}
  host.innerHTML=extras.map((x,i)=>`<div class="phase1-purchase-extra-row"><span>${esc(x.obs)}</span><b>+ R$ ${money(x.v)}</b><button onclick="phase1PurchaseRemoveExtra(${i})">✕</button></div>`).join('');
}
if(typeof original.loadSupplier==='function')global.csCarregarForn=function(){const result=original.loadSupplier.apply(this,arguments);setTimeout(enhancePurchaseForm,0);return result;};
if(typeof original.confirmPurchase==='function')global.csConfirmarEntrada=function(fornNome){
  const body=document.getElementById('cs-lanc-body');const before=new Set(Object.keys(tickets()));let extras=[],discount=0,items=[];
  if(body){
    items=sourceItems(body);document.querySelectorAll('.phase1-purchase-item-obs').forEach(input=>{const i=Number(input.dataset.index);if(items[i])items[i].obs=String(input.value||'').trim();});body.dataset.itensData=JSON.stringify(items);
    try{extras=JSON.parse(body.dataset.phase1Extras||'[]');}catch(e){}discount=Math.max(0,parseBR(document.getElementById('phase1-purchase-discount')?.value));
  }
  const result=original.confirmPurchase.apply(this,arguments);
  const created=Object.keys(tickets()).filter(key=>!before.has(key));const key=created[created.length-1];const t=key?tickets()[key]:null;
  if(t){
    (t.itens||[]).forEach((it,i)=>{it.mat=normalizeMaterial(it.matBase||it.mat);it.matBase=it.mat;it.ident='';it.obs=items[i]?.obs||it.obs||'';it.pesoBruto=Number(items[i]?.pesoBruto||it.pesoBruto||it.pesoLiq||0);it.total=Number(it.subtotal!=null?it.subtotal:(Number(it.pesoLiq||0)*Number(it.preco||0)));});
    const base=(t.itens||[]).reduce((sum,it)=>sum+Number(it.total||0),0);const extraTotal=extras.reduce((sum,x)=>sum+Number(x.v||0),0);
    t.descontoCompra=discount;t.acrescimos=extras.slice();t.acrescimo=extraTotal-discount;t.totalGeral=Math.max(0,base-discount+extraTotal);t.saldoPagar=Math.max(0,t.totalGeral-Number(t.adiantamento||0));t.status=t.saldoPagar<=0.01?'Pago':'Pendente';
    try{const cp=CONTAS_PAGAR.find(x=>x.ticket===t.ticket&&x.status!=='Pago');if(cp){cp.valor=t.saldoPagar;cp.obs=[cp.obs,discount?`Desconto R$ ${money(discount)}`:'',...extras.map(x=>`${x.obs}: R$ ${money(x.v)}`)].filter(Boolean).join(' | ');}}catch(e){}
    saveAll();try{if(typeof renderTickets==='function')renderTickets();}catch(e){}
  }
  return result;
};
function enhanceDetail(key){
  const ref=ticketFrom(key);if(!ref)return;const [ticketId,t]=ref;const info=document.getElementById('dc-info');if(!info)return;
  document.querySelectorAll('#phase1-purchase-detail-actions,#phase1-purchase-detail-summary').forEach(x=>x.remove());
  const gross=(t.itens||[]).reduce((s,it)=>s+itemGross(it),0);const net=(t.itens||[]).reduce((s,it)=>s+itemNet(it),0);
  const summary=document.createElement('div');summary.id='phase1-purchase-detail-summary';summary.className='phase1-purchase-detail-summary';summary.innerHTML=`<span><small>Peso bruto total</small><b>${kg(gross)} kg</b></span><span><small>Peso líquido total</small><b>${kg(net)} kg</b></span><span><small>Total financeiro</small><b>R$ ${money(t.totalGeral)}</b></span>`;info.insertAdjacentElement('afterend',summary);
  const tbody=document.getElementById('dc-itens-body');if(tbody){Array.from(tbody.rows).forEach((row,i)=>{const it=t.itens?.[i];if(it&&it.obs){const cell=row.cells[0];cell.insertAdjacentHTML('beforeend',`<div class="phase1-item-note">📝 ${esc(it.obs)}</div>`);}});}
  const actions=document.createElement('div');actions.id='phase1-purchase-detail-actions';actions.className='phase1-purchase-detail-actions';actions.innerHTML=`<button onclick="phase1PurchasePrint('${esc(ticketId)}')">📄 PDF / Imprimir</button><button class="whatsapp" onclick="phase1PurchaseSharePdf('${esc(ticketId)}')">📱 PDF para WhatsApp</button>`;summary.insertAdjacentElement('afterend',actions);
}
if(typeof original.detail==='function')global.abrirDetalheCompra=function(key){const result=original.detail.apply(this,arguments);setTimeout(()=>enhanceDetail(key),0);return result;};
function receiptElement(ticketId,t){
  const gross=(t.itens||[]).reduce((s,it)=>s+itemGross(it),0),net=(t.itens||[]).reduce((s,it)=>s+itemNet(it),0);const extras=Array.isArray(t.acrescimos)?t.acrescimos:[];
  const root=document.createElement('div');root.className='phase1-receipt';root.innerHTML=`<div class="phase1-receipt-brand"><b>${esc(typeof _empresaPrincipalLabel==='function'?_empresaPrincipalLabel():'Manuela Metais')}</b><span>${esc(typeof _empresaPrincipalRazao==='function'?_empresaPrincipalRazao():'')}</span></div><h2>RECIBO DE COMPRA DE SUCATA</h2>
  <div class="phase1-receipt-info"><span>Ticket <b>${esc(t.ticket||ticketId)}</b></span><span>Data <b>${esc(typeof fmtDate==='function'?(fmtDate(t.data)||t.data):t.data||'—')}</b></span><span>Fornecedor <b>${esc(t.fornecedor||t.fornecedorNome||'—')}</b></span><span>Status <b>${esc(t.status||'—')}</b></span></div>
  <table><thead><tr><th>Material</th><th>Observação</th><th>Bruto kg</th><th>Líquido kg</th><th>R$/kg</th><th>Total</th></tr></thead><tbody>${(t.itens||[]).map(it=>`<tr><td><b>${esc(it.mat||it.matBase||'—')}</b></td><td>${esc(it.obs||'—')}</td><td>${kg(itemGross(it))}</td><td>${kg(itemNet(it))}</td><td>R$ ${money(it.preco)}</td><td><b>R$ ${money(it.total!=null?it.total:itemNet(it)*Number(it.preco||0))}</b></td></tr>`).join('')}</tbody></table>
  <div class="phase1-receipt-totals"><span>Peso bruto total <b>${kg(gross)} kg</b></span><span>Peso líquido total <b>${kg(net)} kg</b></span>${Number(t.descontoCompra)>0?`<span>Desconto <b>- R$ ${money(t.descontoCompra)}</b></span>`:''}${extras.map(x=>`<span>${esc(x.obs||'Valor extra')} <b>+ R$ ${money(x.v)}</b></span>`).join('')}<span>Adiantamento <b>- R$ ${money(t.adiantamento)}</b></span><strong>Total final <b>R$ ${money(t.totalGeral)}</b></strong><strong>Saldo a pagar <b>R$ ${money(t.saldoPagar)}</b></strong></div>
  <div class="phase1-receipt-sign"><span>Assinatura do Fornecedor</span><span>Responsável ${esc(typeof _empresaPrincipalLabel==='function'?_empresaPrincipalLabel():'')}</span></div>`;return root;
}
global.phase1PurchasePrint=function(ticketId){const ref=ticketFrom(ticketId);if(!ref)return;const [key,t]=ref;const root=receiptElement(key,t);const win=window.open('','_blank','width=900,height=900');if(!win)return;win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Recibo ${esc(t.ticket||key)}</title><style>${receiptCss()}</style></head><body>${root.outerHTML}<div class="print-actions"><button onclick="window.print()">Imprimir / Salvar PDF</button></div></body></html>`);win.document.close();};
function receiptCss(){return `body{font-family:Inter,Arial,sans-serif;color:#18251f;padding:24px}.phase1-receipt{max-width:850px;margin:auto}.phase1-receipt-brand{text-align:center;display:grid}.phase1-receipt-brand b{font-size:24px;color:#173d2a}.phase1-receipt-brand span{font-size:11px;color:#667}.phase1-receipt h2{text-align:center;border:2px solid #173d2a;padding:9px;font-size:15px}.phase1-receipt-info{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;margin:12px 0;font-size:12px}.phase1-receipt table{width:100%;border-collapse:collapse;font-size:11px}.phase1-receipt th{background:#173d2a;color:white;padding:7px;text-align:left}.phase1-receipt td{padding:6px 7px;border-bottom:1px solid #e4e8e5}.phase1-receipt-totals{margin-left:auto;margin-top:12px;width:min(100%,430px);display:grid;gap:5px}.phase1-receipt-totals span,.phase1-receipt-totals strong{display:flex;justify-content:space-between;padding:5px 8px;background:#f7faf8}.phase1-receipt-totals strong{background:#e6f3e9;font-size:13px}.phase1-receipt-sign{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:50px}.phase1-receipt-sign span{border-top:1px solid #222;text-align:center;padding-top:5px;font-size:10px}.print-actions{text-align:center;margin:20px}.print-actions button{padding:10px 20px;background:#173d2a;color:#fff;border:0;border-radius:7px;font-weight:700}@media print{.print-actions{display:none}body{padding:6px}}`;}
function loadJsPdf(){return new Promise((resolve,reject)=>{if(global.jspdf?.jsPDF)return resolve(global.jspdf.jsPDF);const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';s.onload=()=>resolve(global.jspdf.jsPDF);s.onerror=reject;document.head.appendChild(s);});}
global.phase1PurchaseSharePdf=async function(ticketId){
  const ref=ticketFrom(ticketId);if(!ref)return;const [key,t]=ref;if(typeof html2canvas!=='function'){global.phase1PurchasePrint(key);return;}
  try{const JsPDF=await loadJsPdf();const root=receiptElement(key,t);root.style.cssText='position:fixed;left:-10000px;top:0;width:794px;background:#fff;padding:32px;z-index:-1';document.body.appendChild(root);const canvas=await html2canvas(root,{scale:1.5,backgroundColor:'#fff',logging:false});root.remove();const pdf=new JsPDF({orientation:'portrait',unit:'pt',format:'a4'});const width=pdf.internal.pageSize.getWidth()-40;const height=canvas.height*width/canvas.width;pdf.addImage(canvas.toDataURL('image/jpeg',.92),'JPEG',20,20,width,Math.min(height,pdf.internal.pageSize.getHeight()-40));const blob=pdf.output('blob');const file=new File([blob],`recibo-${t.ticket||key}.pdf`,{type:'application/pdf'});if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:`Recibo ${t.ticket||key}`});}else{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);window.open('https://wa.me/?text='+encodeURIComponent(`Olá! Segue o recibo da compra ${t.ticket||key}. O PDF foi baixado e está pronto para anexar.`),'_blank');}}
  catch(error){console.error(error);try{showToast('Não foi possível gerar o PDF. Abrindo versão para impressão.','error');}catch(e){}global.phase1PurchasePrint(key);}
};
function enhanceHistory(){const tb=document.getElementById('tb-compras');if(!tb)return;Array.from(tb.rows).forEach(row=>{if(row.querySelector('.phase1-purchase-pdf'))return;const key=String(row.cells?.[0]?.textContent||'').trim();if(!key||!tickets()[key])return;const cell=row.cells[row.cells.length-1];if(!cell)return;cell.insertAdjacentHTML('beforeend',` <button class="phase1-purchase-pdf" onclick="phase1PurchasePrint('${esc(key)}')" title="PDF da compra">📄</button>`);});}
if(typeof original.tickets==='function')global.renderTickets=function(){const result=original.tickets.apply(this,arguments);setTimeout(enhanceHistory,0);return result;};
function applyNavigation(){const nav=document.querySelector('.nav-tab[data-tab="canhoto_compra"]');if(nav)nav.remove();const panel=document.getElementById('tab-canhoto_compra');if(panel)panel.dataset.phase1Deprecated='1';}
if(global.Phase1Dom)global.Phase1Dom.register(applyNavigation);else setTimeout(applyNavigation,100);
})(window);
