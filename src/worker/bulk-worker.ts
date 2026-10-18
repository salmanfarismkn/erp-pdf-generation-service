
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { basename, join, resolve } from "node:path";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { renderPdf, closeRenderer } from "../pdf/renderer.js";
import type { DocumentPayload } from "../documents/schema.js";
import { getBulkQueue } from "../queue/bulk-queue.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { sha256 } from "../compliance/manifest.js";
import {
  createBatchArchive,
  type FailedDocument,
} from "./batch-archive.js";

const bulkQueue = getBulkQueue();

const root = resolve(env.STORAGE_DIR, "jobs");

interface BulkJobData {
  jobId: string;
}

async function processBulk(jobId: string): Promise<void> {
  const result = await pool.query(
    `SELECT status, documents, total_documents
     FROM pdf_jobs
     WHERE id = $1
     FOR UPDATE`,
    [jobId],
  );

  const job = result.rows[0];

  if (!job) {
    throw new Error(`Database record missing for job ${jobId}`);
  }

  if (["completed", "completed_with_errors"].includes(job.status)) {
    return;
  }

  const documents = job.documents as DocumentPayload[];
  const jobDir = join(root, jobId);
  const zipPath = join(jobDir, `batch-${jobId}.zip`);

  await mkdir(root, { recursive: true });

  // A retry starts from a clean artifact directory.
  await rm(jobDir, { recursive: true, force: true });
  await mkdir(jobDir, { recursive: true });

  await pool.query(
    `UPDATE pdf_jobs
     SET status = 'processing',
         started_at = COALESCE(started_at, NOW()),
         completed_documents = 0,
         failed_documents = 0,
         error_message = NULL,
         artifact_path = NULL
     WHERE id = $1
       AND status IN ('queued', 'processing', 'failed')`,
    [jobId],
  );

  const pdfFiles: Array<{
    path: string;
    name: string;
    documentId: string;
    sizeBytes: number;
    sha256: string;
  }> = [];
  const failures: FailedDocument[] = [];

  try {
    for (let index = 0; index < documents.length; index++) {
      const document = documents[index]!;

      try {

        const pdf = await renderPdf(document);

        const filename =
          `${String(index + 1).padStart(3, "0")}-` +
          `${document.documentType}-${document.documentId}.pdf`;

        const outputPath = join(jobDir, basename(filename));

        await writeFile(outputPath, pdf, { flag: "wx" });

        pdfFiles.push({
          path: outputPath,
          name: filename,
          documentId: document.documentId,
          sizeBytes: pdf.length,
          sha256: sha256(pdf),
        });
      } catch (error) {
        failures.push({
          documentId: document.documentId,
          error: error instanceof Error
            ? error.message.slice(0, 500)
            : "Unknown rendering error",
        });
      }

      await pool.query(
        `UPDATE pdf_jobs
         SET completed_documents = $2,
             failed_documents = $3
         WHERE id = $1`,
        [jobId, pdfFiles.length, failures.length],
      );

      await workerConnection.publish(
        `pdf-batch-progress:${jobId}`,
        JSON.stringify({
          completedDocuments: pdfFiles.length,
          failedDocuments: failures.length,
          totalDocuments: documents.length,
        }),
      );
    }



    await createBatchArchive(jobId, zipPath, pdfFiles, failures);

    await pool.query(
      `UPDATE pdf_jobs
       SET status = $2,
           artifact_path = $3,
           completed_at = NOW()
       WHERE id = $1`,
      [
        jobId,
        failures.length > 0 ? "completed_with_errors" : "completed",
        zipPath,
      ],
    );
  } catch (error) {
    await pool.query(
      `UPDATE pdf_jobs
       SET status = 'failed',
           error_message = $2,
           completed_at = NOW()
       WHERE id = $1`,
      [
        jobId,
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Unknown bulk processing error",
      ],
    );

    throw error;
  }
}

const workerConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

const worker = new Worker<BulkJobData>(
  "pdf-bulk",
  async (job) => {
    await processBulk(job.data.jobId);
  },
  {
    connection: workerConnection,
    concurrency: 1,
  },
);

worker.on("completed", (job) => {
  console.info("Bulk job completed", job.id);
});

worker.on("failed", async (job, error) => {
  console.error("Bulk queue attempt failed", job?.id, error);

  if (
    !job ||
    job.attemptsMade < (job.opts.attempts ?? 1)
  ) {
    return;
  }

  await pool.query(
    `UPDATE pdf_jobs
     SET status = 'failed',
         error_message = $2,
         completed_at = NOW()
     WHERE id = $1
       AND status NOT IN (
         'completed',
         'completed_with_errors'
       )`,
    [
      job.data.jobId,
      error.message.slice(0, 1000),
    ],
  ).catch((dbError) => {
    console.error("Could not persist terminal job failure", dbError);
  });
});

async function recoverQueuedJobs(): Promise<void> {
  const result = await pool.query(
    `SELECT id, status
     FROM pdf_jobs
     WHERE status IN ('queued', 'processing')
     ORDER BY created_at ASC`,
  );

  for (const row of result.rows) {
    const existing = await bulkQueue.getJob(row.id);

    if (row.status === "processing" && !existing) {
      await pool.query(
        `UPDATE pdf_jobs
         SET status = 'queued',
             error_message = NULL
         WHERE id = $1
           AND status = 'processing'`,
        [row.id],
      );
    }

    if (!existing) {
      await bulkQueue.add(
        "process-bulk",
        { jobId: row.id },
        { jobId: row.id },
      );
    }
  }
}

async function shutdown(): Promise<void> {
  await worker.close();
  await workerConnection.quit();
  await bulkQueue.close();
  await closeRenderer();
  await pool.end();
}

worker.waitUntilReady()
  .then(recoverQueuedJobs)
  .then(() => console.info("Bulk PDF worker ready"))
  .catch((error) => {
    console.error("Worker startup failed", error);
    process.exitCode = 1;
  });

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
