import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import {
  integrationCatalog,
  integrationPaths,
  integrationReady,
} from "./integration-config.js";

export async function runIntegration(id, profile, { signal, fault } = {}) {
  const scenario = integrationCatalog.find((s) => s.id === id);
  if (!scenario) throw new Error("Unknown integration scenario");
  const result = {
    ...scenario,
    environment: "SOURCE_INTEGRATION",
    environmentId: profile.id,
    environmentName: "隔離來源整合",
    environmentRevision: profile.revision,
    target: "isolated-auth-service-and-array",
    timestamp: new Date().toISOString(),
    status: "INCONCLUSIVE",
    assertions: [],
    evidence: [],
    cleanup: "not-started",
    limitation:
      "兩個專案的真實原始碼＋Chromium；Google、儲存與 limiter 使用隔離替身，虛擬 HTTPS 由 CDP 路由，不代表正式 Google／Cloudflare／網路 TLS 已驗收。",
  };
  const started = performance.now();
  let work;
  try {
    const ready = await integrationReady();
    if (!ready.ready) {
      result.error = ready.message;
      return result;
    }
    signal?.throwIfAborted();
    const roots = integrationPaths();
    result.sourceRevisions = Object.fromEntries(
      Object.entries(roots).map(([name, path]) => [
        name,
        execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      ]),
    );
    result.sourceDirty = Object.fromEntries(
      Object.entries(roots).map(([name, path]) => [
        name,
        Boolean(
          execFileSync(
            "git",
            ["-C", path, "status", "--porcelain", "--untracked-files=no"],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
          ).trim(),
        ),
      ]),
    );
    work = await mkdtemp(join(tmpdir(), "oauth-integrated-"));
    const { build } = await import("esbuild");
    const bundle = join(work, "sources.mjs");
    const builtins = new Set([
      ...builtinModules,
      ...builtinModules.map((m) => "node:" + m),
    ]);
    await build({
      stdin: {
        contents: `export {createOidcTestService} from ${JSON.stringify(join(roots.auth, "src/oidc/test-oidc.ts"))};export {fakeIdentities,ISSUER} from ${JSON.stringify(join(roots.auth, "src/test-helpers.ts"))};export {createApp as createArrayApp} from ${JSON.stringify(join(roots.array, "cloudflare/sso-test/src/app.js"))};`,
        resolveDir: roots.auth,
        sourcefile: "integration-entry.js",
        loader: "js",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      outfile: bundle,
      loader: { ".css": "text", ".md": "text" },
      jsx: "automatic",
      jsxImportSource: "hono/jsx",
      logLevel: "silent",
      plugins: [
        {
          name: "native-project-dependencies",
          setup(api) {
            api.onResolve({ filter: /^[^./]/ }, async (args) => {
              if (args.pluginData?.native || builtins.has(args.path)) return;
              const resolved = await api.resolve(args.path, {
                resolveDir: args.resolveDir,
                kind: args.kind,
                pluginData: { native: true },
              });
              if (resolved.errors.length) return { errors: resolved.errors };
              return { path: resolved.path, external: true };
            });
          },
        },
      ],
    });
    signal?.throwIfAborted();
    const childScript = fileURLToPath(
      new URL("../scripts/integration-child.mjs", import.meta.url),
    );
    const output = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          childScript,
          bundle,
          scenario.persona,
          fault === "old-session-still-valid" ? fault : "",
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
        },
      );
      let stdout = "",
        oversized = false,
        timedOut = false,
        forced = false;
      const stop = () => {
        if (force) return;
        child.kill("SIGTERM");
        force = setTimeout(() => {
          forced = true;
          if (process.platform === "win32")
            spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
              stdio: "ignore",
            }).on("error", () => {});
          else {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {}
          }
        }, 7000);
      };
      let force;
      const timeout = setTimeout(() => {
        timedOut = true;
        stop();
      }, 90000);
      const abort = () => stop();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on("data", (chunk) => {
        if (stdout.length + chunk.length > 2 * 1024 * 1024) {
          oversized = true;
          stop();
        } else stdout += chunk;
      });
      child.stderr.on("data", () => {});
      child.once("error", () => {
        clearTimeout(timeout);
        clearTimeout(force);
        signal?.removeEventListener("abort", abort);
        resolve({
          status: "ERROR",
          assertions: [],
          evidence: [],
          error: "無法啟動整合程序。",
        });
      });
      child.once("close", () => {
        clearTimeout(timeout);
        clearTimeout(force);
        signal?.removeEventListener("abort", abort);
        const line = stdout
          .split("\n")
          .findLast((l) => l.startsWith("INTEGRATION_RESULT:"));
        let parsed;
        try {
          parsed = JSON.parse(line.slice("INTEGRATION_RESULT:".length));
        } catch {}
        resolve(
          !forced && !oversized && !timedOut && parsed
            ? parsed
            : {
                status: "ERROR",
                assertions: [],
                evidence: [],
                error: "整合程序逾時或未回傳有效結果。",
                forced,
              },
        );
      });
    });
    Object.assign(result, output);
    if (signal?.aborted) {
      result.status = "ERROR";
      result.error = "已停止，隔離瀏覽器與服務已清理。";
    }
  } catch {
    result.status = "ERROR";
    result.error = signal?.aborted
      ? "已停止整合流程。"
      : "無法編譯／啟動來源；請執行 npm ci 與 npm run setup:integration，並確認來源版本。";
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
    result.cleanup = result.forced ? "forced-process-termination" : "complete";
    delete result.forced;
    result.durationMs = Math.round(performance.now() - started);
  }
  return result;
}
