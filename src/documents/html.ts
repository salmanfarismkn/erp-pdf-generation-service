
import type { DocumentPayload } from "./schema.js";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char]!;
  });
}

function money(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);
}

function quantity(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function partyHtml(
  title: string,
  party: DocumentPayload["seller"],
): string {
  return `
    <section class="party">
      <h2>${title}</h2>
      <strong>${escapeHtml(party.name)}</strong>
      <p>${escapeHtml(party.address).replace(/\n/g, "<br>")}</p>
      ${party.gstin
        ? `<p>GSTIN: ${escapeHtml(party.gstin)}</p>`
        : ""}
    </section>
  `;
}

export function buildDocumentHtml(
  document: DocumentPayload,
): string {
  let subtotalPaise = 0;
  let taxPaise = 0;

  const rows = document.lineItems.map((item, index) => {
    const amount = Math.round(
      item.quantity * item.unitPricePaise,
    );
    const tax = Math.round(
      amount * item.gstRateBps / 10_000,
    );

    subtotalPaise += amount;
    taxPaise += tax;

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.description)}</td>
        <td class="number">${quantity(item.quantity)}</td>
        <td class="number">${money(item.unitPricePaise)}</td>
        <td class="number">${item.gstRateBps / 100}%</td>
        <td class="number">${money(amount)}</td>
        <td class="number">${money(tax)}</td>
        <td class="number">${money(amount + tax)}</td>
      </tr>
    `;
  }).join("");

  const totalPaise = subtotalPaise + taxPaise;
  const isInvoice = document.documentType === "invoice";
  const title = isInvoice ? "GST TAX INVOICE" : "PURCHASE ORDER";

  const extraDate = isInvoice
    ? document.dueDate
      ? `<p>Due date: ${escapeHtml(document.dueDate)}</p>`
      : ""
    : document.expectedDeliveryDate
      ? `<p>Expected delivery: ${escapeHtml(document.expectedDeliveryDate)}</p>`
      : "";

  const notes = document.notes
    ? `<section class="notes">
         <h2>Notes</h2>
         <p>${escapeHtml(document.notes).replace(/\n/g, "<br>")}</p>
       </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - ${escapeHtml(document.documentId)}</title>
  <style>
    @page { size: A4; margin: 15mm 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #20242a;
      font-size: 10px;
      line-height: 1.45;
    }
    h1 { font-size: 22px; margin: 0; }
    h2 { font-size: 11px; margin: 0 0 7px; }
    .header {
      display: flex; justify-content: space-between;
      align-items: flex-start; border-bottom: 2px solid #333;
      padding-bottom: 14px; margin-bottom: 16px;
    }
    .meta { text-align: right; }
    .parties {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 20px; margin-bottom: 18px;
    }
    .party { overflow-wrap: anywhere; }
    p { margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td {
      border: 1px solid #d8dce1; padding: 5px 4px;
      vertical-align: top;
    }
    th { background: #f1f3f5; text-align: left; }
    .number { text-align: right; white-space: nowrap; }
    .description { width: 30%; overflow-wrap: anywhere; }
    .totals {
      margin: 14px 0 0 auto; width: 260px;
    }
    .total-row {
      display: flex; justify-content: space-between;
      padding: 4px 0; gap: 12px;
    }
    .grand-total {
      border-top: 2px solid #333;
      font-size: 13px; font-weight: bold; padding-top: 8px;
    }
    .notes { margin-top: 24px; overflow-wrap: anywhere; }
    .footer {
      margin-top: 30px; border-top: 1px solid #ccc;
      padding-top: 8px; font-size: 9px;
    }
  </style>
</head>
<body>
  <header class="header">
    <div>
      <h1>${title}</h1>
      <p>Document ID: ${escapeHtml(document.documentId)}</p>
    </div>
    <div class="meta">
      <p>Issue date: ${escapeHtml(document.issueDate)}</p>
      ${extraDate}
    </div>
  </header>

  <div class="parties">
    ${partyHtml("Seller", document.seller)}
    ${partyHtml("Buyer", document.buyer)}
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th><th class="description">Description</th>
        <th>Qty</th><th>Unit price</th><th>GST</th>
        <th>Subtotal</th><th>Tax</th><th>Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <section class="totals">
    <div class="total-row">
      <span>Subtotal</span><strong>${money(subtotalPaise)}</strong>
    </div>
    <div class="total-row">
      <span>GST</span><strong>${money(taxPaise)}</strong>
    </div>
    <div class="total-row grand-total">
      <span>Total</span><strong>${money(totalPaise)}</strong>
    </div>
  </section>

  ${notes}
  <footer class="footer">
    Generated by ERP PDF Service. Document ID:
    ${escapeHtml(document.documentId)}
  </footer>
</body>
</html>`;
}
