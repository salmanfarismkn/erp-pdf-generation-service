
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { documentSchema } from "../documents/schema.js";
import type { DocumentPayload } from "../documents/schema.js";
import { pool } from "../db/pool.js";
import { getBulkQueue } from "../queue/bulk-queue.js";
import { env } from "../config/env.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { canonicalJson } from "../utils/canonical-json.js";

const bulkStorageRoot = resolve(env.STORAGE_DIR, "jobs");
const tenantIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeHeader(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const absoluteCandidate = resolve(candidate);
  const absoluteRoot = resolve(root);
  const relativePath = relative(absoluteRoot, absoluteCandidate);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

export async function registerBulkRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/v1/batches", async (request, reply) => {
    const body = request.body as { documents?: unknown } | null;

    if (
      !body ||
      !Array.isArray(body.documents) ||
      body.documents.length < 1 ||
      body.documents.length > 100
    ) {
      return reply.code(400).send({
        error: "INVALID_BATCH",
        message: "Provide between 1 and 100 documents",
      });
    }

    const documents: DocumentPayload[] = [];

    for (let i = 0; i < body.documents.length; i++) {
      const parsed = documentSchema.safeParse(body.documents[i]);

      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_DOCUMENT",
          index: i,
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      documents.push(parsed.data);
    }


    const tenantId = normalizeHeader(request.headers["x-tenant-id"]);
    const idempotencyKey = normalizeHeader(request.headers["idempotency-key"]);

    if (!tenantId || !tenantIdPattern.test(tenantId)) {
      return reply.code(401).send({
        error: "TENANT_REQUIRED",
        message: "Provide a valid x-tenant-id header",
      });
    }

    if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey)) {
      return reply.code(400).send({
        error: "INVALID_IDEMPOTENCY_KEY",
        message: "Provide a valid idempotency-key header",
      });
    }

    const client = await pool.connect();

    let jobId: string;
    let reused = false;

    try {
      await client.query("BEGIN");

      const inserted = await client.query(
        `INSERT INTO pdf_jobs
          (id, tenant_id, idempotency_key, job_type,
            status, documents, total_documents)
        VALUES ($1, $2, $3, 'bulk', 'queued', $4::jsonb, $5)
        ON CONFLICT (tenant_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
        DO NOTHING
        RETURNING id, status, total_documents`,
        [
          randomUUID(),
          tenantId,
          idempotencyKey,
          JSON.stringify(documents),
          documents.length,
        ],
      );

      if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT id, status, total_documents, documents
          FROM pdf_jobs
          WHERE tenant_id = $1
            AND idempotency_key = $2`,
          [tenantId, idempotencyKey],
        );

        const previous = existing.rows[0];

        if (!previous) {
          throw new Error("Idempotency record not found");
        }

        // Prevent different payloads from reusing the same key.
        if (
          canonicalJson(previous.documents) !== canonicalJson(documents)
        ) {
          await client.query("ROLLBACK");

          return reply.code(409).send({
            error: "IDEMPOTENCY_KEY_REUSED",
            message: "Use a new key for a different batch payload",
          });
        }

        jobId = previous.id;
        reused = true;
      } else {
        const created = inserted.rows[0];

        jobId = created.id;

        await client.query(
          `INSERT INTO pdf_outbox
            (event_type, aggregate_id, payload)
          VALUES ('bulk_pdf_requested', $1, $2::jsonb)`,
          [
            jobId,
            JSON.stringify({
              jobId,
            }),
          ],
        );
      }

      await client.query("COMMIT");

      const status = await pool.query(
        `SELECT status, total_documents
        FROM pdf_jobs
        WHERE id = $1
          AND tenant_id = $2`,
        [jobId, tenantId],
      );

      return reply.code(reused ? 200 : 202).send({
        jobId,
        status: status.rows[0].status,
        totalDocuments: status.rows[0].total_documents,
        statusUrl: `/v1/batches/${jobId}`,
        reused,
      });
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch(() => undefined);

      request.log.error(
        { err: error },
        "Batch transaction failed",
      );

      return reply.code(503).send({
        error: "BATCH_SUBMISSION_FAILED",
        message: "The batch could not be persisted",
      });
    } finally {
      client.release();
    }
  });

  app.get<{ Params: { jobId: string } }>(
    "/v1/batches/:jobId",
    async (request, reply) => {
      const { jobId } = request.params;

      if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return reply.code(400).send({ error: "INVALID_JOB_ID" });
      }
      const tenantId = normalizeHeader(request.headers["x-tenant-id"]);

      if (!tenantId || !tenantIdPattern.test(tenantId)) {
        return reply.code(401).send({ error: "TENANT_REQUIRED" });
      }
      const result = await pool.query(
        `SELECT id, status, total_documents,
              completed_documents, failed_documents,
              error_message, created_at, started_at, completed_at
        FROM pdf_jobs
        WHERE id = $1 AND tenant_id = $2`,
        [jobId, tenantId],
      );

      const job = result.rows[0];

      if (!job) {
        return reply.code(404).send({ error: "JOB_NOT_FOUND" });
      }

      return {
        jobId: job.id,
        status: job.status,
        totalDocuments: job.total_documents,
        completedDocuments: job.completed_documents,
        failedDocuments: job.failed_documents,
        progressPercent: Math.floor(
          ((job.completed_documents + job.failed_documents) /
            job.total_documents) * 100,
        ),
        error: job.error_message,
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        downloadUrl: [
          "completed",
          "completed_with_errors",
        ].includes(job.status)
          ? `/v1/batches/${job.id}/download`
          : null,
      };
    },
  );

  app.get<{ Params: { jobId: string } }>(
    "/v1/batches/:jobId/download",
    async (request, reply) => {
      const { jobId } = request.params;

      if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return reply.code(400).send({ error: "INVALID_JOB_ID" });
      }
      const tenantId = normalizeHeader(request.headers["x-tenant-id"]);

      if (!tenantId || !tenantIdPattern.test(tenantId)) {
        return reply.code(401).send({ error: "TENANT_REQUIRED" });
      }
      const result = await pool.query(
        `SELECT status, artifact_path
         FROM pdf_jobs
         WHERE id = $1 AND tenant_id = $2`,
        [jobId, tenantId],
      );

      const job = result.rows[0];

      if (!job) {
        return reply.code(404).send({ error: "JOB_NOT_FOUND" });
      }

      if (
        !["completed", "completed_with_errors"].includes(job.status) ||
        !job.artifact_path
      ) {
        return reply.code(409).send({
          error: "ARTIFACT_NOT_READY",
          status: job.status,
        });
      }

      const artifactPath = resolve(job.artifact_path);

      if (!isPathInsideRoot(artifactPath, bulkStorageRoot)) {
        request.log.error({ jobId }, "Artifact path outside storage root");
        return reply.code(500).send({ error: "INVALID_ARTIFACT_PATH" });
      }

      try {
        await stat(artifactPath);
      } catch {
        return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
      }


      const fileInfo = await stat(artifactPath);
      const fileSize = fileInfo.size;
      const range = request.headers.range;

      reply
        .header("Content-Type", "application/zip")
        .header(
          "Content-Disposition",
          `attachment; filename="batch-${jobId}.zip"`,
        )
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "private, no-store");

      if (!range) {
        return reply
          .header("Content-Length", String(fileSize))
          .code(200)
          .send(createReadStream(artifactPath));
      }

      const match = /^bytes=(\d*)-(\d*)$/.exec(range);

      if (!match || (!match[1] && !match[2])) {
        return reply
          .header("Content-Range", `bytes */${fileSize}`)
          .code(416)
          .send();
      }

      let start: number;
      let end: number;

      if (!match[1]) {
        const suffixLength = Number(match[2]);

        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
          return reply
            .header("Content-Range", `bytes */${fileSize}`)
            .code(416)
            .send();
        }

        start = Math.max(0, fileSize - suffixLength);
        end = fileSize - 1;
      } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : fileSize - 1;
      }

      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= fileSize ||
        end < start
      ) {
        return reply
          .header("Content-Range", `bytes */${fileSize}`)
          .code(416)
          .send();
      }

      end = Math.min(end, fileSize - 1);

      return reply
        .header("Content-Range", `bytes ${start}-${end}/${fileSize}`)
        .header("Content-Length", String(end - start + 1))
        .code(206)
        .send(createReadStream(artifactPath, { start, end }));

    },
  );
}
