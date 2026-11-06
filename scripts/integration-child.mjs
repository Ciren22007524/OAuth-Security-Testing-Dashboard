import { pathToFileURL } from "node:url";
import { runFlow } from "./lib/integration-flow.mjs";
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
try {
  const sources = await import(pathToFileURL(process.argv[2]).href);
  const result = await runFlow(sources, process.argv[3], {
    signal: controller.signal,
    fault:
      process.argv[4] === "old-session-still-valid"
        ? process.argv[4]
        : undefined,
  });
  process.stdout.write("INTEGRATION_RESULT:" + JSON.stringify(result) + "\n");
} catch {
  process.stdout.write(
    'INTEGRATION_RESULT:{"status":"ERROR","assertions":[],"evidence":[],"error":"無法啟動隔離來源整合；請確認依賴與來源版本。"}\n',
  );
}
