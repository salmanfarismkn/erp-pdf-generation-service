
import puppeteer, { type Browser, type Page } from "puppeteer";
import type { DocumentPayload } from "../documents/schema.js";
import { buildDocumentHtml } from "../documents/html.js";

const MAX_ACTIVE_RENDERS = 1;
const MAX_WAITING_RENDERS = 10;

export class RendererBusyError extends Error {
  constructor() {
    super("PDF renderer is busy or shutting down");
    this.name = "RendererBusyError";
  }
}

type RenderTask = {
  document: DocumentPayload;
  resolve: (pdf: Buffer) => void;
  reject: (error: unknown) => void;
};

let browser: Browser | undefined;
let activeRenders = 0;
let closing = false;
let shutdownPromise: Promise<void> | undefined;

const waitingQueue: RenderTask[] = [];
const shutdownWaiters: Array<() => void> = [];

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) {
    return browser;
  }

  browser = await puppeteer.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });

  return browser;
}

async function resetBrowser(): Promise<void> {
  const current = browser;
  browser = undefined;

  if (current) {
    await current.close().catch(() => undefined);
  }
}

async function renderPdfInternal(
  document: DocumentPayload,
): Promise<Buffer> {
  let page: Page | undefined;

  try {
    const activeBrowser = await getBrowser();
    page = await activeBrowser.newPage();

    page.setDefaultTimeout(15_000);

    await page.setContent(buildDocumentHtml(document), {
      waitUntil: "load",
      timeout: 15_000,
    });

    const output = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 30_000,
    });

    return Buffer.from(output);
  } catch (error) {
    await resetBrowser();
    throw error;
  } finally {
    await page?.close().catch(() => undefined);
  }
}

function settleShutdownIfIdle(): void {
  if (!closing || activeRenders !== 0) {
    return;
  }

  void resetBrowser().finally(() => {
    while (shutdownWaiters.length > 0) {
      shutdownWaiters.shift()?.();
    }
  });
}

function pumpQueue(): void {
  while (
    !closing &&
    activeRenders < MAX_ACTIVE_RENDERS &&
    waitingQueue.length > 0
  ) {
    const task = waitingQueue.shift();

    if (!task) {
      continue;
    }

    activeRenders++;

    void renderPdfInternal(task.document)
      .then(task.resolve, task.reject)
      .finally(() => {
        activeRenders--;
        pumpQueue();
        settleShutdownIfIdle();
      });
  }

  settleShutdownIfIdle();
}

export function renderPdf(
  document: DocumentPayload,
): Promise<Buffer> {
  if (closing) {
    return Promise.reject(new RendererBusyError());
  }

  if (
    activeRenders >= MAX_ACTIVE_RENDERS &&
    waitingQueue.length >= MAX_WAITING_RENDERS
  ) {
    return Promise.reject(new RendererBusyError());
  }

  return new Promise<Buffer>((resolve, reject) => {
    waitingQueue.push({ document, resolve, reject });
    pumpQueue();
  });
}

export async function closeRenderer(): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  closing = true;

  const queuedTasks = waitingQueue.splice(0);

  for (const task of queuedTasks) {
    task.reject(new RendererBusyError());
  }

  shutdownPromise = (async () => {
    if (activeRenders === 0) {
      await resetBrowser();
      return;
    }

    await new Promise<void>((resolve) => {
      shutdownWaiters.push(resolve);
    });
  })();

  return shutdownPromise;
}
