import { execFileSync, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve, join } from "node:path";

const configured = process.env.ARRAY_DEMO_PATH;
if (!configured) {
  console.error(
    "請設定 ARRAY_DEMO_PATH 為 array-line-demo checkout；先在該專案執行 npm ci。",
  );
  process.exit(1);
}
const root = resolve(configured);
const suites = [
  "cloudflare/sso-test/test/app.test.js",
  "cloudflare/sso-test/test/rate-limit.test.js",
];
try {
  for (const file of [
    ...suites,
    "node_modules/oauth4webapi/package.json",
    "node_modules/jose/package.json",
  ])
    await access(join(root, file));
} catch {
  console.error(
    "找不到 Array SSO 測試或固定依賴；請確認 checkout 與 npm ci 已完成。",
  );
  process.exit(1);
}
let revision;
try {
  revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  console.error(
    "無法取得 Array checkout 版本；來源測試報告需要可追溯的 Git revision。",
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", ...suites],
  {
    cwd: root,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0" },
  },
);
const count = (name) =>
  Number(
    new RegExp(`^# ${name} (\\d+)$`, "m").exec(result.stdout || "")?.[1] || 0,
  );
const tests = count("tests"),
  passed = count("pass"),
  failed = count("fail"),
  skipped = count("skipped"),
  cancelled = count("cancelled");
const ok =
  result.status === 0 &&
  tests > 0 &&
  passed === tests &&
  failed === 0 &&
  skipped === 0 &&
  cancelled === 0;
console.log(
  JSON.stringify({
    verification: "ARRAY_SOURCE_TESTS",
    status: ok ? "PASS" : "ERROR",
    sourceRevision: revision,
    generatedAt: new Date().toISOString(),
    tests,
    passed,
    failed,
    skipped,
    cancelled,
    suites,
    scope:
      "Array Worker 真實原始碼＋隔離 OIDC fetch／記憶體 store／模擬 limiter；未驗收正式部署或 Google 登入。",
    failure: ok
      ? undefined
      : "來源測試未全部通過；請在 Array checkout 執行 npm run test:sso-worker 檢視詳情。",
  }),
);
process.exitCode = ok ? 0 : 1;
