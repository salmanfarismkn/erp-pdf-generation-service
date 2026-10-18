
import type { FastifyInstance } from "fastify";
import { documentSchema } from "../documents/schema.js";
import {
  renderPdf,
  RendererBusyError,
} from "../pdf/renderer.js";

export type PdfRenderer = (
  document: ReturnType<typeof documentSchema.parse>,
) => Promise<Buffer>;

interface DocumentRouteOptions {
  render: PdfRenderer;
}

export async function registerDocumentRoutes(
  app: FastifyInstance,
  options: DocumentRouteOptions = { render: renderPdf },
): Promise<void> {
  app.post("/v1/documents/pdf", async (request, reply) => {
    const parsed = documentSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_DOCUMENT",
        message: "The document payload is invalid",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    try {
      const pdf = await options.render(parsed.data);

      return reply
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="${parsed.data.documentType}-${parsed.data.documentId}.pdf"`,
        )
        .header("Cache-Control", "private, no-store")
        .send(pdf);
    } catch (error) {
      if (error instanceof RendererBusyError) {
        return reply
          .header("Retry-After", "2")
          .code(503)
          .send({
            error: "RENDERER_BUSY",
            message: "Retry the request shortly",
          });
      }

      request.log.error(
        { err: error, documentId: parsed.data.documentId },
        "PDF generation failed",
      );

      return reply.code(500).send({
        error: "PDF_GENERATION_FAILED",
        message: "The PDF could not be generated",
      });
    }
  });
}
