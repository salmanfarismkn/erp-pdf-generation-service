
CREATE TABLE IF NOT EXISTS pdf_jobs (
    id UUID PRIMARY KEY,
    job_type TEXT NOT NULL CHECK (job_type = 'bulk'),
    status TEXT NOT NULL CHECK (
        status IN (
            'queued',
            'processing',
            'completed',
            'completed_with_errors',
            'failed'
        )
    ),
    documents JSONB NOT NULL,
    total_documents INTEGER NOT NULL CHECK (
        total_documents BETWEEN 1 AND 100
    ),
    completed_documents INTEGER NOT NULL DEFAULT 0,
    failed_documents INTEGER NOT NULL DEFAULT 0,
    artifact_path TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    CHECK (
        completed_documents >= 0
        AND completed_documents <= total_documents
    ),
    CHECK (
        failed_documents >= 0
        AND failed_documents <= total_documents
    )
);

CREATE INDEX IF NOT EXISTS idx_pdf_jobs_status_created
    ON pdf_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_pdf_jobs_created
    ON pdf_jobs (created_at DESC);
