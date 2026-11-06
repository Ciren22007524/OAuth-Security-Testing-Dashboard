import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function findBrowser() {
  const paths = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ...[
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.LOCALAPPDATA,
    ]
      .filter(Boolean)
      .flatMap((root) => [
        join(root, "Google/Chrome/Application/chrome.exe"),
        join(root, "Microsoft/Edge/Application/msedge.exe"),
      ]),
  ].filter(Boolean);
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  throw new Error("找不到 Chrome／Chromium／Edge，請設定 CHROMIUM_PATH。");
}
export async function openBrowser() {
  const executable = await findBrowser();
  const listeners = new Map();
  const profile = await mkdtemp(join(tmpdir(), "oauth-source-browser-"));
  const chrome = spawn(
    executable,
    [
      "--headless",
      ...(typeof process.getuid === "function" && process.getuid() === 0
        ? ["--no-sandbox"]
        : []),
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
      if (value.method)
        for (const handler of listeners.get(value.method) || [])
          Promise.resolve(handler(value.params)).catch(() => {});
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
    const on = (method, handler) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(handler);
      return () => listeners.get(method)?.delete(handler);
    };
    return { call, evaluate, close, on };
  } catch (error) {
    await close();
    throw error;
  }
}
