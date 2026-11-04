import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function openBrowser() {
  const profile = await mkdtemp(join(tmpdir(), "oauth-source-browser-"));
  const chrome = spawn(
    process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let processError;
  chrome.on("error", (error) => {
    processError = error;
  });
  let ws;
  const pending = new Map();
  async function close() {
    ws?.close();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Browser closed"));
    }
    pending.clear();
    if (chrome.pid && chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
    }
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
  try {
    let pages;
    for (let i = 0; i < 100; i++) {
      if (processError)
        throw new Error("Chromium unavailable; set CHROMIUM_PATH");
      try {
        const port = (
          await readFile(join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0];
        pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!pages) throw new Error("Chromium startup timed out");
    ws = new WebSocket(
      pages.find((page) => page.type === "page").webSocketDebuggerUrl,
    );
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    ws.addEventListener("message", (event) => {
      const value = JSON.parse(event.data);
      const request = pending.get(value.id);
      if (!request) return;
      pending.delete(value.id);
      clearTimeout(request.timer);
      if (value.error) request.reject(new Error("Browser protocol error"));
      else request.resolve(value.result);
    });
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Browser timeout: ${method}`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    async function evaluate(expression) {
      const value = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (value.exceptionDetails) throw new Error("Browser JavaScript failed");
      return value.result.value;
    }
    await call("Runtime.enable");
    await call("Page.enable");
    await call("Network.enable");
    return { call, evaluate, close };
  } catch (error) {
    await close();
    throw error;
  }
}
