import{c as de,r as j,j as e,X as V,b as z,z as v,F as q,m as H,P as U,E as ae,v as Y,T as G,k as L}from"./index-BbBJ9lh6.js";import{P as ce}from"./printer-BuVf2zaP.js";import{C as pe}from"./copy-ByNb52ii.js";import{D as se}from"./download-D1UsRnpm.js";import{S as J}from"./save-Dyk8lR8O.js";/**
 * @license lucide-react v0.376.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const R=de("Building2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]]);function P(t,r){return`${{USD:"$",EUR:"€",GBP:"£",JPY:"¥",CHF:"CHF "}[r]||r+" "}${(t??0).toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2})}`}function ee(t){const r=[];return t.contact_person&&r.push(t.contact_person),t.address&&r.push(t.address),(t.city||t.country)&&r.push([t.city,t.country].filter(Boolean).join(", ")),t.phone&&r.push(t.phone),t.email&&r.push(t.email),t.vat_number&&r.push(`VAT: ${t.vat_number}`),r}const xe={1:`
    .inv-page { font-family: Georgia, 'Times New Roman', serif; background: #fff; color: #111; padding: 48px; max-width: 794px; margin: 0 auto; box-sizing: border-box; }
    .inv-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 28px; }
    .inv-company-name { font-size: 26px; font-weight: bold; color: #111; }
    .inv-company-sub { font-size: 12px; color: #555; margin-top: 4px; }
    .inv-label { font-size: 30px; font-weight: bold; letter-spacing: 4px; color: #111; text-align: right; }
    .inv-number { font-size: 13px; color: #555; text-align: right; margin-top: 4px; }
    .inv-status { display: inline-block; border: 1px solid #111; padding: 2px 10px; font-size: 11px; letter-spacing: 1px; margin-top: 6px; }
    .inv-meta { display: flex; gap: 32px; margin-bottom: 28px; }
    .inv-meta-block { }
    .inv-meta-key { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
    .inv-meta-val { font-size: 13px; font-weight: bold; }
    .inv-parties { display: flex; gap: 24px; margin-bottom: 32px; }
    .inv-party { flex: 1; border: 1px solid #ddd; padding: 16px; }
    .inv-party-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; }
    .inv-party-name { font-size: 14px; font-weight: bold; margin-bottom: 6px; }
    .inv-party-line { font-size: 12px; color: #555; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead tr { border-top: 2px solid #111; border-bottom: 2px solid #111; }
    thead th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 6px; text-align: left; }
    thead th:not(:first-child) { text-align: right; }
    tbody td { padding: 8px 6px; font-size: 12px; border-bottom: 1px solid #eee; }
    tbody td:not(:first-child) { text-align: right; }
    .inv-totals { display: flex; justify-content: flex-end; }
    .inv-totals-inner { width: 240px; }
    .inv-total-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; border-bottom: 1px solid #eee; }
    .inv-total-final { display: flex; justify-content: space-between; padding: 8px 0; font-size: 16px; font-weight: bold; border-top: 2px solid #111; border-bottom: 2px solid #111; margin-top: 4px; }
    .inv-bank { margin-top: 28px; padding-top: 16px; border-top: 1px solid #ddd; }
    .inv-section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #888; margin-bottom: 8px; }
    .inv-bank-line { font-size: 12px; color: #444; line-height: 1.7; }
    .inv-notes { margin-top: 20px; }
    .inv-notes-text { font-size: 12px; color: #555; line-height: 1.6; font-style: italic; }
  `,2:`
    .inv-page { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #1a1a1a; padding: 0; max-width: 794px; margin: 0 auto; box-sizing: border-box; overflow: hidden; }
    .inv-header { background: #0073ea; color: #fff; padding: 36px 48px; display: flex; justify-content: space-between; align-items: flex-start; }
    .inv-company-name { font-size: 24px; font-weight: 700; color: #fff; }
    .inv-company-sub { font-size: 12px; color: rgba(255,255,255,0.75); margin-top: 4px; }
    .inv-label { font-size: 28px; font-weight: 800; color: #fff; text-align: right; letter-spacing: 2px; }
    .inv-number { font-size: 13px; color: rgba(255,255,255,0.8); text-align: right; margin-top: 4px; }
    .inv-status { display: inline-block; background: rgba(255,255,255,0.2); color: #fff; padding: 3px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 1px; margin-top: 8px; }
    .inv-body { padding: 36px 48px; }
    .inv-meta { display: flex; gap: 28px; margin-bottom: 28px; background: #f0f7ff; border-radius: 10px; padding: 16px 20px; }
    .inv-meta-block { }
    .inv-meta-key { font-size: 10px; color: #0073ea; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; margin-bottom: 2px; }
    .inv-meta-val { font-size: 14px; font-weight: 600; color: #1a1a1a; }
    .inv-parties { display: flex; gap: 20px; margin-bottom: 32px; }
    .inv-party { flex: 1; }
    .inv-party-label { font-size: 10px; color: #0073ea; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; margin-bottom: 8px; }
    .inv-party-name { font-size: 15px; font-weight: 700; margin-bottom: 6px; color: #1a1a1a; }
    .inv-party-line { font-size: 12px; color: #666; line-height: 1.7; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; border-radius: 8px; overflow: hidden; }
    thead tr { background: #0073ea; }
    thead th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 10px 12px; text-align: left; color: #fff; font-weight: 600; }
    thead th:not(:first-child) { text-align: right; }
    tbody tr:nth-child(even) { background: #f8faff; }
    tbody td { padding: 10px 12px; font-size: 13px; color: #333; border-bottom: 1px solid #eef2ff; }
    tbody td:not(:first-child) { text-align: right; }
    .inv-totals { display: flex; justify-content: flex-end; }
    .inv-totals-inner { width: 260px; }
    .inv-total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; color: #555; }
    .inv-total-final { display: flex; justify-content: space-between; padding: 12px 16px; font-size: 16px; font-weight: 700; background: #0073ea; color: #fff; border-radius: 8px; margin-top: 8px; }
    .inv-bank { margin-top: 28px; padding: 16px 20px; background: #f8faff; border-radius: 10px; }
    .inv-section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #0073ea; font-weight: 700; margin-bottom: 8px; }
    .inv-bank-line { font-size: 12px; color: #444; line-height: 1.7; }
    .inv-notes { margin-top: 20px; }
    .inv-notes-text { font-size: 12px; color: #555; line-height: 1.6; }
  `,3:`
    .inv-page { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #2d3436; padding: 0; max-width: 794px; margin: 0 auto; box-sizing: border-box; }
    .inv-header { background: #2d3436; color: #fff; padding: 40px 48px 32px; display: flex; justify-content: space-between; align-items: flex-start; }
    .inv-company-name { font-size: 22px; font-weight: 700; color: #fff; letter-spacing: 0.5px; }
    .inv-company-sub { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 4px; }
    .inv-label { font-size: 32px; font-weight: 800; color: #fdcb6e; text-align: right; letter-spacing: 3px; }
    .inv-number { font-size: 13px; color: rgba(255,255,255,0.7); text-align: right; margin-top: 4px; }
    .inv-status { display: inline-block; border: 1px solid #fdcb6e; color: #fdcb6e; padding: 3px 12px; font-size: 11px; font-weight: 600; letter-spacing: 1px; margin-top: 8px; }
    .inv-body { padding: 36px 48px; }
    .inv-meta { display: flex; gap: 32px; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #e0e0e0; }
    .inv-meta-block { }
    .inv-meta-key { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
    .inv-meta-val { font-size: 13px; font-weight: 600; color: #2d3436; }
    .inv-parties { display: flex; gap: 24px; margin-bottom: 32px; }
    .inv-party { flex: 1; border-left: 3px solid #fdcb6e; padding-left: 14px; }
    .inv-party-label { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; font-weight: 600; }
    .inv-party-name { font-size: 15px; font-weight: 700; margin-bottom: 6px; color: #2d3436; }
    .inv-party-line { font-size: 12px; color: #636e72; line-height: 1.7; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead tr { background: #2d3436; }
    thead th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; padding: 10px 12px; text-align: left; color: rgba(255,255,255,0.85); font-weight: 600; }
    thead th:not(:first-child) { text-align: right; }
    tbody tr:nth-child(even) { background: #f9f9f9; }
    tbody td { padding: 9px 12px; font-size: 12px; color: #2d3436; border-bottom: 1px solid #f0f0f0; }
    tbody td:not(:first-child) { text-align: right; }
    .inv-totals { display: flex; justify-content: flex-end; }
    .inv-totals-inner { width: 260px; }
    .inv-total-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; color: #636e72; }
    .inv-total-final { display: flex; justify-content: space-between; padding: 12px 16px; font-size: 16px; font-weight: 700; background: #2d3436; color: #fdcb6e; margin-top: 8px; }
    .inv-bank { margin-top: 28px; padding-top: 16px; border-top: 1px solid #e0e0e0; }
    .inv-section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; font-weight: 600; margin-bottom: 8px; }
    .inv-bank-line { font-size: 12px; color: #636e72; line-height: 1.7; }
    .inv-notes { margin-top: 20px; }
    .inv-notes-text { font-size: 12px; color: #636e72; line-height: 1.6; }
  `,4:`
    .inv-page { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #333; padding: 56px 64px; max-width: 794px; margin: 0 auto; box-sizing: border-box; }
    .inv-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 48px; }
    .inv-company-name { font-size: 15px; font-weight: 600; color: #111; letter-spacing: 0.3px; }
    .inv-company-sub { font-size: 11px; color: #aaa; margin-top: 2px; }
    .inv-label { font-size: 11px; font-weight: 400; color: #bbb; letter-spacing: 3px; text-transform: uppercase; text-align: right; }
    .inv-number { font-size: 32px; font-weight: 300; color: #ddd; text-align: right; margin-top: 2px; letter-spacing: -1px; }
    .inv-status { font-size: 10px; color: #aaa; text-align: right; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px; display: block; }
    .inv-meta { display: flex; gap: 36px; margin-bottom: 40px; padding-bottom: 28px; border-bottom: 1px solid #f0f0f0; }
    .inv-meta-block { }
    .inv-meta-key { font-size: 9px; color: #bbb; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 3px; }
    .inv-meta-val { font-size: 12px; color: #333; }
    .inv-parties { display: flex; gap: 32px; margin-bottom: 40px; }
    .inv-party { flex: 1; }
    .inv-party-label { font-size: 9px; color: #bbb; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; }
    .inv-party-name { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: #111; }
    .inv-party-line { font-size: 11px; color: #999; line-height: 1.8; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    thead th { font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; padding: 0 0 10px; text-align: left; color: #bbb; font-weight: 400; border-bottom: 1px solid #eee; }
    thead th:not(:first-child) { text-align: right; }
    tbody td { padding: 12px 0; font-size: 12px; color: #444; border-bottom: 1px solid #f5f5f5; }
    tbody td:not(:first-child) { text-align: right; }
    .inv-totals { display: flex; justify-content: flex-end; }
    .inv-totals-inner { width: 220px; }
    .inv-total-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; color: #999; }
    .inv-total-final { display: flex; justify-content: space-between; padding: 12px 0; font-size: 15px; font-weight: 600; color: #111; border-top: 1px solid #eee; margin-top: 6px; }
    .inv-bank { margin-top: 40px; }
    .inv-section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #bbb; margin-bottom: 10px; }
    .inv-bank-line { font-size: 11px; color: #999; line-height: 1.8; }
    .inv-notes { margin-top: 24px; }
    .inv-notes-text { font-size: 11px; color: #aaa; line-height: 1.7; }
  `,5:`
    .inv-page { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #111; padding: 0; max-width: 794px; margin: 0 auto; box-sizing: border-box; display: flex; min-height: 600px; }
    .inv-sidebar { width: 8px; background: #ff6b35; flex-shrink: 0; }
    .inv-main { flex: 1; padding: 44px 48px; }
    .inv-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; padding-bottom: 24px; border-bottom: 3px solid #111; }
    .inv-company-name { font-size: 22px; font-weight: 900; color: #111; text-transform: uppercase; letter-spacing: 1px; }
    .inv-company-sub { font-size: 11px; color: #888; margin-top: 4px; }
    .inv-label { font-size: 36px; font-weight: 900; color: #ff6b35; text-align: right; letter-spacing: -1px; }
    .inv-number { font-size: 13px; font-weight: 600; color: #888; text-align: right; margin-top: 2px; }
    .inv-status { display: inline-block; background: #111; color: #fff; padding: 4px 14px; font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-top: 8px; }
    .inv-meta { display: flex; gap: 24px; margin-bottom: 28px; }
    .inv-meta-block { background: #f5f5f5; padding: 12px 16px; flex: 1; }
    .inv-meta-key { font-size: 9px; color: #999; text-transform: uppercase; letter-spacing: 2px; font-weight: 700; margin-bottom: 3px; }
    .inv-meta-val { font-size: 13px; font-weight: 700; color: #111; }
    .inv-parties { display: flex; gap: 20px; margin-bottom: 32px; }
    .inv-party { flex: 1; }
    .inv-party-label { font-size: 9px; color: #ff6b35; text-transform: uppercase; letter-spacing: 2px; font-weight: 800; margin-bottom: 8px; }
    .inv-party-name { font-size: 15px; font-weight: 800; margin-bottom: 5px; color: #111; }
    .inv-party-line { font-size: 12px; color: #666; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead tr { background: #111; }
    thead th { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; padding: 10px 12px; text-align: left; color: #fff; font-weight: 700; }
    thead th:not(:first-child) { text-align: right; }
    tbody tr:nth-child(even) { background: #fafafa; }
    tbody td { padding: 10px 12px; font-size: 13px; color: #333; border-bottom: 2px solid #f0f0f0; }
    tbody td:not(:first-child) { text-align: right; }
    .inv-totals { display: flex; justify-content: flex-end; }
    .inv-totals-inner { width: 260px; }
    .inv-total-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; color: #777; }
    .inv-total-final { display: flex; justify-content: space-between; padding: 12px 16px; font-size: 18px; font-weight: 900; background: #ff6b35; color: #fff; margin-top: 8px; }
    .inv-bank { margin-top: 28px; padding: 16px; border: 2px solid #f0f0f0; }
    .inv-section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #ff6b35; font-weight: 700; margin-bottom: 8px; }
    .inv-bank-line { font-size: 12px; color: #555; line-height: 1.7; }
    .inv-notes { margin-top: 20px; }
    .inv-notes-text { font-size: 12px; color: #666; line-height: 1.6; }
  `};function te(t,r){const d=r>=1&&r<=5?r:1,g=xe[d],c=d===5,k=p=>p.map(l=>`<div class="inv-party-line">${_(l)}</div>`).join(""),n=ee(t.company),s=ee(t.client),o=(t.status||"draft").toUpperCase(),f=c?`
    <div class="inv-header">
      <div>
        <div class="inv-company-name">${_(t.company.name)}</div>
        ${t.company.email?`<div class="inv-company-sub">${_(t.company.email)}</div>`:""}
      </div>
      <div>
        <div class="inv-label">INVOICE</div>
        <div class="inv-number">#${_(t.invoice_number)}</div>
        <div class="inv-status">${o}</div>
      </div>
    </div>
  `:`
    <div class="inv-header">
      <div>
        <div class="inv-company-name">${_(t.company.name)}</div>
        ${t.company.email?`<div class="inv-company-sub">${_(t.company.email)}</div>`:""}
      </div>
      <div>
        <div class="inv-label">INVOICE</div>
        <div class="inv-number">#${_(t.invoice_number)}</div>
        <span class="inv-status">${o}</span>
      </div>
    </div>
  `,i=`
    <div class="inv-meta">
      <div class="inv-meta-block">
        <div class="inv-meta-key">Issue Date</div>
        <div class="inv-meta-val">${_(t.issue_date)}</div>
      </div>
      ${t.due_date?`
      <div class="inv-meta-block">
        <div class="inv-meta-key">Due Date</div>
        <div class="inv-meta-val">${_(t.due_date)}</div>
      </div>`:""}
      <div class="inv-meta-block">
        <div class="inv-meta-key">Currency</div>
        <div class="inv-meta-val">${_(t.currency)}</div>
      </div>
    </div>
  `,b=`
    <div class="inv-parties">
      <div class="inv-party">
        <div class="inv-party-label">From</div>
        <div class="inv-party-name">${_(t.company.name)}</div>
        ${k(n)}
      </div>
      <div class="inv-party">
        <div class="inv-party-label">Bill To</div>
        <div class="inv-party-name">${_(t.client.name)}</div>
        ${k(s)}
      </div>
    </div>
  `,$=`
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Qty</th>
          <th>Unit Price</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>${t.items.map((p,l)=>`
    <tr>
      <td>${_(p.description||"")}</td>
      <td>${p.quantity}</td>
      <td>${P(p.unit_price,t.currency)}</td>
      <td>${P(p.amount,t.currency)}</td>
    </tr>
  `).join("")}</tbody>
    </table>
  `,T=`
    <div class="inv-totals">
      <div class="inv-totals-inner">
        <div class="inv-total-row"><span>Subtotal</span><span>${P(t.subtotal,t.currency)}</span></div>
        ${t.discount>0?`<div class="inv-total-row"><span>Discount</span><span>- ${P(t.discount,t.currency)}</span></div>`:""}
        ${t.tax_rate>0?`<div class="inv-total-row"><span>Tax (${t.tax_rate}%)</span><span>${P(t.tax_amount,t.currency)}</span></div>`:""}
        <div class="inv-total-final"><span>TOTAL</span><span>${P(t.total,t.currency)}</span></div>
      </div>
    </div>
  `,B=t.company.bank_name||t.company.bank_account||t.company.bank_swift?`
    <div class="inv-bank">
      <div class="inv-section-label">Bank Details</div>
      ${t.company.bank_name?`<div class="inv-bank-line">Bank: ${_(t.company.bank_name)}</div>`:""}
      ${t.company.bank_account?`<div class="inv-bank-line">Account: ${_(t.company.bank_account)}</div>`:""}
      ${t.company.bank_swift?`<div class="inv-bank-line">SWIFT: ${_(t.company.bank_swift)}</div>`:""}
    </div>
  `:"",S=t.notes?`
    <div class="inv-notes">
      <div class="inv-section-label">Notes</div>
      <div class="inv-notes-text" style="white-space:pre-line">${_(t.notes)}</div>
    </div>
  `:"";return c?`
      <style>${g}
        @media print {
          @page { size: A4; margin: 0; }
          body { margin: 0; }
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
      <div class="inv-page" id="invoice-content">
        <div class="inv-sidebar"></div>
        <div class="inv-main">
          ${f}
          ${i}
          ${b}
          ${$}
          ${T}
          ${B}
          ${S}
        </div>
      </div>
    `:d===2||d===3?`
      <style>${g}
        @media print {
          @page { size: A4; margin: 0; }
          body { margin: 0; }
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
      <div class="inv-page" id="invoice-content">
        ${f}
        <div class="inv-body">
          ${i}
          ${b}
          ${$}
          ${T}
          ${B}
          ${S}
        </div>
      </div>
    `:`
    <style>${g}
      @media print {
        @page { size: A4; margin: 10mm; }
        body { margin: 0; }
        .no-print { display: none !important; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
    <div class="inv-page" id="invoice-content">
      ${f}
      ${i}
      ${b}
      ${$}
      ${T}
      ${B}
      ${S}
    </div>
  `}function _(t){return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function ne({invoice:t,onClose:r}){const d=j.useRef(null),g=t.template_id??1,[c,k]=j.useState(1122),n=()=>{const i=te(t,g),b=window.open("","_blank","width=900,height=700");b&&(b.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice #${t.invoice_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: white; }
    @page { size: A4; margin: 10mm; }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
  </style>
</head>
<body>
  ${i}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); window.close(); }, 300);
    };
  <\/script>
</body>
</html>`),b.document.close())},s=te(t,g),o=()=>{var i;try{const b=(i=d.current)==null?void 0:i.contentDocument;if(b){const w=b.documentElement.scrollHeight||b.body.scrollHeight;k(Math.max(w,400))}}catch{}},f=`<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>* { margin:0; padding:0; box-sizing:border-box; } body { background:#fff; }</style>
  </head><body>${s}</body></html>`;return e.jsxs("div",{className:"fixed inset-0 z-[60] flex flex-col bg-black/60",children:[e.jsxs("div",{className:"flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 flex-shrink-0",children:[e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsxs("span",{className:"text-sm font-semibold text-gray-800",children:["Invoice Preview — #",t.invoice_number]}),e.jsxs("span",{className:"text-xs text-gray-400 capitalize bg-gray-100 px-2 py-0.5 rounded-full",children:[["","Classic","Modern","Professional","Minimal","Bold"][g]||"Classic"," template"]})]}),e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsxs("button",{onClick:n,className:"flex items-center gap-2 px-4 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600",children:[e.jsx(ce,{size:14})," Print / Save PDF"]}),e.jsx("button",{onClick:r,className:"p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg",children:e.jsx(V,{size:18})})]})]}),e.jsx("div",{className:"flex-1 overflow-y-auto py-8 px-4 flex justify-center",children:e.jsx("div",{className:"bg-white shadow-2xl",style:{width:"794px",minWidth:"794px"},children:e.jsx("iframe",{ref:d,srcDoc:f,onLoad:o,style:{width:"100%",height:`${c}px`,border:"none",display:"block"},title:"Invoice Preview"})})})]})}const me=[{id:1,name:"Classic",preview:e.jsxs("div",{style:{fontFamily:"Georgia, serif",padding:"8px",fontSize:"6px",lineHeight:1.3},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",borderBottom:"1px solid #111",paddingBottom:"4px",marginBottom:"4px"},children:[e.jsx("span",{style:{fontWeight:"bold",fontSize:"9px"},children:"COMPANY"}),e.jsx("span",{style:{fontWeight:"bold",letterSpacing:"2px"},children:"INVOICE"})]}),e.jsxs("div",{style:{display:"flex",gap:"4px",marginBottom:"4px"},children:[e.jsxs("div",{style:{flex:1,border:"1px solid #ddd",padding:"3px",fontSize:"5px"},children:[e.jsx("div",{style:{color:"#888"},children:"FROM"}),"Client Name"]}),e.jsxs("div",{style:{flex:1,border:"1px solid #ddd",padding:"3px",fontSize:"5px"},children:[e.jsx("div",{style:{color:"#888"},children:"TO"}),"Client Name"]})]}),e.jsx("div",{style:{background:"#f5f5f5",height:"3px",marginBottom:"2px"}}),e.jsx("div",{style:{background:"#f5f5f5",height:"3px",marginBottom:"2px"}}),e.jsx("div",{style:{display:"flex",justifyContent:"flex-end"},children:e.jsx("div",{style:{fontWeight:"bold",fontSize:"7px",borderTop:"1px solid #111"},children:"TOTAL: $0.00"})})]})},{id:2,name:"Modern",preview:e.jsxs("div",{style:{fontFamily:"sans-serif",fontSize:"6px",lineHeight:1.3,overflow:"hidden"},children:[e.jsxs("div",{style:{background:"#0073ea",color:"#fff",padding:"8px",display:"flex",justifyContent:"space-between",marginBottom:"6px"},children:[e.jsx("span",{style:{fontWeight:"bold",fontSize:"8px"},children:"COMPANY"}),e.jsx("span",{style:{fontWeight:"bold",fontSize:"9px",letterSpacing:"1px"},children:"INVOICE"})]}),e.jsxs("div",{style:{padding:"0 8px"},children:[e.jsxs("div",{style:{display:"flex",gap:"4px",marginBottom:"4px"},children:[e.jsx("div",{style:{flex:1,fontSize:"5px",color:"#555"},children:"FROM block"}),e.jsx("div",{style:{flex:1,fontSize:"5px",color:"#555"},children:"TO block"})]}),e.jsx("div",{style:{height:"3px",background:"#eef2ff",marginBottom:"2px"}}),e.jsx("div",{style:{height:"3px",background:"#eef2ff",marginBottom:"4px"}}),e.jsx("div",{style:{display:"flex",justifyContent:"flex-end"},children:e.jsx("div",{style:{background:"#0073ea",color:"#fff",padding:"2px 6px",fontSize:"6px",fontWeight:"bold"},children:"TOTAL $0.00"})})]})]})},{id:3,name:"Professional",preview:e.jsxs("div",{style:{fontFamily:"sans-serif",fontSize:"6px",lineHeight:1.3,overflow:"hidden"},children:[e.jsxs("div",{style:{background:"#2d3436",color:"#fff",padding:"8px",display:"flex",justifyContent:"space-between",marginBottom:"6px"},children:[e.jsx("span",{style:{fontWeight:"bold",fontSize:"8px"},children:"COMPANY"}),e.jsx("span",{style:{fontWeight:"bold",fontSize:"10px",color:"#fdcb6e",letterSpacing:"1px"},children:"INVOICE"})]}),e.jsxs("div",{style:{padding:"0 8px"},children:[e.jsxs("div",{style:{display:"flex",gap:"6px",marginBottom:"4px"},children:[e.jsx("div",{style:{flex:1,borderLeft:"2px solid #fdcb6e",paddingLeft:"4px",fontSize:"5px"},children:"FROM"}),e.jsx("div",{style:{flex:1,borderLeft:"2px solid #fdcb6e",paddingLeft:"4px",fontSize:"5px"},children:"TO"})]}),e.jsx("div",{style:{height:"3px",background:"#f5f5f5",marginBottom:"2px"}}),e.jsx("div",{style:{height:"3px",background:"#f5f5f5",marginBottom:"4px"}}),e.jsx("div",{style:{display:"flex",justifyContent:"flex-end"},children:e.jsx("div",{style:{background:"#2d3436",color:"#fdcb6e",padding:"2px 6px",fontSize:"6px",fontWeight:"bold"},children:"TOTAL $0.00"})})]})]})},{id:4,name:"Minimal",preview:e.jsxs("div",{style:{fontFamily:"sans-serif",padding:"8px",fontSize:"6px",lineHeight:1.3},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:"6px"},children:[e.jsx("span",{style:{fontWeight:"600",fontSize:"8px"},children:"Company"}),e.jsxs("div",{style:{textAlign:"right"},children:[e.jsx("div",{style:{color:"#ccc",fontSize:"5px",letterSpacing:"2px"},children:"INVOICE"}),e.jsx("div",{style:{color:"#ddd",fontSize:"12px",lineHeight:1},children:"#001"})]})]}),e.jsxs("div",{style:{borderTop:"1px solid #f0f0f0",paddingTop:"4px",marginBottom:"4px"},children:[e.jsx("div",{style:{display:"flex",gap:"8px",marginBottom:"4px"},children:e.jsx("div",{style:{flex:1,color:"#aaa",fontSize:"5px"},children:"From · To"})}),e.jsx("div",{style:{height:"1px",background:"#f5f5f5",marginBottom:"2px"}}),e.jsx("div",{style:{height:"1px",background:"#f5f5f5",marginBottom:"4px"}})]}),e.jsx("div",{style:{display:"flex",justifyContent:"flex-end"},children:e.jsx("div",{style:{fontWeight:"600",fontSize:"7px",borderTop:"1px solid #eee",paddingTop:"2px"},children:"Total $0.00"})})]})},{id:5,name:"Bold",preview:e.jsxs("div",{style:{fontFamily:"sans-serif",fontSize:"6px",lineHeight:1.3,display:"flex",overflow:"hidden"},children:[e.jsx("div",{style:{width:"5px",background:"#ff6b35",flexShrink:0}}),e.jsxs("div",{style:{flex:1,padding:"8px"},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",borderBottom:"2px solid #111",paddingBottom:"4px",marginBottom:"4px"},children:[e.jsx("span",{style:{fontWeight:"900",fontSize:"8px",textTransform:"uppercase"},children:"COMPANY"}),e.jsx("span",{style:{fontWeight:"900",fontSize:"11px",color:"#ff6b35"},children:"INVOICE"})]}),e.jsxs("div",{style:{display:"flex",gap:"4px",marginBottom:"4px"},children:[e.jsx("div",{style:{flex:1,background:"#f5f5f5",padding:"2px",fontSize:"5px"},children:"FROM"}),e.jsx("div",{style:{flex:1,background:"#f5f5f5",padding:"2px",fontSize:"5px"},children:"TO"})]}),e.jsx("div",{style:{height:"3px",background:"#fafafa",marginBottom:"2px"}}),e.jsx("div",{style:{display:"flex",justifyContent:"flex-end"},children:e.jsx("div",{style:{background:"#ff6b35",color:"#fff",padding:"2px 6px",fontSize:"6px",fontWeight:"900"},children:"TOTAL $0.00"})})]})]})}];function ge({value:t,onChange:r}){return e.jsxs("div",{children:[e.jsx("label",{className:"block text-xs font-medium text-gray-500 mb-2",children:"Invoice Template"}),e.jsx("div",{className:"grid grid-cols-5 gap-2",children:me.map(d=>e.jsxs("button",{type:"button",onClick:()=>r(d.id),className:["rounded-lg overflow-hidden border-2 transition-all hover:shadow-md cursor-pointer",t===d.id?"border-monday-blue ring-2 ring-monday-blue/30":"border-gray-200 hover:border-gray-300"].join(" "),children:[e.jsx("div",{className:"h-20 bg-white overflow-hidden",children:d.preview}),e.jsx("div",{className:["text-center text-xs py-1 font-medium",t===d.id?"bg-monday-blue text-white":"bg-gray-50 text-gray-600"].join(" "),children:d.name})]},d.id))})]})}const fe=[{id:"invoices",label:"Invoices",icon:e.jsx(q,{size:15})},{id:"companies",label:"My Companies",icon:e.jsx(R,{size:15})},{id:"clients",label:"Clients",icon:e.jsx(H,{size:15})}],ue=["USD","EUR","GBP","CHF","JPY","CAD","AUD"],he=["draft","sent","paid","cancelled"],be={draft:"bg-gray-100 text-gray-600",sent:"bg-blue-100 text-blue-700",paid:"bg-green-100 text-green-700",cancelled:"bg-red-100 text-red-600"};function h({label:t,children:r}){return e.jsxs("div",{children:[e.jsx("label",{className:"block text-xs font-medium text-gray-500 mb-1",children:t}),r]})}const y="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue",W="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-monday-blue bg-white";function X({title:t,onClose:r,children:d,wide:g=!1}){return e.jsx("div",{className:"fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4",children:e.jsxs("div",{className:`bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] ${g?"w-full max-w-4xl":"w-full max-w-lg"}`,children:[e.jsxs("div",{className:"flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0",children:[e.jsx("h2",{className:"font-semibold text-gray-900 text-lg",children:t}),e.jsx("button",{onClick:r,className:"text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100",children:e.jsx(V,{size:18})})]}),e.jsx("div",{className:"overflow-y-auto flex-1",children:d})]})})}function ye({company:t,onClose:r,onSaved:d}){const g={name:"",address:"",city:"",country:"",phone:"",email:"",vat_number:"",bank_name:"",bank_account:"",bank_swift:"",logo_url:""},[c,k]=j.useState(t?{...t}:g),[n,s]=j.useState(!1),o=(i,b)=>k(w=>({...w,[i]:b})),f=async()=>{var i,b;if(!c.name.trim()){v.error("Company name is required");return}s(!0);try{const{data:w}=t?await z.put(`/invoices/my-companies/${t.id}`,c):await z.post("/invoices/my-companies",c);v.success(t?"Company updated":"Company created"),d(w)}catch(w){v.error(((b=(i=w==null?void 0:w.response)==null?void 0:i.data)==null?void 0:b.error)||"Failed to save")}finally{s(!1)}};return e.jsx(X,{title:t?"Edit Company":"New Company",onClose:r,children:e.jsxs("div",{className:"p-6 space-y-4",children:[e.jsx(h,{label:"Company Name *",children:e.jsx("input",{className:y,value:c.name,onChange:i=>o("name",i.target.value),placeholder:"Acme Corp"})}),e.jsxs("div",{className:"grid grid-cols-2 gap-4",children:[e.jsx(h,{label:"Email",children:e.jsx("input",{className:y,value:c.email||"",onChange:i=>o("email",i.target.value),placeholder:"billing@acme.com"})}),e.jsx(h,{label:"Phone",children:e.jsx("input",{className:y,value:c.phone||"",onChange:i=>o("phone",i.target.value),placeholder:"+1 555 000"})})]}),e.jsx(h,{label:"Address",children:e.jsx("input",{className:y,value:c.address||"",onChange:i=>o("address",i.target.value),placeholder:"123 Main St"})}),e.jsxs("div",{className:"grid grid-cols-2 gap-4",children:[e.jsx(h,{label:"City",children:e.jsx("input",{className:y,value:c.city||"",onChange:i=>o("city",i.target.value),placeholder:"New York"})}),e.jsx(h,{label:"Country",children:e.jsx("input",{className:y,value:c.country||"",onChange:i=>o("country",i.target.value),placeholder:"USA"})})]}),e.jsx(h,{label:"VAT Number",children:e.jsx("input",{className:y,value:c.vat_number||"",onChange:i=>o("vat_number",i.target.value),placeholder:"US123456789"})}),e.jsxs("div",{className:"border-t border-gray-100 pt-4",children:[e.jsx("p",{className:"text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3",children:"Bank Details"}),e.jsxs("div",{className:"space-y-3",children:[e.jsx(h,{label:"Bank Name",children:e.jsx("input",{className:y,value:c.bank_name||"",onChange:i=>o("bank_name",i.target.value),placeholder:"First National Bank"})}),e.jsxs("div",{className:"grid grid-cols-2 gap-4",children:[e.jsx(h,{label:"Account Number / IBAN",children:e.jsx("input",{className:y,value:c.bank_account||"",onChange:i=>o("bank_account",i.target.value),placeholder:"DE89 3704 0044 ..."})}),e.jsx(h,{label:"SWIFT / BIC",children:e.jsx("input",{className:y,value:c.bank_swift||"",onChange:i=>o("bank_swift",i.target.value),placeholder:"COBADEFFXXX"})})]})]})]}),e.jsxs("div",{className:"flex justify-end gap-2 pt-2",children:[e.jsx("button",{onClick:r,className:"px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg",children:"Cancel"}),e.jsxs("button",{onClick:f,disabled:n,className:"flex items-center gap-2 px-5 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-60",children:[e.jsx(J,{size:14})," ",n?"Saving…":"Save"]})]})]})})}function ve({client:t,onClose:r,onSaved:d}){const g={name:"",address:"",city:"",country:"",phone:"",email:"",vat_number:"",contact_person:""},[c,k]=j.useState(t?{...t}:g),[n,s]=j.useState(!1),o=(i,b)=>k(w=>({...w,[i]:b})),f=async()=>{var i,b;if(!c.name.trim()){v.error("Client name is required");return}s(!0);try{const{data:w}=t?await z.put(`/invoices/clients/${t.id}`,c):await z.post("/invoices/clients",c);v.success(t?"Client updated":"Client created"),d(w)}catch(w){v.error(((b=(i=w==null?void 0:w.response)==null?void 0:i.data)==null?void 0:b.error)||"Failed to save")}finally{s(!1)}};return e.jsx(X,{title:t?"Edit Client":"New Client",onClose:r,children:e.jsxs("div",{className:"p-6 space-y-4",children:[e.jsx(h,{label:"Client Name *",children:e.jsx("input",{className:y,value:c.name,onChange:i=>o("name",i.target.value),placeholder:"Client Corp"})}),e.jsx(h,{label:"Contact Person",children:e.jsx("input",{className:y,value:c.contact_person||"",onChange:i=>o("contact_person",i.target.value),placeholder:"Jane Smith"})}),e.jsxs("div",{className:"grid grid-cols-2 gap-4",children:[e.jsx(h,{label:"Email",children:e.jsx("input",{className:y,value:c.email||"",onChange:i=>o("email",i.target.value),placeholder:"client@example.com"})}),e.jsx(h,{label:"Phone",children:e.jsx("input",{className:y,value:c.phone||"",onChange:i=>o("phone",i.target.value),placeholder:"+1 555 000"})})]}),e.jsx(h,{label:"Address",children:e.jsx("input",{className:y,value:c.address||"",onChange:i=>o("address",i.target.value),placeholder:"456 Client Ave"})}),e.jsxs("div",{className:"grid grid-cols-2 gap-4",children:[e.jsx(h,{label:"City",children:e.jsx("input",{className:y,value:c.city||"",onChange:i=>o("city",i.target.value),placeholder:"London"})}),e.jsx(h,{label:"Country",children:e.jsx("input",{className:y,value:c.country||"",onChange:i=>o("country",i.target.value),placeholder:"UK"})})]}),e.jsx(h,{label:"VAT Number",children:e.jsx("input",{className:y,value:c.vat_number||"",onChange:i=>o("vat_number",i.target.value),placeholder:"GB123456789"})}),e.jsxs("div",{className:"flex justify-end gap-2 pt-2",children:[e.jsx("button",{onClick:r,className:"px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg",children:"Cancel"}),e.jsxs("button",{onClick:f,disabled:n,className:"flex items-center gap-2 px-5 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-60",children:[e.jsx(J,{size:14})," ",n?"Saving…":"Save"]})]})]})})}function je({invoice:t,companies:r,clients:d,onClose:g,onSaved:c}){var Q,K,Z;const k=new Date().toISOString().slice(0,10),n=()=>({description:"",quantity:1,unit_price:0,amount:0}),[s,o]=j.useState({invoice_number:(t==null?void 0:t.invoice_number)||"",my_company_id:(t==null?void 0:t.my_company_id)||(((Q=r[0])==null?void 0:Q.id)??""),client_id:(t==null?void 0:t.client_id)||(((K=d[0])==null?void 0:K.id)??""),issue_date:(t==null?void 0:t.issue_date)||k,due_date:(t==null?void 0:t.due_date)||"",status:(t==null?void 0:t.status)||"draft",currency:(t==null?void 0:t.currency)||"USD",notes:(t==null?void 0:t.notes)||"",tax_rate:(t==null?void 0:t.tax_rate)??0,discount:(t==null?void 0:t.discount)??0,template_id:(t==null?void 0:t.template_id)??1}),[f,i]=j.useState((Z=t==null?void 0:t.items)!=null&&Z.length?t.items:[n()]),[b,w]=j.useState(!1),[$,T]=j.useState(!1),[B,S]=j.useState(!1),m=(a,x,N)=>{i(I=>I.map((E,F)=>{if(F!==a)return E;const D={...E,[x]:N};return D.amount=D.quantity*D.unit_price,D}))},p=()=>i(a=>[...a,n()]),l=a=>i(x=>x.filter((N,I)=>I!==a)),u=f.reduce((a,x)=>a+x.amount,0),O=u-(s.discount||0),A=O*((s.tax_rate||0)/100),ie=O+A,M=a=>a.toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2}),C=(a,x)=>o(N=>({...N,[a]:x})),le=async()=>{var a,x;if(!s.invoice_number.trim()){v.error("Invoice number is required");return}if(!s.my_company_id){v.error("Select a company");return}if(!s.client_id){v.error("Select a client");return}if(!s.issue_date){v.error("Issue date is required");return}w(!0);try{const N={...s,items:f,template_id:s.template_id},{data:I}=t?await z.put(`/invoices/${t.id}`,N):await z.post("/invoices",N);v.success(t?"Invoice updated":"Invoice created"),c(I)}catch(N){v.error(((x=(a=N==null?void 0:N.response)==null?void 0:a.data)==null?void 0:x.error)||"Failed to save")}finally{w(!1)}},oe=()=>{const a=r.find(F=>F.id===s.my_company_id),x=d.find(F=>F.id===s.client_id),N=f.reduce((F,D)=>F+D.amount,0),I=N-(s.discount||0),E=I*((s.tax_rate||0)/100);return{invoice_number:s.invoice_number||"PREVIEW",issue_date:s.issue_date,due_date:s.due_date||void 0,status:s.status,currency:s.currency,notes:s.notes||void 0,tax_rate:s.tax_rate,discount:s.discount,subtotal:N,tax_amount:E,total:I+E,template_id:s.template_id,items:f,company:{name:(a==null?void 0:a.name)||"",address:(a==null?void 0:a.address)||"",city:(a==null?void 0:a.city)||"",country:(a==null?void 0:a.country)||"",phone:(a==null?void 0:a.phone)||"",email:(a==null?void 0:a.email)||"",vat_number:(a==null?void 0:a.vat_number)||"",bank_name:(a==null?void 0:a.bank_name)||"",bank_account:(a==null?void 0:a.bank_account)||"",bank_swift:(a==null?void 0:a.bank_swift)||"",logo_url:(a==null?void 0:a.logo_url)||""},client:{name:(x==null?void 0:x.name)||"",address:(x==null?void 0:x.address)||"",city:(x==null?void 0:x.city)||"",country:(x==null?void 0:x.country)||"",phone:(x==null?void 0:x.phone)||"",email:(x==null?void 0:x.email)||"",vat_number:(x==null?void 0:x.vat_number)||"",contact_person:(x==null?void 0:x.contact_person)||""}}},re=()=>{S(!0)};return e.jsxs(X,{title:t?`Edit Invoice ${t.invoice_number}`:"New Invoice",onClose:g,wide:!0,children:[e.jsxs("div",{className:"p-6 space-y-5",children:[e.jsxs("div",{className:"grid grid-cols-2 gap-4",children:[e.jsx(h,{label:"Invoice Number *",children:e.jsx("input",{className:y,value:s.invoice_number,onChange:a=>C("invoice_number",a.target.value),placeholder:"INV-001"})}),e.jsx(h,{label:"Status",children:e.jsxs("div",{className:"relative",children:[e.jsx("select",{className:W,value:s.status,onChange:a=>C("status",a.target.value),children:he.map(a=>e.jsx("option",{value:a,children:a.charAt(0).toUpperCase()+a.slice(1)},a))}),e.jsx(L,{size:14,className:"pointer-events-none absolute right-3 top-2.5 text-gray-400"})]})})]}),e.jsxs("div",{className:"grid grid-cols-2 gap-4",children:[e.jsx(h,{label:"My Company *",children:e.jsxs("div",{className:"relative",children:[e.jsxs("select",{className:W,value:s.my_company_id,onChange:a=>C("my_company_id",a.target.value),children:[e.jsx("option",{value:"",children:"— select company —"}),r.map(a=>e.jsx("option",{value:a.id,children:a.name},a.id))]}),e.jsx(L,{size:14,className:"pointer-events-none absolute right-3 top-2.5 text-gray-400"})]})}),e.jsx(h,{label:"Client *",children:e.jsxs("div",{className:"relative",children:[e.jsxs("select",{className:W,value:s.client_id,onChange:a=>C("client_id",a.target.value),children:[e.jsx("option",{value:"",children:"— select client —"}),d.map(a=>e.jsx("option",{value:a.id,children:a.name},a.id))]}),e.jsx(L,{size:14,className:"pointer-events-none absolute right-3 top-2.5 text-gray-400"})]})})]}),e.jsxs("div",{className:"grid grid-cols-3 gap-4",children:[e.jsx(h,{label:"Issue Date *",children:e.jsx("input",{type:"date",className:y,value:s.issue_date,onChange:a=>C("issue_date",a.target.value)})}),e.jsx(h,{label:"Due Date",children:e.jsx("input",{type:"date",className:y,value:s.due_date,onChange:a=>C("due_date",a.target.value)})}),e.jsx(h,{label:"Currency",children:e.jsxs("div",{className:"relative",children:[e.jsx("select",{className:W,value:s.currency,onChange:a=>C("currency",a.target.value),children:ue.map(a=>e.jsx("option",{value:a,children:a},a))}),e.jsx(L,{size:14,className:"pointer-events-none absolute right-3 top-2.5 text-gray-400"})]})})]}),e.jsxs("div",{children:[e.jsxs("div",{className:"flex items-center justify-between mb-2",children:[e.jsx("p",{className:"text-xs font-semibold text-gray-500 uppercase tracking-wider",children:"Line Items"}),e.jsxs("button",{onClick:p,className:"flex items-center gap-1 text-xs text-monday-blue hover:underline",children:[e.jsx(U,{size:13})," Add row"]})]}),e.jsxs("div",{className:"border border-gray-200 rounded-xl overflow-hidden",children:[e.jsxs("div",{className:"grid grid-cols-[1fr_80px_110px_110px_36px] gap-0 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 px-3 py-2",children:[e.jsx("span",{children:"Description"}),e.jsx("span",{className:"text-right",children:"Qty"}),e.jsx("span",{className:"text-right",children:"Unit Price"}),e.jsx("span",{className:"text-right",children:"Amount"}),e.jsx("span",{})]}),f.map((a,x)=>e.jsxs("div",{className:"grid grid-cols-[1fr_80px_110px_110px_36px] gap-0 border-b border-gray-100 last:border-b-0 px-2 py-1.5 items-center",children:[e.jsx("input",{className:"border-0 bg-transparent text-sm px-1 py-1 focus:outline-none focus:bg-blue-50 rounded w-full",value:a.description,onChange:N=>m(x,"description",N.target.value),placeholder:"Service description…"}),e.jsx("input",{type:"number",min:"0",step:"0.01",className:"border-0 bg-transparent text-sm text-right px-1 py-1 focus:outline-none focus:bg-blue-50 rounded w-full",value:a.quantity,onChange:N=>m(x,"quantity",parseFloat(N.target.value)||0)}),e.jsx("input",{type:"number",min:"0",step:"0.01",className:"border-0 bg-transparent text-sm text-right px-1 py-1 focus:outline-none focus:bg-blue-50 rounded w-full",value:a.unit_price,onChange:N=>m(x,"unit_price",parseFloat(N.target.value)||0)}),e.jsx("div",{className:"text-sm text-right text-gray-700 px-1 font-medium",children:M(a.amount)}),e.jsx("button",{onClick:()=>l(x),disabled:f.length===1,className:"text-gray-300 hover:text-red-400 p-1 rounded disabled:opacity-30",children:e.jsx(V,{size:13})})]},x))]})]}),e.jsxs("div",{className:"flex gap-6 items-start",children:[e.jsxs("div",{className:"flex-1 space-y-3",children:[e.jsxs("div",{className:"grid grid-cols-2 gap-4",children:[e.jsx(h,{label:"Tax Rate (%)",children:e.jsx("input",{type:"number",min:"0",max:"100",step:"0.1",className:y,value:s.tax_rate,onChange:a=>C("tax_rate",parseFloat(a.target.value)||0)})}),e.jsx(h,{label:"Discount (fixed amount)",children:e.jsx("input",{type:"number",min:"0",step:"0.01",className:y,value:s.discount,onChange:a=>C("discount",parseFloat(a.target.value)||0)})})]}),e.jsx(h,{label:"Notes",children:e.jsx("textarea",{className:`${y} min-h-[72px] resize-y`,value:s.notes,onChange:a=>C("notes",a.target.value),placeholder:"Payment terms, thank-you message, etc."})})]}),e.jsxs("div",{className:"w-56 bg-gray-50 rounded-xl p-4 text-sm space-y-2 flex-shrink-0",children:[e.jsxs("div",{className:"flex justify-between text-gray-500",children:[e.jsx("span",{children:"Subtotal"}),e.jsx("span",{className:"font-medium text-gray-800",children:M(u)})]}),s.discount>0&&e.jsxs("div",{className:"flex justify-between text-gray-500",children:[e.jsx("span",{children:"Discount"}),e.jsxs("span",{className:"text-red-500",children:["- ",M(s.discount)]})]}),s.tax_rate>0&&e.jsxs("div",{className:"flex justify-between text-gray-500",children:[e.jsxs("span",{children:["Tax (",s.tax_rate,"%)"]}),e.jsx("span",{children:M(A)})]}),e.jsxs("div",{className:"border-t border-gray-200 pt-2 flex justify-between font-bold text-gray-900 text-base",children:[e.jsx("span",{children:"Total"}),e.jsxs("span",{children:[s.currency," ",M(ie)]})]})]})]}),e.jsx(ge,{value:s.template_id,onChange:a=>C("template_id",a)}),e.jsxs("div",{className:"flex items-center justify-between pt-2 border-t border-gray-100",children:[e.jsxs("div",{className:"flex gap-2",children:[e.jsxs("button",{onClick:()=>S(!0),className:"flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700",children:[e.jsx(ae,{size:14})," Preview"]}),t&&e.jsxs("button",{onClick:re,disabled:$,className:"flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 disabled:opacity-60",children:[e.jsx(se,{size:14})," ",$?"Opening…":"Print / PDF"]})]}),e.jsxs("div",{className:"flex gap-2",children:[e.jsx("button",{onClick:g,className:"px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg",children:"Cancel"}),e.jsxs("button",{onClick:le,disabled:b,className:"flex items-center gap-2 px-5 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-60",children:[e.jsx(J,{size:14})," ",b?"Saving…":"Save Invoice"]})]})]})]}),B&&e.jsx(ne,{invoice:oe(),onClose:()=>S(!1)})]})}function we({companies:t,clients:r}){const[d,g]=j.useState([]),[c,k]=j.useState(!0),[n,s]=j.useState(null),[o,f]=j.useState(null),i=j.useCallback(async()=>{try{const{data:m}=await z.get("/invoices");g(m)}catch{v.error("Failed to load invoices")}finally{k(!1)}},[]);j.useEffect(()=>{i()},[i]);const b=async m=>{if(confirm("Delete this invoice?"))try{await z.delete(`/invoices/${m}`),g(p=>p.filter(l=>l.id!==m)),v.success("Invoice deleted")}catch{v.error("Failed to delete")}},w=async m=>{try{const{data:p}=await z.get(`/invoices/${m}`);s(p)}catch{v.error("Failed to load invoice")}},$=async m=>{try{const{data:p}=await z.post(`/invoices/${m}/duplicate`);g(l=>[p,...l]),s(p),v.success("Invoice copied")}catch{v.error("Failed to copy invoice")}},T=async m=>{try{const{data:p}=await z.get(`/invoices/${m.id}`),l=t.find(A=>A.id===p.my_company_id),u=r.find(A=>A.id===p.client_id),O={invoice_number:p.invoice_number,issue_date:p.issue_date,due_date:p.due_date||void 0,status:p.status,currency:p.currency,notes:p.notes||void 0,tax_rate:p.tax_rate,discount:p.discount,subtotal:p.subtotal,tax_amount:p.tax_amount,total:p.total,template_id:p.template_id??1,items:p.items||[],company:{name:(l==null?void 0:l.name)||p.company_name||"",address:(l==null?void 0:l.address)||"",city:(l==null?void 0:l.city)||"",country:(l==null?void 0:l.country)||"",phone:(l==null?void 0:l.phone)||"",email:(l==null?void 0:l.email)||"",vat_number:(l==null?void 0:l.vat_number)||"",bank_name:(l==null?void 0:l.bank_name)||"",bank_account:(l==null?void 0:l.bank_account)||"",bank_swift:(l==null?void 0:l.bank_swift)||"",logo_url:(l==null?void 0:l.logo_url)||""},client:{name:(u==null?void 0:u.name)||p.client_name||"",address:(u==null?void 0:u.address)||"",city:(u==null?void 0:u.city)||"",country:(u==null?void 0:u.country)||"",phone:(u==null?void 0:u.phone)||"",email:(u==null?void 0:u.email)||"",vat_number:(u==null?void 0:u.vat_number)||"",contact_person:(u==null?void 0:u.contact_person)||""}};f(O)}catch{v.error("Failed to load invoice")}},B=async m=>{await T(m)},S=m=>{g(p=>p.find(u=>u.id===m.id)?p.map(u=>u.id===m.id?m:u):[m,...p]),s(null)};return c?e.jsx("div",{className:"p-8 space-y-3",children:[...Array(4)].map((m,p)=>e.jsx("div",{className:"animate-pulse h-12 bg-gray-100 rounded-xl"},p))}):e.jsxs("div",{className:"p-6",children:[e.jsxs("div",{className:"flex items-center justify-between mb-5",children:[e.jsxs("p",{className:"text-sm text-gray-500",children:[d.length," invoice",d.length!==1?"s":""]}),e.jsxs("button",{onClick:()=>s("new"),className:"flex items-center gap-2 px-4 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600",children:[e.jsx(U,{size:15})," New Invoice"]})]}),d.length===0?e.jsxs("div",{className:"text-center py-16 text-gray-400",children:[e.jsx(q,{size:40,className:"mx-auto mb-3 opacity-30"}),e.jsx("p",{className:"font-medium",children:"No invoices yet"}),e.jsx("p",{className:"text-sm mt-1",children:"Create your first invoice to get started"})]}):e.jsx("div",{className:"border border-gray-200 rounded-xl overflow-hidden",children:e.jsxs("table",{className:"w-full text-sm",children:[e.jsx("thead",{className:"bg-gray-50 border-b border-gray-200",children:e.jsxs("tr",{children:[e.jsx("th",{className:"text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider",children:"Number"}),e.jsx("th",{className:"text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider",children:"Client"}),e.jsx("th",{className:"text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider",children:"Company"}),e.jsx("th",{className:"text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider",children:"Date"}),e.jsx("th",{className:"text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider",children:"Status"}),e.jsx("th",{className:"text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider",children:"Total"}),e.jsx("th",{className:"px-4 py-3"})]})}),e.jsx("tbody",{children:d.map((m,p)=>{var l;return e.jsxs("tr",{className:`border-b border-gray-100 last:border-b-0 hover:bg-gray-50 ${p%2===0?"":"bg-gray-50/30"}`,children:[e.jsx("td",{className:"px-4 py-3 font-medium text-gray-900",children:m.invoice_number}),e.jsx("td",{className:"px-4 py-3 text-gray-600",children:m.client_name||"—"}),e.jsx("td",{className:"px-4 py-3 text-gray-600",children:m.company_name||"—"}),e.jsx("td",{className:"px-4 py-3 text-gray-500",children:m.issue_date}),e.jsx("td",{className:"px-4 py-3",children:e.jsx("span",{className:`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${be[m.status]||"bg-gray-100 text-gray-600"}`,children:m.status})}),e.jsxs("td",{className:"px-4 py-3 text-right font-semibold text-gray-900",children:[m.currency," ",(l=m.total)==null?void 0:l.toLocaleString(void 0,{minimumFractionDigits:2})]}),e.jsx("td",{className:"px-4 py-3",children:e.jsxs("div",{className:"flex items-center justify-end gap-1",children:[e.jsx("button",{onClick:()=>T(m),className:"p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg",title:"Preview",children:e.jsx(ae,{size:14})}),e.jsx("button",{onClick:()=>w(m.id),className:"p-1.5 text-gray-400 hover:text-monday-blue hover:bg-blue-50 rounded-lg",title:"Edit",children:e.jsx(Y,{size:14})}),e.jsx("button",{onClick:()=>$(m.id),className:"p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg",title:"Copy / Duplicate",children:e.jsx(pe,{size:14})}),e.jsx("button",{onClick:()=>B(m),className:"p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg",title:"Print / Save PDF",children:e.jsx(se,{size:14})}),e.jsx("button",{onClick:()=>b(m.id),className:"p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg",title:"Delete",children:e.jsx(G,{size:14})})]})})]},m.id)})})]})}),n&&e.jsx(je,{invoice:n==="new"?null:n,companies:t,clients:r,onClose:()=>s(null),onSaved:S}),o&&e.jsx(ne,{invoice:o,onClose:()=>f(null)})]})}function Ne({companies:t,setCompanies:r}){const[d,g]=j.useState(null),c=async n=>{if(confirm("Delete this company?"))try{await z.delete(`/invoices/my-companies/${n}`),r(s=>s.filter(o=>o.id!==n)),v.success("Company deleted")}catch{v.error("Failed to delete")}},k=n=>{r(s=>s.find(f=>f.id===n.id)?s.map(f=>f.id===n.id?n:f):[...s,n]),g(null)};return e.jsxs("div",{className:"p-6",children:[e.jsxs("div",{className:"flex items-center justify-between mb-5",children:[e.jsxs("p",{className:"text-sm text-gray-500",children:[t.length," compan",t.length!==1?"ies":"y"]}),e.jsxs("button",{onClick:()=>g("new"),className:"flex items-center gap-2 px-4 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600",children:[e.jsx(U,{size:15})," Add Company"]})]}),t.length===0?e.jsxs("div",{className:"text-center py-16 text-gray-400",children:[e.jsx(R,{size:40,className:"mx-auto mb-3 opacity-30"}),e.jsx("p",{className:"font-medium",children:"No companies yet"}),e.jsx("p",{className:"text-sm mt-1",children:"Add your company profile to start issuing invoices"})]}):e.jsx("div",{className:"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",children:t.map(n=>e.jsxs("div",{className:"bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow",children:[e.jsxs("div",{className:"flex items-start justify-between mb-3",children:[e.jsx("div",{className:"w-10 h-10 rounded-xl bg-monday-blue flex items-center justify-center flex-shrink-0",children:e.jsx(R,{size:18,className:"text-white"})}),e.jsxs("div",{className:"flex gap-1",children:[e.jsx("button",{onClick:()=>g(n),className:"p-1.5 text-gray-400 hover:text-monday-blue hover:bg-blue-50 rounded-lg",children:e.jsx(Y,{size:13})}),e.jsx("button",{onClick:()=>c(n.id),className:"p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg",children:e.jsx(G,{size:13})})]})]}),e.jsx("p",{className:"font-semibold text-gray-900 text-sm mb-1",children:n.name}),(n.city||n.country)&&e.jsx("p",{className:"text-xs text-gray-500",children:[n.city,n.country].filter(Boolean).join(", ")}),n.email&&e.jsx("p",{className:"text-xs text-gray-400 mt-0.5",children:n.email}),n.vat_number&&e.jsxs("p",{className:"text-xs text-gray-400 mt-0.5",children:["VAT: ",n.vat_number]})]},n.id))}),d&&e.jsx(ye,{company:d==="new"?null:d,onClose:()=>g(null),onSaved:k})]})}function ke({clients:t,setClients:r}){const[d,g]=j.useState(null),c=async n=>{if(confirm("Delete this client?"))try{await z.delete(`/invoices/clients/${n}`),r(s=>s.filter(o=>o.id!==n)),v.success("Client deleted")}catch{v.error("Failed to delete")}},k=n=>{r(s=>s.find(f=>f.id===n.id)?s.map(f=>f.id===n.id?n:f):[...s,n]),g(null)};return e.jsxs("div",{className:"p-6",children:[e.jsxs("div",{className:"flex items-center justify-between mb-5",children:[e.jsxs("p",{className:"text-sm text-gray-500",children:[t.length," client",t.length!==1?"s":""]}),e.jsxs("button",{onClick:()=>g("new"),className:"flex items-center gap-2 px-4 py-2 bg-monday-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600",children:[e.jsx(U,{size:15})," Add Client"]})]}),t.length===0?e.jsxs("div",{className:"text-center py-16 text-gray-400",children:[e.jsx(H,{size:40,className:"mx-auto mb-3 opacity-30"}),e.jsx("p",{className:"font-medium",children:"No clients yet"}),e.jsx("p",{className:"text-sm mt-1",children:"Add clients to include them on invoices"})]}):e.jsx("div",{className:"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",children:t.map(n=>e.jsxs("div",{className:"bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow",children:[e.jsxs("div",{className:"flex items-start justify-between mb-3",children:[e.jsx("div",{className:"w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0",children:e.jsx(H,{size:18,className:"text-purple-600"})}),e.jsxs("div",{className:"flex gap-1",children:[e.jsx("button",{onClick:()=>g(n),className:"p-1.5 text-gray-400 hover:text-monday-blue hover:bg-blue-50 rounded-lg",children:e.jsx(Y,{size:13})}),e.jsx("button",{onClick:()=>c(n.id),className:"p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg",children:e.jsx(G,{size:13})})]})]}),e.jsx("p",{className:"font-semibold text-gray-900 text-sm mb-1",children:n.name}),n.contact_person&&e.jsx("p",{className:"text-xs text-gray-500",children:n.contact_person}),(n.city||n.country)&&e.jsx("p",{className:"text-xs text-gray-500",children:[n.city,n.country].filter(Boolean).join(", ")}),n.email&&e.jsx("p",{className:"text-xs text-gray-400 mt-0.5",children:n.email}),n.vat_number&&e.jsxs("p",{className:"text-xs text-gray-400 mt-0.5",children:["VAT: ",n.vat_number]})]},n.id))}),d&&e.jsx(ve,{client:d==="new"?null:d,onClose:()=>g(null),onSaved:k})]})}function Ie(){const[t,r]=j.useState("invoices"),[d,g]=j.useState([]),[c,k]=j.useState([]),[n,s]=j.useState(!0);return j.useEffect(()=>{Promise.all([z.get("/invoices/my-companies"),z.get("/invoices/clients")]).then(([o,f])=>{g(o.data),k(f.data)}).catch(()=>v.error("Failed to load data")).finally(()=>s(!1))},[]),e.jsxs("div",{className:"flex flex-col h-full bg-gray-50",children:[e.jsxs("div",{className:"bg-white border-b border-gray-200 px-8 pt-6 pb-0 flex-shrink-0",children:[e.jsxs("div",{className:"flex items-center gap-3 mb-5",children:[e.jsx("div",{className:"w-9 h-9 rounded-xl bg-monday-blue flex items-center justify-center",children:e.jsx(q,{size:18,className:"text-white"})}),e.jsxs("div",{children:[e.jsx("h1",{className:"text-xl font-bold text-gray-900",children:"Invoices"}),e.jsx("p",{className:"text-xs text-gray-500",children:"Manage invoices, companies and clients"})]})]}),e.jsx("div",{className:"flex gap-1",children:fe.map(o=>e.jsxs("button",{onClick:()=>r(o.id),className:["flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors",t===o.id?"border-monday-blue text-monday-blue bg-blue-50/50":"border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"].join(" "),children:[o.icon," ",o.label]},o.id))})]}),e.jsx("div",{className:"flex-1 overflow-y-auto",children:n?e.jsx("div",{className:"p-8 space-y-3",children:[...Array(3)].map((o,f)=>e.jsx("div",{className:"animate-pulse h-10 bg-gray-100 rounded-xl"},f))}):e.jsxs(e.Fragment,{children:[t==="invoices"&&e.jsx(we,{companies:d,clients:c}),t==="companies"&&e.jsx(Ne,{companies:d,setCompanies:g}),t==="clients"&&e.jsx(ke,{clients:c,setClients:k})]})})]})}export{Ie as default};
