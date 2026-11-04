import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./lib/browser.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const work = await mkdtemp(join(tmpdir(), "oauth-portable-ui-"));
const executable = process.argv[2]
  ? resolve(process.argv[2])
  : join(
      root,
      "dist",
      process.platform === "win32"
        ? "OAuthSecurityLab-windows-x64.exe"
        : "OAuthSecurityLab-linux-x64",
    );
const app = spawn(executable, ["--no-browser"], {
  cwd: work,
  env: {
    ...process.env,
    DASHBOARD_ENVIRONMENTS_FILE: join(work, "environments.json"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let processError;
app.on("error", (error) => {
  processError = error;
});
app.stdout.on("data", (data) => {
  output += data;
});
let browser;
try {
  let url;
  for (let i = 0; i < 100; i++) {
    if (processError || app.exitCode !== null)
      throw new Error("Standalone application failed to start");
    url = /http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0];
    if (url) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!url) throw new Error("Standalone application startup timed out");
  browser = await openBrowser();
  await browser.call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.call("Page.navigate", { url });
  async function wait(expression) {
    for (let i = 0; i < 150; i++) {
      if (await browser.evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Portable UI timed out");
  }
  await wait("document.querySelectorAll('.scenario').length===23");
  if (
    !(await browser.evaluate(
      "getComputedStyle(document.body).backgroundColor==='rgb(9, 14, 25)' && document.getElementById('startup-help').hidden",
    ))
  )
    throw new Error("Embedded stylesheet or frontend failed");
  await browser.evaluate(
    "document.querySelector('.scenario').click();document.querySelector('#detail button').click()",
  );
  await wait(
    "document.getElementById('pass').textContent==='1' && !document.getElementById('run').disabled",
  );
  await writeFile(
    join(work, "portable-ui.png"),
    Buffer.from(
      (await browser.call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  const response = await fetch(url + "/api/environments", {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Portable settings test",
      type: "simulation",
    }),
  });
  if (response.status !== 201)
    throw new Error("Portable settings could not be saved");
  if (
    !JSON.parse(await readFile(join(work, "environments.json"), "utf8"))
      .environments.length
  )
    throw new Error("Missing persisted settings");
  console.log(
    JSON.stringify({
      portableBrowser: "PASS",
      checks: [
        "standalone starts outside project",
        "embedded CSS/JS",
        "23 scenarios",
        "real runner result",
        "user settings persistence",
      ],
      artifactDirectory: work,
    }),
  );
} finally {
  await browser?.close();
  if (app.pid && app.exitCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve));
    app.kill();
    await exited;
  }
  await rm(join(work, "environments.json"), { force: true });
}
