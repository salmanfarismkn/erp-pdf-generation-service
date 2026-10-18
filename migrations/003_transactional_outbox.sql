
CREATE TABLE IF NOT EXISTS pdf_outbox (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL CHECK (
        event_type IN ('bulk_pdf_requested')
    ),
    aggregate_id UUID NOT NULL REFERENCES pdf_jobs(id),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_pdf_outbox_pending
    ON pdf_outbox (id)
    WHERE published_at IS NULL;

-- A job should have only one initial enqueue event.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pdf_outbox_job_event
    ON pdf_outbox (aggregate_id, event_type);
