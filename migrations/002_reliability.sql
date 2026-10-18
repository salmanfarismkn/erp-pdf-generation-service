
ALTER TABLE pdf_jobs
    ADD COLUMN IF NOT EXISTS tenant_id TEXT
        NOT NULL DEFAULT 'development',
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pdf_jobs_tenant_idempotency
    ON pdf_jobs (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pdf_jobs_tenant_created
    ON pdf_jobs (tenant_id, created_at DESC);
