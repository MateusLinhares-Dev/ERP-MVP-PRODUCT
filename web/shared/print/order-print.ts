import { formatAmount, formatQuantity } from '../domain/money.js';

export interface OrderCompany {
  name: string;
  legalName: string;
  cnpj: string;
  address: string;
  contacts: string;
  email: string;
  logo: string;
}

export interface OrderParty {
  label: string;
  name: string;
  lines: string[];
}

export interface OrderDocument {
  kind: string;
  title: string;
  company: OrderCompany;
  party: OrderParty;
  meta: Array<[string, string]>;
  itemsTitle: string;
  items: Array<{ name: string; description: string; quantity: number; price: number; total: number }>;
  totals: Array<{ label: string; value: string; grand?: boolean }>;
  finance: { title: string; rows: Array<{ label: string; value: string; tone?: 'paid' | 'due' }> };
  installments: Array<{ days: string; date: string; value: number; method: string; notes: string }>;
  notes: string;
  issuedAt: string;
}

const escape = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

export function orderDocumentHtml(doc: OrderDocument): string {
  const company = doc.company;
  const items = doc.items
    .map(
      (item) =>
        `<tr><td class="item-description"><strong>${escape(item.name || '—')}</strong>${
          item.description ? `<span>${escape(item.description)}</span>` : ''
        }</td><td class="numeric">${formatQuantity(item.quantity)}</td><td class="numeric">${formatAmount(
          item.price,
        )}</td><td class="numeric">${formatAmount(item.total)}</td></tr>`,
    )
    .join('');
  const totals = doc.totals
    .map(
      (row) =>
        `<tr class="${row.grand ? 'grand' : ''}"><th>${escape(row.label)}</th><td>${escape(row.value)}</td></tr>`,
    )
    .join('');
  const finance = doc.finance.rows
    .map(
      (row) =>
        `<tr class="${row.tone ?? ''}"><th>${escape(row.label)}</th><td>${escape(row.value)}</td></tr>`,
    )
    .join('');
  const installments = doc.installments.length
    ? doc.installments
        .map(
          (row) =>
            `<tr><td class="center">${escape(row.days)}</td><td>${escape(row.date)}</td><td class="numeric">R$ ${formatAmount(
              row.value,
            )}</td><td>${escape(row.method || '—')}</td><td>${escape(row.notes || '—')}</td></tr>`,
        )
        .join('')
    : '<tr><td class="center">—</td><td>—</td><td class="numeric">R$ 0,00</td><td>—</td><td>Pedido quitado</td></tr>';
  return `<main class="order-print">
<div class="doc-topline"><span>${escape(doc.issuedAt)}</span><span>${escape(doc.kind)}</span></div>
<header class="doc-header"><div class="brand"><div class="logo"><img class="logo-image" src="${escape(
    company.logo,
  )}" alt="${escape(company.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="logo-fallback">${escape(
    company.name,
  )}</div></div></div><div class="company"><strong>${escape(company.legalName)}</strong>${
    company.cnpj ? `<span>CNPJ: ${escape(company.cnpj)}</span>` : ''
  }${company.address ? `<span>${escape(company.address)}</span>` : ''}${
    company.contacts ? `<span>${escape(company.contacts)}</span>` : ''
  }${company.email ? `<span>${escape(company.email)}</span>` : ''}</div></header>
<h1>${escape(doc.title)}</h1>
<div class="print-top"><section class="party"><h2>${escape(doc.party.label)}</h2><strong>${escape(
    doc.party.name || '—',
  )}</strong>${doc.party.lines.map((line) => `<span>${escape(line)}</span>`).join('')}</section>
<table class="meta"><tbody>${doc.meta
    .map(([label, value]) => `<tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`)
    .join('')}</tbody></table></div>
<section class="print-section"><h2>${escape(doc.itemsTitle)}</h2><table class="items"><colgroup><col class="col-description"><col class="col-quantity"><col class="col-unit-price"><col class="col-total"></colgroup><thead><tr><th>Descrição do material</th><th>Quantidade (kg)</th><th>Valor unitário</th><th>Valor total</th></tr></thead><tbody>${items}</tbody></table>
<table class="print-totals"><tbody>${totals}</tbody></table></section>
<section class="print-section"><h2>${escape(doc.finance.title)}</h2><table class="payment-totals"><tbody>${finance}</tbody></table></section>
<section class="print-section installment-plan"><h2>Parcelas</h2><table class="installments"><colgroup><col class="col-days"><col class="col-date"><col class="col-money"><col class="col-form"><col class="col-notes"></colgroup><thead><tr><th>Dias</th><th>Data Vencimento</th><th>Valor</th><th>Forma</th><th>Observações</th></tr></thead><tbody>${installments}</tbody></table></section>
<section class="print-section"><h2>Observações</h2><div class="notes">${escape(doc.notes)}</div></section>
</main>`;
}

