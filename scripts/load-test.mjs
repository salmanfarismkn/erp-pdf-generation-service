
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.PDF_BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.PDF_API_KEY;
const tenantId = process.env.PDF_TENANT_ID ?? "development";
const singlePath = process.env.PDF_SINGLE_PATH;
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 2);
const totalRequests = Number(process.env.LOAD_REQUESTS ?? 10);
const maxBusyRetries = 10;

if (!apiKey || !singlePath) {
  throw new Error(
    "Set PDF_API_KEY and PDF_SINGLE_PATH before running the test."
  );
}

if (
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  !Number.isInteger(totalRequests) ||
  totalRequests < 1
) {
  throw new Error("Concurrency and request count must be positive integers.");
}

const document = JSON.parse(
  await readFile("sample-invoice.json", "utf8")
);

const results = [];
let nextRequest = 0;

async function runRequest(requestNumber) {
  const started = performance.now();
  let firstByteMs = null;
  let status = 0;
  let error = null;
  let attempts = 0;

  while (true) {
    attempts++;

    try {
      const response = await fetch(
        new URL(singlePath, baseUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "x-tenant-id": tenantId,
          },
          body: JSON.stringify(document),
          signal: AbortSignal.timeout(60000),
        }
      );

      status = response.status;
      firstByteMs ??= performance.now() - started;

      if (status === 503 && attempts <= maxBusyRetries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        await delay(
          (Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 1000) + Math.random() * 500
        );
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${status}: ${body.slice(0, 300)}`);
      }

      // Consume the complete response to detect interrupted downloads.
      let bytes = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
        }
      }

      if (bytes === 0) {
        throw new Error("The response body was empty.");
      }

      return {
        requestNumber,
        status,
        attempts,
        firstByteMs,
        totalMs: performance.now() - started,
        bytes,
        error: null,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);

      return {
        requestNumber,
        status,
        attempts,
        firstByteMs,
        totalMs: performance.now() - started,
        bytes: 0,
        error,
      };
    }
  }
}

async function worker() {
  while (true) {
    const index = nextRequest++;
    if (index >= totalRequests) return;

    results.push(await runRequest(index + 1));
  }
}

console.log({
  baseUrl,
  singlePath,
  concurrency,
  totalRequests,
});

const testStarted = performance.now();

await Promise.all(
  Array.from(
    { length: Math.min(concurrency, totalRequests) },
    () => worker()
  )
);

const elapsedSeconds = (performance.now() - testStarted) / 1000;
const successful = results.filter((r) => r.error === null);
const failed = results.filter((r) => r.error !== null);

function percentile(values, p) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, index)] * 100) / 100;
}

const firstByteTimes = successful.map((r) => r.firstByteMs);
const totalTimes = successful.map((r) => r.totalMs);

console.log("\n--- Load Test Results ---");
console.log(`Successful: ${successful.length}/${totalRequests}`);
console.log(`Failed: ${failed.length}`);
console.log(
  `Busy retries: ${results.reduce((sum, result) => sum + result.attempts - 1, 0)}`
);
console.log(`Elapsed: ${elapsedSeconds.toFixed(2)} seconds`);
console.log(
  `Throughput: ${(successful.length / elapsedSeconds).toFixed(2)} successful requests/sec`
);
console.log(
  `First response p50/p95: ${percentile(firstByteTimes, 50)} / ${percentile(firstByteTimes, 95)} ms`
);
console.log(
  `Full download p50/p95: ${percentile(totalTimes, 50)} / ${percentile(totalTimes, 95)} ms`
);
console.log(
  `Average PDF bytes: ${
    successful.length
      ? Math.round(
          successful.reduce((sum, r) => sum + r.bytes, 0) /
            successful.length
        )
      : 0
  }`
);

if (failed.length) {
  console.log("\nFailures:");
  for (const result of failed) {
    console.log(
      `#${result.requestNumber} HTTP ${result.status}: ${result.error}`
    );
  }
}

if (failed.length > 0) {
  process.exitCode = 1;
}
