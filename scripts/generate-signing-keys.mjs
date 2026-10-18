
import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("keys", { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
});

await writeFile("keys/pdf-signing-private.pem", privateKey, {
  mode: 0o600,
});

await writeFile("keys/pdf-signing-public.pem", publicKey);

console.log("Generated Ed25519 signing keys in ./keys");
console.log("Keep the private key secret and out of Git.");
