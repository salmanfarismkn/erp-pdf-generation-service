
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum([
    "development",
    "test",
    "production",
  ]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  STORAGE_DIR: z.string().default("./storage"),
  PDF_API_KEY: z.string().min(32),
  PDF_SIGNING_PRIVATE_KEY_PATH: z.string().min(1),
  PDF_SIGNING_PUBLIC_KEY_PATH: z.string().min(1),
});

export const env = envSchema.parse(process.env);
