const $ = (id) => document.getElementById(id);
let catalog = [];
const results = new Map();
let selected;
let controller;
let running = false;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function render() {
  $("catalog").replaceChildren();
  for (const scenario of catalog.filter(
    (s) => $("filter").value === "all" || s.category === $("filter").value,
  )) {
    const button = element(
      "button",
      undefined,
      `scenario${selected === scenario.id ? " selected" : ""}`,
    );
    const label = element("span");
    label.append(
      element("strong", scenario.title),
      element(
        "small",
        `${scenario.category.toUpperCase()} / ${scenario.severity.toUpperCase()}`,
      ),
    );
    const status = results.get(scenario.id)?.status || "未執行";
    button.append(label, element("span", status, `result ${status}`));
    button.onclick = () => {
      selected = scenario.id;
      render();
      detail();
    };
    $("catalog").append(button);
  }
  const values = [...results.values()];
  $("total").textContent = values.length;
  $("pass").textContent = values.filter((r) => r.status === "PASS").length;
  $("fail").textContent = values.filter((r) =>
    ["FAIL", "ERROR"].includes(r.status),
  ).length;
  $("inconclusive").textContent = values.filter(
    (r) => r.status === "INCONCLUSIVE",
  ).length;
  $("export-json").disabled = $("export-md").disabled =
    running || !values.length;
}
function detail() {
  const scenario = catalog.find((s) => s.id === selected);
  if (!scenario) return;
  const result = results.get(selected);
  const wrap = element("div", undefined, "detail-content");
  wrap.append(
    element("h3", scenario.title),
    element("p", scenario.expected),
    element(
      "span",
      `${result?.status || "未執行"} · SIMULATION`,
      result?.status || "tag",
    ),
  );
  wrap.append(
    element("h4", "PREREQUISITES / REQUEST BUDGET"),
    element(
      "p",
      `${scenario.prerequisites.join("、")} · 最多 ${scenario.requestBudget} 個請求`,
    ),
  );
  if (result) {
    const list = element("ul");
    for (const assertion of result.assertions)
      list.append(
        element(
          "li",
          `${assertion.passed ? "✓" : "✕"} ${assertion.name}`,
          assertion.passed ? "PASS" : "FAIL",
        ),
      );
    wrap.append(list);
    if (result.limitation || result.error)
      wrap.append(element("p", result.limitation || result.error));
    wrap.append(
      element("h4", "REDACTED HTTP EVIDENCE"),
      element(
        "pre",
        result.evidence.length
          ? JSON.stringify(result.evidence, null, 2)
          : "此情境無 HTTP 請求；請參閱斷言與限制。",
      ),
    );
    wrap.append(
      element(
        "p",
        `${result.durationMs} ms · cleanup: ${result.cleanup} · revision ${result.revision}`,
      ),
    );
  }
  const run = element("button", "▶ 執行此情境", "primary");
  run.disabled = running;
  run.onclick = () => execute([scenario]);
  wrap.append(run);
  $("detail").replaceChildren(wrap);
}
function log(text) {
  $("console").textContent += `\n[${new Date().toLocaleTimeString()}] ${text}`;
  $("console").scrollTop = $("console").scrollHeight;
}
async function execute(scenarios) {
  if (running) return;
  running = true;
  controller = new AbortController();
  $("run").disabled = true;
  $("cancel").disabled = false;
  render();
  detail();
  try {
    for (const scenario of scenarios) {
      controller.signal.throwIfAborted();
      selected = scenario.id;
      results.delete(scenario.id);
      $("status").textContent = `執行中：${scenario.title}`;
      render();
      detail();
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: scenario.id }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`執行器 HTTP ${response.status}`);
      const result = await response.json();
      results.set(scenario.id, result);
      log(
        `${result.status.padEnd(12)} ${scenario.title} · ${result.durationMs} ms`,
      );
      render();
      detail();
      // At most four scenario starts per second from this UI.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    $("status").textContent = "執行完成 · 所有結果僅適用於本機模擬器";
  } catch (error) {
    const message = controller.signal.aborted
      ? "已停止；已完成的結果保留，未執行項目不計入。"
      : error.message;
    $("status").textContent = message;
    log(message);
  } finally {
    running = false;
    $("run").disabled = false;
    $("cancel").disabled = true;
    render();
    detail();
  }
}
function exportReport(format) {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: "SIMULATION",
    limitations: [
      "僅驗證本機協定與 verifier fixtures；未驗證正式服務、Google 登入、D1 或瀏覽器 CORS。",
    ],
    results: [...results.values()],
  };
  const text =
    format === "json"
      ? JSON.stringify(report, null, 2)
      : `# OAuth 安全測試報告\n\nSIMULATION · ${report.generatedAt}\n\n${report.limitations.join("\n")}\n\n` +
        report.results
          .map(
            (r) =>
              `## ${r.title} — ${r.status}\n\n${r.expected}\n\n${r.assertions.map((a) => `- ${a.passed ? "PASS" : "FAIL"}: ${a.name}`).join("\n")}\n\n${r.limitation || ""}\n\n\`\`\`json\n${JSON.stringify(r.evidence, null, 2)}\n\`\`\`\n`,
          )
          .join("\n");
  const url = URL.createObjectURL(
    new Blob([text], {
      type: format === "json" ? "application/json" : "text/markdown",
    }),
  );
  const link = element("a");
  link.href = url;
  link.download = `oauth-simulation-report.${format === "json" ? "json" : "md"}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("filter").onchange = render;
$("run").onclick = () => execute(catalog);
$("cancel").onclick = () => controller?.abort();
$("export-json").onclick = () => exportReport("json");
$("export-md").onclick = () => exportReport("md");
try {
  const response = await fetch("/api/catalog");
  if (!response.ok) throw new Error("無法讀取情境");
  catalog = (await response.json()).catalog;
  $("catalog-count").textContent = `/ ${catalog.length}`;
  $("run").disabled = false;
  render();
} catch {
  $("status").textContent = "無法連接執行器，請重新啟動服務。";
}