export const ORDER_PRINT_CSS = `
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#e7e9ec;color:#151515;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.order-print{width:210mm;min-height:297mm;margin:16px auto;padding:12mm;background:#fff;box-shadow:0 3px 18px #0002;font-size:14px;line-height:1.5}
.doc-topline{display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:13px}
.doc-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;min-height:88px}
.brand{width:150px;flex-shrink:0;display:flex;align-items:flex-start}
.logo{width:118px;min-height:76px;border:1px solid #29453a;background:#fff;padding:7px;display:flex;align-items:center;justify-content:center}
.logo-image{display:block;max-width:100%;max-height:60px;object-fit:contain}
.logo-fallback{display:none;width:100%;min-height:60px;align-items:center;justify-content:center;text-align:center;color:#1a3a2a;font-size:13px;line-height:1.1;font-weight:900;overflow-wrap:anywhere}
.company{display:flex;flex-direction:column;text-align:right;gap:2px;max-width:64%;font-size:12px;line-height:1.3;overflow-wrap:anywhere}
.company strong{font-size:14px}
.order-print h1{text-align:center;font-size:22px;font-weight:700;margin:10px 0 22px}
.print-top{display:grid;grid-template-columns:minmax(0,1fr) 38%;gap:7px;align-items:start}
.party{min-height:49px;border:1px solid #555;padding:5px 7px;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
.party h2{font-size:14px;margin:0 0 3px;font-weight:700}
.party strong{font-size:15px}
.party span{font-size:13px}
.meta{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
.meta th,.meta td{border:1px solid #555;text-align:left;padding:4px 5px;overflow-wrap:anywhere}
.meta th{width:53%;font-weight:700}
.print-section{margin-top:24px;break-inside:avoid-page}
.print-section h2{font-size:16px;margin:0 0 5px;font-weight:700}
.items,.installments{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
.items .col-description{width:52%}
.items .col-quantity,.items .col-unit-price,.items .col-total{width:16%}
.items th,.items td,.installments th,.installments td{border:1px solid #555;padding:4px 5px;vertical-align:top;overflow-wrap:anywhere}
.items th,.installments th{font-weight:700;text-align:left}
.items td.numeric,.installments td.numeric{text-align:right;white-space:nowrap}
.installments td.center{text-align:center}
.item-description strong,.item-description span{display:block}
.item-description span{white-space:pre-wrap;font-size:12px;margin-top:2px}
.items thead{display:table-header-group}
.items tr,.installments tr{break-inside:avoid-page}
.print-totals{width:49%;margin:1px 0 0 auto;border-collapse:collapse;font-size:13px}
.print-totals th,.print-totals td{padding:1px 5px;text-align:right;vertical-align:top;white-space:nowrap}
.print-totals th{font-weight:700}
.print-totals td{min-width:75px}
.print-totals .grand th,.print-totals .grand td{border-top:1px solid #555;font-weight:800}
.installments col.col-days{width:8%}
.installments col.col-date{width:16%}
.installments col.col-money{width:19%}
.installments col.col-form{width:17%}
.installments col.col-notes{width:40%}
.payment-totals{width:62%;margin-left:auto;border-collapse:collapse;font-size:13px}
.payment-totals th,.payment-totals td{border-bottom:1px solid #dedede;padding:4px 6px}
.payment-totals th{text-align:left;font-weight:500}
.payment-totals td{text-align:right;white-space:nowrap}
.payment-totals .paid{font-weight:700;background:#f4f8f5}
.payment-totals .due{border-top:1px solid #555;font-weight:800}
.notes{min-height:42px;border:1px solid #555;padding:7px;white-space:pre-wrap;overflow-wrap:anywhere}
.print-actions{text-align:center;margin:18px 0 25px}
.print-actions button{padding:11px 25px;border:0;border-radius:7px;background:#1a3a2a;color:#fff;font-size:13px;font-weight:700;cursor:pointer}
@media screen and (max-width:850px){.order-print{width:100%;margin:0 auto;padding:16px;box-shadow:none}.print-top{grid-template-columns:1fr}.company{text-align:left;max-width:100%}}
@media print{html,body{background:#fff!important}.order-print{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.print-actions{display:none!important}.print-section{break-inside:auto}.print-section h2{break-after:avoid-page}}
`;

export function openPrintWindow(title: string, body: string, css: string = ORDER_PRINT_CSS): boolean {
  const win = window.open('', '_blank', 'width=900,height=950');
  if (!win) return false;
  win.document.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escape(title)}</title><style>${css}</style></head><body>${body}<div class="print-actions"><button onclick="window.print()">Imprimir / Salvar PDF</button></div></body></html>`,
  );
  win.document.close();
  return true;
}

export { escape as escapeHtml };
