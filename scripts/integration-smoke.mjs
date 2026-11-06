import { runIntegration } from "../src/integration-runner.js";
const profile = {
  id: "local",
  type: "simulation",
  name: "隔離來源整合",
  revision: 1,
};
for (const id of ["integration-user-a", "integration-user-b"]) {
  const result = await runIntegration(id, profile);
  console.log(JSON.stringify(result));
  if (result.status !== "PASS") process.exitCode = 1;
}

const negative = await runIntegration("integration-user-a", profile, {
  fault: "old-session-still-valid",
});
console.log(
  JSON.stringify({
    check: "故意不撤銷本站 session 時能偵測失敗",
    status:
      negative.status === "FAIL" &&
      negative.assertions.some(
        (a) => !a.passed && a.name.includes("伺服器已撤銷"),
      )
        ? "PASS"
        : "FAIL",
    observedScenarioStatus: negative.status,
    assertions: negative.assertions.filter((a) => !a.passed),
  }),
);
if (
  negative.status !== "FAIL" ||
  !negative.assertions.some((a) => !a.passed && a.name.includes("伺服器已撤銷"))
)
  process.exitCode = 1;

const controller = new AbortController();
const stop = setTimeout(() => controller.abort(), 500);
const cancelled = await runIntegration("integration-user-a", profile, {
  signal: controller.signal,
});
clearTimeout(stop);
console.log(
  JSON.stringify({
    check: "取消來源整合會停止並清理",
    status:
      cancelled.status === "ERROR" && cancelled.error?.includes("已停止")
        ? "PASS"
        : "FAIL",
    cleanup: cancelled.cleanup,
  }),
);
if (cancelled.status !== "ERROR" || !cancelled.error?.includes("已停止"))
  process.exitCode = 1;
