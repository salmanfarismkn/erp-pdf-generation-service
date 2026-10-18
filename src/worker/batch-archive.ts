import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import type { Archiver, ArchiverOptions } from "archiver";
import {
  signManifest,
  type BatchManifest,
} from "../compliance/manifest.js";

const archiver = createRequire(import.meta.url)("archiver") as (
  format: "zip",
  options?: ArchiverOptions,
) => Archiver;

export interface FailedDocument {
  documentId: string;
  error: string;
}

interface ArchiveFile {
  path: string;
  name: string;
  documentId: string;
  sizeBytes: number;
  sha256: string;
}

export async function createBatchArchive(
  jobId: string,
  zipPath: string,
  pdfPaths: ArchiveFile[],
  failures: FailedDocument[],
): Promise<void> {
  const manifest: BatchManifest = {
    schemaVersion: 1,
    algorithm: "Ed25519",
    jobId,
    generatedAt: new Date().toISOString(),
    files: pdfPaths.map((file) => ({
      documentId: file.documentId,
      filename: file.name,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    })),
    failures,
  };

  const manifestBytes = Buffer.from(
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  const signature = await signManifest(manifestBytes);
  const archive = archiver("zip", { zlib: { level: 6 } });
  const output = createWriteStream(zipPath);

  // A missing input must not produce a success-shaped, incomplete ZIP.
  archive.on("warning", (error) => archive.destroy(error));
  const outputFinished = pipeline(archive, output);

  for (const file of pdfPaths) {
    archive.file(file.path, { name: file.name });
  }

  archive.append(manifestBytes, { name: "manifest.json" });
  archive.append(signature.toString("base64") + "\n", {
    name: "manifest.sig",
  });

  if (failures.length > 0) {
    archive.append(JSON.stringify(failures, null, 2), {
      name: "failed-documents.json",
    });
  }

  try {
    await Promise.all([archive.finalize(), outputFinished]);
  } catch (error) {
    await rm(zipPath, { force: true });
    throw error;
  }
}
