
import { pool } from "../db/pool.js";
import { getBulkQueue, closeQueueConnections } from "../queue/bulk-queue.js";

async function dispatchOnce(): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT id, aggregate_id, payload
       FROM pdf_outbox
       WHERE published_at IS NULL
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT 20`,
    );

    for (const event of result.rows) {
      try {
        await getBulkQueue().add(
          "process-bulk",
          event.payload,
          { jobId: event.aggregate_id },
        );

        await client.query(
          `UPDATE pdf_outbox
           SET published_at = NOW(),
               attempts = attempts + 1,
               last_error = NULL
           WHERE id = $1`,
          [event.id],
        );
      } catch (error) {
        await client.query(
          `UPDATE pdf_outbox
           SET attempts = attempts + 1,
               last_error = $2
           WHERE id = $1`,
          [
            event.id,
            error instanceof Error
              ? error.message.slice(0, 1000)
              : "Unknown queue publication error",
          ],
        );

        // Keep the event pending for the next dispatch cycle.
        // Avoid spinning continuously on a Redis failure.
        break;
      }
    }

    await client.query("COMMIT");
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

let stopping = false;

async function main(): Promise<void> {
  console.info("Outbox dispatcher starting");

  while (!stopping) {
    try {
      const count = await dispatchOnce();

      if (count === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error("Outbox dispatch failed", error);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function shutdown(): Promise<void> {
  stopping = true;

  await closeQueueConnections();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

void main().catch((error) => {
  console.error("Dispatcher terminated", error);
  process.exitCode = 1;
});
