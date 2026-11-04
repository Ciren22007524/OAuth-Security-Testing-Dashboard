import { getAsset } from "node:sea";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startDesktop } from "./desktop.js";

async function main() {
  if (process.argv.includes("--licenses")) {
    console.log(getAsset("licenses/app.txt", "utf8"));
    console.log(getAsset("licenses/node.txt", "utf8"));
    return;
  }
  const smoke = process.argv.includes("--smoke-test");
  const temporary = smoke
    ? await mkdtemp(join(tmpdir(), "oauth-sea-smoke-"))
    : undefined;
  const app = await startDesktop({
    readAsset: (file) => Buffer.from(getAsset(`public/${file}`)),
    ...(smoke
      ? { environmentsFile: join(temporary, "environments.json") }
      : {}),
    openBrowser: !smoke && !process.argv.includes("--no-browser"),
  });
  console.log(
    smoke
      ? `OAuth Lab smoke endpoint: ${app.url}`
      : `OAuth Lab 已啟動：${app.url}\n瀏覽器將自動開啟。使用期間請保留此視窗；關閉視窗會停止服務。`,
  );
  if (smoke) {
    try {
      for (const path of ["/", "/style.css", "/app.js", "/api/environments"]) {
        const response = await fetch(app.url + path);
        const text = await response.text();
        if (response.status !== 200 || text.length < 10)
          throw new Error(`Asset smoke failed: ${path}`);
      }
      const response = await fetch(app.url + "/api/run", {
        method: "POST",
        headers: { Origin: app.url, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "rotation",
          environmentId: "local",
          environmentRevision: 1,
        }),
      });
      const result = await response.json();
      if (result.status !== "PASS" || result.cleanup !== "complete")
        throw new Error("Runner smoke failed");
      console.log("SEA_SMOKE_PASS");
    } finally {
      await app.close();
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
main().catch((error) => {
  console.error(`OAuth Lab 啟動失敗：${error.message}`);
  process.exitCode = 1;
  if (!process.argv.includes("--smoke-test") && process.stdin.isTTY) {
    console.error("按 Enter 關閉。");
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(1));
  }
});
