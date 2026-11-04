import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDashboardServer } from "./application.js";

export function dashboardServer(options = {}) {
  return createDashboardServer({
    environmentsFile:
      process.env.DASHBOARD_ENVIRONMENTS_FILE ||
      fileURLToPath(new URL("../.local/environments.json", import.meta.url)),
    readAsset: (file) =>
      readFile(new URL(`../public/${file}`, import.meta.url)),
    ...options,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  dashboardServer().listen(port, "127.0.0.1", () =>
    console.log(
      `OAuth Lab 已啟動：http://localhost:${port}\n請透過此服務開啟儀表板，不要直接開啟 public/index.html。`,
    ),
  );
}
