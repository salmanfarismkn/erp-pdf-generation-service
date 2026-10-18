
import {
  createHash,
  sign,
  verify,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";

export interface ManifestFile {
  documentId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
}


export interface BatchManifest {
  schemaVersion: 1;
  algorithm: "Ed25519";
  jobId: string;
  generatedAt: string;
  files: ManifestFile[];
  failures: Array<{
    documentId: string;
    error: string;
  }>;
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function signManifest(
  manifestBytes: Buffer,
): Promise<Buffer> {
  const privateKey = await readFile(
    env.PDF_SIGNING_PRIVATE_KEY_PATH,
  );

  return sign(null, manifestBytes, privateKey);
}

export async function verifyManifest(
  manifestBytes: Buffer,
  signature: Buffer,
): Promise<boolean> {
  const publicKey = await readFile(
    env.PDF_SIGNING_PUBLIC_KEY_PATH,
  );

  return verify(
    null,
    manifestBytes,
    publicKey,
    signature,
  );
}
