
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildDocumentHtml } from "../src/documents/html.js";
import { documentSchema } from "../src/documents/schema.js";
import { env } from "../src/config/env.js";

const authHeaders = {
  "x-api-key": env.PDF_API_KEY,
  "x-tenant-id": "test-tenant",
};

const payload = {
  documentType: "invoice" as const,
  documentId: "INV-1001",
  issueDate: "2026-10-13",
  seller: {
    name: "Example Seller",
    address: "Jabalpur, Madhya Pradesh",
    gstin: "22AAAAA0000A1Z5",
  },
  buyer: {
    name: "Example Buyer",
    address: "Bhopal, Madhya Pradesh",
  },
  lineItems: [
    {
      description: "Office supplies",
      quantity: 2,
      unitPricePaise: 10_000,
      gstRateBps: 1800,
    },
  ],
};

describe("document generation", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("validates a valid invoice payload", () => {
    expect(documentSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects a document with no line items", () => {
    const invalid = { ...payload, lineItems: [] };

    expect(documentSchema.safeParse(invalid).success).toBe(false);
  });

  it("escapes HTML in customer-controlled text", () => {
    const html = buildDocumentHtml({
      ...payload,
      buyer: {
        ...payload.buyer,
        name: '<img src=x onerror="alert(1)">',
      },
    });

    expect(html).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(html).not.toContain(
      '<img src=x onerror="alert(1)">',
    );
  });

  it("returns a PDF download for a valid request", async () => {
    app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/documents/pdf",
      headers: authHeaders,
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/pdf",
    );
    expect(response.headers["content-disposition"]).toContain(
      "invoice-INV-1001.pdf",
    );
    expect(response.body).toMatch(/^%PDF-\d\.\d/);
  });

  it("returns 400 for an invalid request", async () => {
    app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/documents/pdf",
      headers: authHeaders,
      payload: {
        ...payload,
        documentId: "../unsafe",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("INVALID_DOCUMENT");
  });

  it("requires a valid tenant and idempotency key for batch requests", async () => {
    app = await buildApp();

    const badTenant = await app.inject({
      method: "POST",
      url: "/v1/batches",
      headers: {
        "x-api-key": env.PDF_API_KEY,
        "x-tenant-id": "bad tenant",
        "idempotency-key": "abc-123",
      },
      payload: { documents: [payload] },
    });

    expect(badTenant.statusCode).toBe(401);
    expect(badTenant.json().error).toBe("UNAUTHORIZED");

    const missingIdempotency = await app.inject({
      method: "POST",
      url: "/v1/batches",
      headers: {
        "x-api-key": env.PDF_API_KEY,
        "x-tenant-id": "test-tenant",
      },
      payload: { documents: [payload] },
    });

    expect(missingIdempotency.statusCode).toBe(400);
    expect(missingIdempotency.json().error).toBe("INVALID_IDEMPOTENCY_KEY");
  });
});
