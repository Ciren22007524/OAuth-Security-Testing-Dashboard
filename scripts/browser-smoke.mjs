import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardServer } from "../src/server.js";
const server = dashboardServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const work = await mkdtemp(join(tmpdir(), "oauth-ui-"));
const profile = join(work, "profile");
const downloads = join(work, "downloads");
await mkdir(profile);
await mkdir(downloads);
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
let ws;
let chromeError;
chrome.on("error", (error) => {
  chromeError = error;
});
try {
  let pages;
  for (let i = 0; i < 100; i++) {
    try {
      if (chromeError) throw chromeError;
      const port = (
        await readFile(join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
      pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!pages) throw Error("Chrome startup failed");
  ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (e) => {
    const v = JSON.parse(e.data);
    if (v.id) {
      pending.get(v.id)?.(v);
      pending.delete(v.id);
    }
    if (v.method === "Runtime.exceptionThrown")
      errors.push(v.params.exceptionDetails.text);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (v) =>
        v.error ? reject(Error(JSON.stringify(v.error))) : resolve(v.result),
      );
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) =>
    (
      await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result.value;
  const wait = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(`Timeout: ${expression}`);
  };
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
  });
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url: base });
  await wait("document.querySelectorAll('.scenario').length===14");
  await evaluate(
    "document.getElementById('filter').value='JWT';document.getElementById('filter').dispatchEvent(new Event('change'))",
  );
  if ((await evaluate("document.querySelectorAll('.scenario').length")) !== 1)
    throw Error("Filter failed");
  await evaluate(
    "document.querySelector('.scenario').click();document.querySelector('#detail button').click()",
  );
  await wait(
    "document.getElementById('pass').textContent==='1' && !document.getElementById('run').disabled",
  );
  await evaluate(
    "document.getElementById('filter').value='all';document.getElementById('filter').dispatchEvent(new Event('change'));document.getElementById('run').click()",
  );
  await wait(
    "document.getElementById('total').textContent==='14' && !document.getElementById('run').disabled",
  );
  const stats = await evaluate(
    "({pass:document.getElementById('pass').textContent,fail:document.getElementById('fail').textContent,inconclusive:document.getElementById('inconclusive').textContent})",
  );
  if (stats.pass !== "13" || stats.fail !== "0" || stats.inconclusive !== "1")
    throw Error(JSON.stringify(stats));
  await evaluate(
    "document.getElementById('export-json').click();document.getElementById('export-md').click()",
  );
  for (let i = 0; i < 50; i++) {
    if (
      (await readdir(downloads)).filter((n) => /\.(json|md)$/.test(n))
        .length === 2
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (
    (await readdir(downloads)).filter((n) => /\.(json|md)$/.test(n)).length !==
    2
  )
    throw Error("Downloads failed");
  const report = JSON.parse(
    await readFile(join(downloads, "oauth-simulation-report.json"), "utf8"),
  );
  if (
    report.environment !== "SIMULATION" ||
    report.results.length !== 14 ||
    report.results.filter((r) => r.status === "PASS").length !== 13 ||
    report.results.some((r) => r.cleanup !== "complete")
  )
    throw Error("Invalid exported report");
  for (const file of [
    "oauth-simulation-report.json",
    "oauth-simulation-report.md",
  ]) {
    const text = await readFile(join(downloads, file), "utf8");
    if (/__Host-rt=[a-f0-9-]{36}|fixture-[a-f0-9-]{36}/.test(text))
      throw Error("Unredacted credential in downloaded report");
    if (!text.includes("SIMULATION")) throw Error("Missing report environment");
  }
  await evaluate("document.querySelector('.scenario').click()");
  await writeFile(
    join(work, "desktop.png"),
    Buffer.from(
      (await call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  if (await evaluate("document.documentElement.scrollWidth > innerWidth"))
    throw Error("Mobile overflow");
  await writeFile(
    join(work, "mobile.png"),
    Buffer.from(
      (await call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  await evaluate(
    "document.getElementById('run').click();setTimeout(()=>document.getElementById('cancel').click(),300)",
  );
  await wait("!document.getElementById('run').disabled");
  if (
    !(await evaluate(
      "document.getElementById('status').textContent.includes('已停止')",
    ))
  )
    throw Error("Cancel failed");
  await call("Page.reload");
  await wait("document.querySelectorAll('.scenario').length===14");
  if ((await evaluate("document.getElementById('total').textContent")) !== "0")
    throw Error("Unexpected persistence");
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log(
    JSON.stringify({
      stats,
      checks: [
        "filter",
        "single run",
        "all scenarios",
        "JSON download",
        "Markdown download",
        "cancel",
        "reload clears state",
        "mobile overflow",
        "no browser exceptions",
      ],
      artifactDirectory: work,
    }),
  );
} finally {
  ws?.close();
  const exited = new Promise((r) => chrome.once("exit", r));
  if (chrome.exitCode === null && chrome.pid) {
    chrome.kill();
    await exited;
  }
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
