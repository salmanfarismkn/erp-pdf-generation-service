
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const baseUrl = process.env.PDF_BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.PDF_API_KEY;
const tenantId = process.env.PDF_TENANT_ID ?? "development";
const endpoint = new URL(
  "/v1/documents/pdf",
  baseUrl
);

if (!apiKey) {
  throw new Error("Set PDF_API_KEY before running this test.");
}

const document = JSON.parse(
  await readFile("sample-invoice.json", "utf8")
);

if (!Array.isArray(document.lineItems) || document.lineItems.length === 0) {
  throw new Error(
    "Expected sample-invoice.json to contain a nonempty lineItems array."
  );
}

const template = document.lineItems[0];

document.lineItems = Array.from({ length: 600 }, (_, index) => ({
  ...template,
  description: `Large document test item ${String(index + 1).padStart(4, "0")}`,
}));

console.log(`Testing ${document.lineItems.length} line items...`);

const started = performance.now();

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "x-tenant-id": tenantId,
  },
  body: JSON.stringify(document),
  signal: AbortSignal.timeout(60000),
});

const elapsedMs = Math.round(performance.now() - started);

if (!response.ok) {
  console.error(`HTTP ${response.status}: ${await response.text()}`);
  process.exitCode = 1;
} else {
  const pdf = Buffer.from(await response.arrayBuffer());

  if (
    pdf.length < 5 ||
    pdf.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new Error("The response is not a valid PDF file.");
  }

  console.log({
    status: response.status,
    lineItems: document.lineItems.length,
    pdfBytes: pdf.length,
    elapsedMs,
    validPdfHeader: true,
  });
}
