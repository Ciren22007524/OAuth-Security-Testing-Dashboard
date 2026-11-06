import { spawnSync, execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
if (!process.env.AUTH_SERVICE_PATH) {
  console.error(
    "請設定 AUTH_SERVICE_PATH 為已安裝鎖定依賴的新版 auth-service checkout。",
  );
  process.exit(1);
}
const root = resolve(process.env.AUTH_SERVICE_PATH);
try {
  await access(join(root, "src/oidc/test-oidc.ts"));
  await access(join(root, "node_modules/vitest/vitest.mjs"));
} catch {
  console.error(
    "找不到標準 OIDC 來源／Vitest；請在 auth-service 執行 pnpm install --frozen-lockfile。",
  );
  process.exit(1);
}
const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
}).trim();
const work = await mkdtemp(join(tmpdir(), "auth-oidc-review-"));
try {
  const output = join(work, "result.json");
  const child = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "--reporter=json",
      `--outputFile=${output}`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    },
  );
  let data = {};
  try {
    data = JSON.parse(await readFile(output, "utf8"));
  } catch {}
  const tests = data.numTotalTests || 0,
    passed = data.numPassedTests || 0,
    failed = data.numFailedTests || 0,
    skipped = data.numPendingTests || 0;
  const ok =
    child.status === 0 &&
    data.success === true &&
    tests > 0 &&
    passed === tests &&
    !failed &&
    !skipped;
  console.log(
    JSON.stringify({
      verification: "AUTH_OIDC_SOURCE_TESTS",
      status: ok ? "PASS" : "ERROR",
      sourceRevision: revision,
      generatedAt: new Date().toISOString(),
      tests,
      passed,
      failed,
      skipped,
      scope:
        "最新 auth-service 全套隔離來源測試，包含標準 OIDC、註冊 scope、擁有者隔離、secret 輪替與撤銷；未驗收正式 D1 migration 或 Google 登入。",
      failure: ok
        ? undefined
        : "來源測試未全數通過；請在 auth-service checkout 執行 pnpm test 檢查。",
    }),
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
