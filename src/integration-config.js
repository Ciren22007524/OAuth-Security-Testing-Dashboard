import { findBrowser } from "../scripts/lib/browser.mjs";
import { isSea } from "node:sea";
import { resolve, join } from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export const integrationCatalog = [
  {
    id: "integration-user-a",
    title: "使用者 A：自動登入、驗證與登出",
    persona: "A",
  },
  {
    id: "integration-user-b",
    title: "使用者 B：自動登入、驗證與登出",
    persona: "B",
  },
].map((s) => ({
  ...s,
  category: "整合流程",
  revision: 1,
  expected:
    "真實 auth-service＋Array 原始碼與 Chromium，使用隔離資料／假 Google；自動準備所有登入參數並驗證舊 session 失效。",
  prerequisites: [
    "已執行 npm run setup:integration，且有 Chrome／Chromium／Edge",
  ],
  requestBudget: 40,
  testingMode: "integration",
}));
export function integrationPaths() {
  const defaults = fileURLToPath(
    new URL("../.local/integration-sources/", import.meta.url),
  );
  return {
    auth: resolve(
      process.env.AUTH_SERVICE_PATH || join(defaults, "auth-service"),
    ),
    array: resolve(
      process.env.ARRAY_DEMO_PATH || join(defaults, "array-line-demo"),
    ),
  };
}
export async function integrationReady() {
  if (isSea())
    return {
      ready: false,
      message: "來源整合請使用 npm 原始碼版，不適用既有單檔預覽。",
    };
  const roots = integrationPaths();
  try {
    for (const file of [
      join(roots.auth, "src/oidc/test-oidc.ts"),
      join(roots.auth, "node_modules/oidc-provider/package.json"),
      join(roots.array, "cloudflare/sso-test/src/app.js"),
      join(roots.array, "node_modules/oauth4webapi/package.json"),
    ])
      await access(file);
    await access(
      fileURLToPath(
        new URL("../node_modules/esbuild/package.json", import.meta.url),
      ),
    );
    await findBrowser();
    return {
      ready: true,
      message: "已準備隔離來源。按下執行後自動建立全新使用者與登入交易。",
    };
  } catch {
    return {
      ready: false,
      message:
        "先在專案目錄執行 npm ci，再執行 npm run setup:integration；或一次設定 AUTH_SERVICE_PATH／ARRAY_DEMO_PATH。另需 Chrome／Edge／Chromium（可用 CHROMIUM_PATH 指定）。",
    };
  }
}
