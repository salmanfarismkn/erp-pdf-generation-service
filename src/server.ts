
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { closeQueueConnections } from "./queue/bulk-queue.js";
const app = await buildApp();

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT,
  });
} catch (error) {
  app.log.error(error, "Failed to start PDF service");
  process.exit(1);
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");

  try {
    await app.close();
    await closeQueueConnections();
    await pool.end();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Graceful shutdown failed");
    process.exit(1);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
