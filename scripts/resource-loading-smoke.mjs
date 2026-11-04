import { createServer, request } from "node:http";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dashboardServer } from "../src/server.js";
import { openBrowser } from "./lib/browser.mjs";

const work = await mkdtemp(join(tmpdir(), "oauth-assets-"));
const servers = [];
let browser;
async function listen(server) {
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
const checks = [];
const skipped = [];
function check(name, condition) {
  if (!condition) throw new Error(name);
  checks.push(name);
}
try {
  const backend = await listen(
    dashboardServer({ environmentsFile: join(work, "environments.json") }),
  );
  const prefix = await listen(
    createServer((req, res) => {
      if (!req.url.startsWith("/lab/")) {
        res.writeHead(404);
        return res.end();
      }
      const upstream = request(
        backend + req.url.slice("/lab".length),
        { method: req.method, headers: req.headers },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    }),
  );
  const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
  const staticOnly = await listen(
    createServer(async (req, res) => {
      const files = {
        "/index.html": ["index.html", "text/html"],
        "/style.css": ["style.css", "text/css"],
        "/app.js": ["app.js", "text/javascript"],
      };
      const asset = files[req.url];
      if (!asset) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": asset[1] });
      res.end(await readFile(join(publicRoot, asset[0])));
    }),
  );
  browser = await openBrowser();
  async function wait(expression) {
    for (let i = 0; i < 100; i++) {
      if (await browser.evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Loading timeout");
  }
  async function navigate(url) {
    await browser.call("Page.navigate", { url });
    await wait(
      "document.readyState==='complete' && document.getElementById('startup-help')!==null",
    );
  }
  const styled =
    "getComputedStyle(document.body).backgroundColor==='rgb(9, 14, 25)' && getComputedStyle(document.querySelector('.workspace')).display==='grid'";
  await browser.call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const fileUrl = pathToFileURL(join(publicRoot, "index.html"));
  const html = await readFile(fileUrl, "utf8");
  for (const [attribute, file] of [
    ["href", "style.css"],
    ["src", "app.js"],
  ]) {
    const value = new RegExp(
      `${attribute}="(\\./${file.replace(".", "\\.")})"`,
    ).exec(html)?.[1];
    if (!value) throw new Error("Missing relative asset");
    await readFile(new URL(value, fileUrl));
  }
  checks.push("file-relative CSS and JS resolve to existing sibling files");
  const fileNavigation = await browser.call("Page.navigate", {
    url: fileUrl.href,
  });
  if (fileNavigation.errorText === "net::ERR_BLOCKED_BY_ADMINISTRATOR") {
    skipped.push({
      case: "file-protocol browser render",
      reason:
        "Managed Chromium policy blocks file: navigation; no policy bypass attempted.",
    });
  } else {
    if (fileNavigation.errorText) throw new Error("File navigation failed");
    await wait(
      "document.readyState==='complete' && document.getElementById('startup-help')!==null",
    );
    check("file preview loads real stylesheet", await browser.evaluate(styled));
    check(
      "file preview explains required backend",
      await browser.evaluate(
        "!document.getElementById('startup-help').hidden && document.getElementById('run').disabled && document.getElementById('runner-status').textContent==='NOT CONNECTED'",
      ),
    );
  }
  await navigate(staticOnly + "/index.html");
  await wait(
    "document.getElementById('runner-status').textContent==='OFFLINE'",
  );
  check(
    "static host remains styled and reports unavailable API",
    await browser.evaluate(
      styled +
        " && !document.getElementById('startup-help').hidden && document.getElementById('run').disabled",
    ),
  );
  await writeFile(
    join(work, "static-preview.png"),
    Buffer.from(
      (await browser.call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  await navigate(prefix + "/lab/index.html");
  await wait("document.querySelectorAll('.scenario').length===23");
  check(
    "subpath loads CSS and module",
    await browser.evaluate(
      styled + " && document.getElementById('startup-help').hidden",
    ),
  );
  check(
    "subpath API resolves below deployment prefix",
    await browser.evaluate(
      "performance.getEntriesByType('resource').some(r=>new URL(r.name).pathname==='/lab/api/environments')",
    ),
  );
  const result = await browser.evaluate(
    "(async()=>{const r=await fetch('./api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'rotation',environmentId:'local',environmentRevision:1})});return {status:r.status,body:await r.json()};})()",
  );
  check(
    "subpath can execute real backend scenario",
    result.status === 200 &&
      result.body.status === "PASS" &&
      result.body.cleanup === "complete",
  );
  await navigate(backend + "/index.html");
  await wait("document.querySelectorAll('.scenario').length===23");
  check(
    "Node index alias loads CSS and backend",
    await browser.evaluate(
      styled + " && document.getElementById('startup-help').hidden",
    ),
  );
  console.log(JSON.stringify({ checks, skipped, artifactDirectory: work }));
} finally {
  await browser?.close();
  for (const server of servers.reverse())
    await new Promise((resolve) => server.close(resolve));
  // Screenshots remain available for reviewing the direct-file regression.
  await rm(join(work, "environments.json"), { force: true });
}
