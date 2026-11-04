const $ = (id) => document.getElementById(id);
let catalog = [];
let results = new Map();
const resultGroups = new Map();
let environments = [];
let currentEnvironment;
let loadingEnvironment = false;
let editingEnvironment;
const mode = () =>
  currentEnvironment?.type === "http" ? "CUSTOM_HTTP" : "SIMULATION";
function environmentControls() {
  $("environment-select").disabled = running || loadingEnvironment;
  $("environment-new").disabled = running || loadingEnvironment;
  $("environment-edit").disabled =
    running ||
    loadingEnvironment ||
    !currentEnvironment ||
    currentEnvironment.builtin;
}
async function refreshEnvironments() {
  const response = await fetch("/api/environments");
  if (!response.ok) throw new Error("無法載入環境設定");
  environments = (await response.json()).environments;
  $("environment-count").textContent = `${environments.length} 個環境`;
  const validGroups = new Set(
    environments.map((profile) => `${profile.id}:${profile.revision}`),
  );
  for (const key of resultGroups.keys())
    if (!validGroups.has(key)) resultGroups.delete(key);
  $("environment-select").replaceChildren(
    ...environments.map((profile) => {
      const option = element(
        "option",
        `${profile.name} · ${profile.type === "http" ? "HTTP" : "模擬"}`,
      );
      option.value = profile.id;
      return option;
    }),
  );
}
async function selectEnvironment(id) {
  if (running) {
    $("environment-select").value = currentEnvironment.id;
    return;
  }
  loadingEnvironment = true;
  $("run").disabled = true;
  environmentControls();
  try {
    const response = await fetch(
      "/api/catalog?environmentId=" + encodeURIComponent(id),
    );
    if (!response.ok) throw new Error("無法載入環境；請重新整理設定");
    const data = await response.json();
    currentEnvironment = data.profile;
    catalog = data.catalog;
    const key = `${currentEnvironment.id}:${currentEnvironment.revision}`;
    if (!resultGroups.has(key)) resultGroups.set(key, new Map());
    results = resultGroups.get(key);
    selected = undefined;
    $("environment-select").value = currentEnvironment.id;
    $("environment-mode").textContent = "● " + mode();
    $("environment-mode").classList.toggle(
      "http",
      currentEnvironment.type === "http",
    );
    $("environment-target").textContent =
      currentEnvironment.baseUrl || "隔離協定模擬器";
    $("environment-notice").textContent =
      currentEnvironment.type === "http"
        ? `HTTP 目標：${currentEnvironment.baseUrl}。只執行無登入 session 的有界檢查，不跟隨重新導向；缺少設定會標為待確認。`
        : "此處測量本機隔離 fixture。結果不代表任何 HTTP 目標或正式服務已通過。";
    $("catalog-count").textContent = `/ ${catalog.length}`;
    $("console").textContent =
      `[ready] ${currentEnvironment.name} · ${mode()}。結果依環境及設定版本分開保留。`;
    $("status").textContent = `就緒 · ${currentEnvironment.name}`;
    try {
      sessionStorage.setItem("oauth-environment-id", currentEnvironment.id);
    } catch {}
    render();
    detail();
  } catch (error) {
    if (currentEnvironment)
      $("environment-select").value = currentEnvironment.id;
    $("status").textContent = error.message;
    throw error;
  } finally {
    loadingEnvironment = false;
    $("run").disabled = !currentEnvironment;
    environmentControls();
  }
}
function profileFields() {
  const http = $("profile-type").value === "http";
  $("http-profile-fields").hidden = !http;
  $("profile-url").required = http;
  for (const input of $("http-profile-fields").querySelectorAll("input"))
    input.disabled = !http;
}
function openEnvironment(profile) {
  editingEnvironment = profile;
  $("environment-dialog-title").textContent = profile ? "管理環境" : "新增環境";
  $("profile-name").value = profile?.name || "";
  $("profile-type").value = profile?.type || "http";
  $("profile-url").value = profile?.baseUrl || "";
  $("profile-client").value = profile?.clientId || "";
  $("profile-origin").value = profile?.origin || "";
  $("profile-redirect").value = profile?.redirectUri || "";
  $("environment-delete").hidden = !profile;
  $("environment-error").textContent = "";
  profileFields();
  $("environment-dialog").showModal();
}
async function saveEnvironment(remove = false) {
  const form = $("environment-form");
  const buttons = [...form.querySelectorAll("button")];
  buttons.forEach((button) => {
    button.disabled = true;
  });
  $("environment-error").textContent = "";
  try {
    const data = remove
      ? { revision: editingEnvironment.revision }
      : {
          name: $("profile-name").value,
          type: $("profile-type").value,
          ...($("profile-type").value === "http"
            ? {
                baseUrl: $("profile-url").value,
                clientId: $("profile-client").value,
                origin: $("profile-origin").value,
                redirectUri: $("profile-redirect").value,
              }
            : {}),
          ...(editingEnvironment
            ? { revision: editingEnvironment.revision }
            : {}),
        };
    const response = await fetch(
      "/api/environments" +
        (editingEnvironment ? "/" + editingEnvironment.id : ""),
      {
        method: remove ? "DELETE" : editingEnvironment ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    );
    const body = await response.json();
    if (!response.ok) {
      const messages = {
        invalid_url:
          "網址需為 HTTP(S)，且不可含帳密、query 或 fragment；服務網址／Origin 不含路徑。",
        invalid_environment: "請確認環境名稱及各欄位格式。",
        environment_changed: "設定已被其他頁面修改，請關閉後重新整理。",
        unsupported_target: "不支援雲端 metadata 位址。",
        environment_limit: "已達 100 個自訂環境上限。",
      };
      throw new Error(
        messages[body.error] || `無法儲存環境（${response.status}）`,
      );
    }
    await refreshEnvironments();
    await selectEnvironment(remove ? "local" : body.id);
    $("environment-dialog").close();
  } catch (error) {
    $("environment-error").textContent = error.message;
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}
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
  const needle = $("scenario-search").value.trim().toLowerCase();
  const visible = catalog.filter(
    (s) =>
      ($("filter").value === "all" || s.category === $("filter").value) &&
      `${s.title} ${s.id} ${s.category} ${s.expected}`
        .toLowerCase()
        .includes(needle),
  );
  for (const scenario of visible) {
    const button = element(
      "button",
      undefined,
      `scenario${selected === scenario.id ? " selected" : ""}`,
    );
    button.setAttribute("aria-pressed", String(selected === scenario.id));
    const label = element("span", undefined, "case-label");
    label.append(
      element("strong", scenario.title),
      element(
        "small",
        `${scenario.category.toUpperCase()}  /  ${scenario.severity.toUpperCase()}`,
      ),
    );
    const status = results.get(scenario.id)?.status || "未執行";
    const icon =
      { OAuth: "↗", Session: "⌁", JWT: "◇", Browser: "◎", Service: "⌘" }[
        scenario.category
      ] || "◈";
    const symbol = element("span", icon, "case-symbol");
    symbol.setAttribute("aria-hidden", "true");
    const arrow = element("span", "›", "case-arrow");
    arrow.setAttribute("aria-hidden", "true");
    button.append(
      symbol,
      label,
      element("span", status, `result ${status}`),
      arrow,
    );
    button.onclick = () => {
      selected = scenario.id;
      render();
      detail();
    };
    $("catalog").append(button);
  }
  if (!visible.length)
    $("catalog").append(
      element(
        "div",
        "找不到符合的情境，試試其他關鍵字或分類。",
        "catalog-empty",
      ),
    );
  $("visible-count").textContent = `${visible.length} 個情境`;
  const values = [...results.values()];
  $("total").textContent = values.length;
  $("pass").textContent = values.filter((r) => r.status === "PASS").length;
  $("fail").textContent = values.filter((r) =>
    ["FAIL", "ERROR"].includes(r.status),
  ).length;
  $("inconclusive").textContent = values.filter(
    (r) => r.status === "INCONCLUSIVE",
  ).length;
  $("coverage-progress").max = catalog.length || 1;
  $("coverage-progress").value = values.length;
  $("coverage-label").textContent =
    `${values.length} / ${catalog.length} 已完成`;
  $("runner-status").textContent = running ? "RUNNING" : "RUNNER READY";
  $("runner-status").dataset.state = running ? "running" : "ready";
  $("export-json").disabled = $("export-md").disabled =
    running || !values.length;
}
function detail() {
  const scenario = catalog.find((s) => s.id === selected);
  if (!scenario) {
    const empty = element("div", undefined, "empty");
    const orbit = element("div", undefined, "empty-orbit");
    orbit.setAttribute("aria-hidden", "true");
    orbit.append(element("span", "◇", "empty-core"));
    const steps = element("div", undefined, "empty-steps");
    steps.append(
      element("span", "選擇情境"),
      element("b", "→"),
      element("span", "驗證斷言"),
      element("b", "→"),
      element("span", "追溯證據"),
    );
    empty.append(
      orbit,
      element("h3", "每個結論，都從證據開始"),
      element("p", "選擇左側情境，探索預期行為與實際回應。"),
      steps,
    );
    $("detail").replaceChildren(empty);
    return;
  }
  const result = results.get(selected);
  const wrap = element("div", undefined, "detail-content");
  wrap.append(
    element(
      "span",
      `${result?.status || "未執行"} · ${result?.environment || mode()}`,
      `result-badge ${result?.status || ""}`,
    ),
    element("h3", scenario.title),
    element("p", scenario.expected),
  );
  const run = element("button", "▶ 執行此情境", "primary");
  run.disabled = running;
  run.onclick = () => execute([scenario]);
  const actions = element("div", undefined, "detail-run");
  actions.append(element("small", scenario.id), run);
  wrap.append(
    actions,
    element("h4", "前置條件 / REQUEST BUDGET"),
    element(
      "p",
      `${scenario.prerequisites.join("、")} · 最多 ${scenario.requestBudget} 個請求`,
      "request-budget",
    ),
  );
  if (result) {
    if (result.assertions.length) {
      const list = element("ul", undefined, "assertion-list");
      for (const assertion of result.assertions)
        list.append(
          element(
            "li",
            `${assertion.passed ? "✓" : "✕"}  ${assertion.name}`,
            assertion.passed ? "PASS" : "FAIL",
          ),
        );
      wrap.append(
        element(
          "h4",
          `斷言驗證 / ${result.assertions.filter((a) => a.passed).length} OF ${result.assertions.length}`,
        ),
        list,
      );
    }
    if (result.limitation || result.error)
      wrap.append(
        element("p", result.limitation || result.error, "result-note"),
      );
    if (result.recommendations?.length) {
      const recommendations = element("ul");
      for (const recommendation of result.recommendations)
        recommendations.append(element("li", recommendation));
      wrap.append(element("h4", "改善建議 / RECOMMENDATIONS"), recommendations);
    }
    wrap.append(element("h4", `HTTP 證據 / ${result.evidence.length} RECORDS`));
    for (const [index, record] of result.evidence.entries()) {
      const item = element("details", undefined, "evidence-item");
      item.open = index === 0;
      const summary = element("summary");
      summary.append(
        element("strong", record.request.method),
        element("code", String(record.response.status)),
        element("span", record.request.path || record.request.url),
      );
      item.append(summary, element("pre", JSON.stringify(record, null, 2)));
      wrap.append(item);
    }
    if (!result.evidence.length)
      wrap.append(element("p", "此情境沒有 HTTP 請求，請參閱斷言與測試限制。"));
    wrap.append(
      element(
        "p",
        `${result.durationMs} ms  ·  cleanup: ${result.cleanup}  ·  revision ${result.revision}`,
        "result-footnote",
      ),
    );
  }
  $("detail").replaceChildren(wrap);
}
function log(text) {
  $("console").textContent += `\n[${new Date().toLocaleTimeString()}] ${text}`;
  $("console").scrollTop = $("console").scrollHeight;
}
async function execute(scenarios) {
  if (running) return;
  running = true;
  environmentControls();
  controller = new AbortController();
  $("run").disabled = true;
  $("cancel").disabled = false;
  render();
  detail();
  let rateLimited = false;
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
        body: JSON.stringify({
          id: scenario.id,
          environmentId: currentEnvironment.id,
          environmentRevision: currentEnvironment.revision,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`執行器 HTTP ${response.status}`);
      const result = await response.json();
      results.set(scenario.id, result);
      log(
        `[${currentEnvironment.name}] ${result.status.padEnd(12)} ${scenario.title} · ${result.durationMs} ms`,
      );
      render();
      detail();
      if (result.rateLimited) {
        rateLimited = true;
        break;
      }
      // At most four scenario starts per second from this UI.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    $("status").textContent = rateLimited
      ? "目標回報限流，已停止剩餘情境；請等待 Retry-After 再執行。"
      : `執行完成 · ${currentEnvironment.name} · ${mode()}`;
  } catch (error) {
    const message = controller.signal.aborted
      ? "已停止；已完成的結果保留，未執行項目不計入。"
      : error.message;
    $("status").textContent = message;
    log(message);
  } finally {
    running = false;
    environmentControls();
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
    environment: mode(),
    environmentId: currentEnvironment.id,
    environmentName: currentEnvironment.name,
    configuration: currentEnvironment,
    limitations: [
      currentEnvironment.type === "http"
        ? "僅測試所選 HTTP 目標的公開及無 session 端點；未驗證真實登入、輪替、撤銷或瀏覽器 CORS。"
        : "僅驗證隔離模擬器；不代表 HTTP 目標、Google 登入、D1 或瀏覽器 CORS 通過。",
    ],
    results: [...results.values()],
  };
  const text =
    format === "json"
      ? JSON.stringify(report, null, 2)
      : `# OAuth 安全測試報告\n\n${report.environmentName} · ${report.environment} · ${report.generatedAt}\n\n目標：${currentEnvironment.baseUrl || "isolated fixture"}\n\n${report.limitations.join("\n")}\n\n` +
        report.results
          .map(
            (r) =>
              `## ${r.title} — ${r.status}\n\n${r.expected}\n\n${r.assertions.map((a) => `- ${a.passed ? "PASS" : "FAIL"}: ${a.name}`).join("\n")}\n\n${r.limitation || ""}\n\n${(r.recommendations || []).map((item) => `- 建議：${item}`).join("\n")}\n\n\`\`\`json\n${JSON.stringify(r.evidence, null, 2)}\n\`\`\`\n`,
          )
          .join("\n");
  const url = URL.createObjectURL(
    new Blob([text], {
      type: format === "json" ? "application/json" : "text/markdown",
    }),
  );
  const link = element("a");
  link.href = url;
  link.download = `oauth-${currentEnvironment.type === "simulation" ? "simulation" : currentEnvironment.id}-report.${format === "json" ? "json" : "md"}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("filter").onchange = render;
$("scenario-search").oninput = render;
$("run").onclick = () => execute(catalog);
$("cancel").onclick = () => controller?.abort();
$("export-json").onclick = () => exportReport("json");
$("export-md").onclick = () => exportReport("md");
$("environment-select").onchange = () =>
  selectEnvironment($("environment-select").value).catch(() => {});
$("environment-new").onclick = () => openEnvironment();
$("environment-edit").onclick = () => openEnvironment(currentEnvironment);
$("environment-close").onclick = () => $("environment-dialog").close();
$("profile-type").onchange = profileFields;
$("environment-form").onsubmit = (event) => {
  event.preventDefault();
  saveEnvironment();
};
$("environment-delete").onclick = () => saveEnvironment(true);
try {
  await refreshEnvironments();
  let id = "local";
  try {
    id = sessionStorage.getItem("oauth-environment-id") || id;
  } catch {}
  await selectEnvironment(
    environments.some((profile) => profile.id === id) ? id : "local",
  );
} catch {
  $("status").textContent = "無法連接執行器或讀取環境設定，請檢查服務。";
}
