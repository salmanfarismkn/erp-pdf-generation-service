import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBatchArchive } from "../src/worker/batch-archive.js";

describe("batch archive creation", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("writes a complete ZIP archive", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "batch-archive-"));
    const zipPath = join(tempDir, "batch.zip");

    await createBatchArchive("job-1", zipPath, [], []);

    const zip = await readFile(zipPath);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("fails and removes the partial archive when a source PDF is missing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "batch-archive-"));
    const zipPath = join(tempDir, "batch.zip");

    await expect(
      createBatchArchive(
        "job-1",
        zipPath,
        [{
          path: join(tempDir, "missing.pdf"),
          name: "invoice.pdf",
          documentId: "INV-1",
          sizeBytes: 10,
          sha256: "0".repeat(64),
        }],
        [],
      ),
    ).rejects.toThrow();

    await expect(readFile(zipPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
