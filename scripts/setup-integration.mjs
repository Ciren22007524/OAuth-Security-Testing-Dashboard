import { spawnSync } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(
  new URL("../.local/integration-sources/", import.meta.url),
);
const specs = [
  {
    name: "auth-service",
    revision: "337b1cec1b91cd0cf973ca5bc9ed520ee5e550ae",
  },
  {
    name: "array-line-demo",
    revision: "fc79f38e064f57da7cdb37964f6366e376cf01ac",
  },
];
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error("整合環境設定未完成；請修正上方安裝錯誤後重跑。");
}
try {
  if (!process.env.npm_execpath)
    throw new Error("請透過 npm run setup:integration 執行。");
  await mkdir(root, { recursive: true });
  for (const spec of specs) {
    const path = join(root, spec.name);
    let exists = false;
    try {
      await access(path);
      exists = true;
    } catch {}
    if (!exists) {
      run(
        "git",
        [
          "clone",
          "--no-checkout",
          `https://github.com/Ciren22007524/${spec.name}.git`,
          path,
        ],
        root,
      );
      run("git", ["checkout", "--detach", spec.revision], path);
    } else {
      const revision = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: path,
        encoding: "utf8",
      });
      const changed = spawnSync(
        "git",
        ["status", "--porcelain", "--untracked-files=no"],
        { cwd: path, encoding: "utf8" },
      );
      if (
        revision.status !== 0 ||
        revision.stdout.trim() !== spec.revision ||
        changed.status !== 0 ||
        changed.stdout.trim()
      )
        throw new Error(
          `${spec.name} 快取版本或工作樹已變更，不會覆蓋；請另設 AUTH_SERVICE_PATH／ARRAY_DEMO_PATH 或移開自行修改的快取。`,
        );
    }
    console.log(`準備 ${spec.name} @ ${spec.revision.slice(0, 7)}`);
    if (spec.name === "auth-service")
      run(
        process.execPath,
        [
          process.env.npm_execpath,
          "exec",
          "--yes",
          "--package=pnpm@10.28.0",
          "--",
          "pnpm",
          "install",
          "--frozen-lockfile",
          "--ignore-scripts",
        ],
        path,
      );
    else
      run(
        process.execPath,
        [
          process.env.npm_execpath,
          "ci",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
        path,
      );
  }
  console.log(
    "整合來源已準備好。執行 npm start，選『整合驗測』，再選使用者 A 或 B。測試 client、secret、code、cookie 均會自動產生。",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
