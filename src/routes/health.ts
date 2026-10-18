
import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/health/live", async () => ({
    status: "ok",
  }));

  app.get("/health/ready", async (_request, reply) => {
    // Dependency checks will be added in a later level.
    return reply.code(200).send({
      status: "ok",
      dependencies: "not_checked_yet",
    });
  });
}
