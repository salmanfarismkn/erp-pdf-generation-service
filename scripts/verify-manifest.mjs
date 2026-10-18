
import {
  createHash,
  createPublicKey,
  verify,
} from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

const directory = resolve(process.argv[2] ?? ".");

const manifestPath = join(directory, "manifest.json");
const signaturePath = join(directory, "manifest.sig");
const publicKeyPath = resolve(
  process.env.PDF_SIGNING_PUBLIC_KEY_PATH ??
  "./keys/pdf-signing-public.pem",
);

const manifestBytes = await readFile(manifestPath);
const signature = Buffer.from(
  (await readFile(signaturePath, "utf8")).trim(),
  "base64",
);
const publicKey = createPublicKey(
  await readFile(publicKeyPath),
);

if (!verify(null, manifestBytes, publicKey, signature)) {
  console.error("FAIL: manifest signature is invalid");
  process.exit(1);
}

const manifest = JSON.parse(manifestBytes.toString("utf8"));

for (const file of manifest.files) {
  // Only allow simple filenames from the signed manifest.
  if (
    typeof file.filename !== "string" ||
    basename(file.filename) !== file.filename
  ) {
    throw new Error("Unsafe filename in manifest");
  }

  const path = join(directory, file.filename);
  const bytes = await readFile(path);
  const actualHash = createHash("sha256")
    .update(bytes)
    .digest("hex");
  const fileInfo = await stat(path);

  if (
    actualHash !== file.sha256 ||
    fileInfo.size !== file.sizeBytes
  ) {
    console.error(`FAIL: ${file.filename} does not match the manifest`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${file.filename}`);
  }
}

if (process.exitCode === 1) {
  process.exit(1);
}

console.log("PASS: signature and all PDF hashes verified");
