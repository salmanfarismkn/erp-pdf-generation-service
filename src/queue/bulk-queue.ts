
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

let redisConnection: Redis | undefined;
let bulkQueue: Queue | undefined;

export function getRedisConnection(): Redis {
  redisConnection ??= new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  return redisConnection;
}

export function getBulkQueue(): Queue {
  bulkQueue ??= new Queue("pdf-bulk", {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2_000,
      },
      removeOnComplete: {
        age: 86_400,
        count: 1_000,
      },
      removeOnFail: false,
    },
  });

  return bulkQueue;
}

export async function closeQueueConnections(): Promise<void> {
  await bulkQueue?.close();
  bulkQueue = undefined;

  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = undefined;
  }
}
