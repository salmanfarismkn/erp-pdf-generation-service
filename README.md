# ERP PDF Generation Microservice

This project is a small backend service for generating purchase-order and invoice PDFs. It includes a Fastify API, PostgreSQL-backed job tracking, a transactional outbox, Redis/BullMQ bulk job processing, Puppeteer-based HTML-to-PDF rendering, and signed ZIP archives for bulk exports.

The repository is intentionally pragmatic: it preserves a working portfolio architecture and avoids unnecessary features.

## Verified status

The following checks were executed in this workspace and passed:

- `npm test` -> 3 test files, 10 tests passed
- `npm run build` -> TypeScript compilation succeeded

These are the only execution results recorded here because they were directly observed in this session.

## Local setup

### 1. Install dependencies

```powershell
cd C:\Users\salma\erp-pdf-service
npm install
```

### 2. Configure environment variables

Copy the example file and fill in the values for your local machine.

```powershell
cd C:\Users\salma\erp-pdf-service
Copy-Item .env.example .env
```

At minimum, `.env` should contain values for:

- `NODE_ENV`
- `HOST`
- `PORT`
- `LOG_LEVEL`
- `DATABASE_URL`
- `REDIS_URL`
- `STORAGE_DIR`
- `PDF_API_KEY`
- `PDF_SIGNING_PRIVATE_KEY_PATH`
- `PDF_SIGNING_PUBLIC_KEY_PATH`

Do not commit `.env` files or private key material. Keep secrets outside the repository.

### 3. Start PostgreSQL and Redis

```powershell
cd C:\Users\salma\erp-pdf-service
docker compose up -d postgres redis
```

### 4. Generate signing keys

```powershell
cd C:\Users\salma\erp-pdf-service
node .\scripts\generate-signing-keys.mjs
```

This creates local Ed25519 key files under `./keys/`.

### 5. Apply database migrations

```powershell
cd C:\Users\salma\erp-pdf-service
$env:DATABASE_URL = "postgresql://pdf_user:local_dev_password@localhost:5433/pdf_service"
Get-ChildItem .\migrations | Sort-Object Name | ForEach-Object {
  psql $env:DATABASE_URL -f $_.FullName
}
```

If `psql` is not installed on the machine, use the PostgreSQL container directly.

## Exact PowerShell commands to run the complete service locally

Open three terminals and run the following commands.

### Terminal 1: API

```powershell
cd C:\Users\salma\erp-pdf-service
npm run dev
```

### Terminal 2: bulk worker

```powershell
cd C:\Users\salma\erp-pdf-service
npm run dev:worker
```

### Terminal 3: transactional outbox dispatcher

```powershell
cd C:\Users\salma\erp-pdf-service
npm run dev:outbox
```

Optional: run the full build or tests without starting the services.

```powershell
cd C:\Users\salma\erp-pdf-service
npm run build
npm test
```

## API overview

### Single-document PDF generation

`POST /v1/documents/pdf`

Headers:

- `x-api-key`
- `x-tenant-id`

Example:

```powershell
$headers = @{
  "x-api-key" = $env:PDF_API_KEY
  "x-tenant-id" = "tenant-demo"
}

$payload = @{
  documentType = "invoice"
  documentId = "INV-1001"
  issueDate = "2026-10-13"
  seller = @{
    name = "Example Seller"
    address = "Jabalpur, Madhya Pradesh"
    gstin = "22AAAAA0000A1Z5"
  }
  buyer = @{
    name = "Example Buyer"
    address = "Bhopal, Madhya Pradesh"
  }
  lineItems = @(
    @{
      description = "Office supplies"
      quantity = 2
      unitPricePaise = 10000
      gstRateBps = 1800
    }
  )
} | ConvertTo-Json -Depth 20

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/v1/documents/pdf" -Headers $headers -ContentType "application/json" -Body $payload -OutFile ".\invoice.pdf"
```

### Bulk batch creation

`POST /v1/batches`

Headers:

- `x-api-key`
- `x-tenant-id`
- `idempotency-key`

Example:

```powershell
$headers = @{
  "x-api-key" = $env:PDF_API_KEY
  "x-tenant-id" = "tenant-demo"
  "idempotency-key" = "batch-demo-001"
}

$batch = @{
  documents = @(
    $payload,
    $payload
  )
} | ConvertTo-Json -Depth 20

Invoke-RestMethod -Method Post -Uri "http://localhost:3000/v1/batches" -Headers $headers -ContentType "application/json" -Body $batch
```

### Batch status

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/v1/batches/<job-id>" -Headers @{ "x-api-key" = $env:PDF_API_KEY; "x-tenant-id" = "tenant-demo" }
```

### Batch download

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/v1/batches/<job-id>/download" -Headers @{ "x-api-key" = $env:PDF_API_KEY; "x-tenant-id" = "tenant-demo" } -OutFile ".\batch.zip"
```

## Architecture

The project uses the following real runtime components:

- Fastify API for HTTP endpoints
- PostgreSQL for job state, idempotency, and outbox records
- Redis + BullMQ for asynchronous bulk work queues
- Puppeteer + Chromium for PDF rendering from HTML payloads
- worker process for batch rendering
- ZIP generation with `manifest.json` and `manifest.sig`
- Ed25519 signing for manifest integrity

See [docs/architecture.mmd](./docs/architecture.mmd) for the architecture diagram.

## Project structure

- `src/app.ts` - application bootstrap
- `src/routes/documents.ts` - single-document PDF endpoint
- `src/routes/bulk.ts` - batch submission, status, and ZIP download endpoints
- `src/pdf/renderer.ts` - concurrency-limited PDF renderer
- `src/worker/bulk-worker.ts` - bulk processing worker
- `src/worker/outbox-dispatcher.ts` - dispatches pending outbox events to BullMQ
- `src/worker/batch-archive.ts` - ZIP and signed manifest assembly
- `src/compliance/manifest.ts` - hashing and signature helpers
- `migrations/` - PostgreSQL schema definitions
- `scripts/` - local utilities for signing keys, verification, and smoke tests

## Testing

Run the automated suite:

```powershell
cd C:\Users\salma\erp-pdf-service
npm test
```

Build check:

```powershell
cd C:\Users\salma\erp-pdf-service
npm run build
```

Additional smoke scripts may be useful for manual validation:

```powershell
cd C:\Users\salma\erp-pdf-service
node .\scripts\large-document-test.mjs
node .\scripts\load-test.mjs
node .\scripts\verify-manifest.mjs .\storage\jobs\<job-id>
```

## Known limitations

- The health endpoint does not yet validate PostgreSQL or Redis availability.
- The service relies on simple header-based tenant and API-key checks rather than a richer auth layer.
- The project is a working backend service and portfolio artifact, not a production-hardened platform.
- The bulk worker and outbox dispatcher must be running in parallel for asynchronous jobs to execute.
- Manual verification scripts are not part of the automated test suite and should be treated as smoke tests rather than guaranteed coverage.

## Security notes

- Keep `.env` and any private key files outside version control.
- Never store production secrets in the repository.
- Only signed manifests should be trusted for ZIP integrity validation.
