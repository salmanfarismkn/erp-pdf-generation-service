import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";

import { env } from "./config/env.js";
import { closeRenderer } from "./pdf/renderer.js";
import { registerHealthRoutes } from "./routes/health.js";
import {
  registerDocumentRoutes,
  type PdfRenderer,
} from "./routes/documents.js";
import { registerBulkRoutes } from "./routes/bulk.js";

interface AppOptions {
  renderPdf?: PdfRenderer;
}

export async function buildApp(
  options: AppOptions = {},
) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-api-key",
      ],
    },
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 45_000,
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) {
      return;
    }

    const apiKey = request.headers["x-api-key"];
    const tenantId = request.headers["x-tenant-id"];

    if (
      typeof apiKey !== "string" ||
      typeof tenantId !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)
    ) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
      });
    }

    const received = Buffer.from(apiKey);
    const expected = Buffer.from(env.PDF_API_KEY);

    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
      });
    }
  });

  await registerHealthRoutes(app);

  if (options.renderPdf) {
    await registerDocumentRoutes(app, {
      render: options.renderPdf,
    });
  } else {
    await registerDocumentRoutes(app);

    app.addHook("onClose", async () => {
      await closeRenderer();
    });
  }

  await registerBulkRoutes(app);

  return app;
}
