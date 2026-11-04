const $ = (id) => document.getElementById(id);
let catalog = [];
let results = new Map();
const resultGroups = new Map();
let environments = [];
let currentEnvironment;
let testingMode = "defense";
let loadingEnvironment = false;
let editingEnvironment;
const environmentMode = () =>
  currentEnvironment?.type === "http" ? "CUSTOM_HTTP" : "SIMULATION";
function environmentControls() {
  $("testing-mode").disabled = running || loadingEnvironment;
  $("attack-open").hidden = testingMode !== "attack";
  $("attack-open").disabled = !currentEnvironment || loadingEnvironment;
  $("attack-clear").disabled = running;
  for (const field of $("attack-form").querySelectorAll(
    "input, select, button[type=submit]",
  ))
    field.disabled = running;
  $("environment-open").disabled = !currentEnvironment || loadingEnvironment;
  $("environment-edit").hidden =
    !currentEnvironment || currentEnvironment.builtin;
  $("environment-select").disabled = running || loadingEnvironment;
  $("environment-new").disabled = running || loadingEnvironment;
  $("environment-edit").disabled =
    running ||
    loadingEnvironment ||
    !currentEnvironment ||
    currentEnvironment.builtin;
}
async function refreshEnvironments() {
  const response = await fetch("./api/environments");
  if (!response.ok) throw new Error("無法載入環境設定");
  environments = (await response.json()).environments;
  const validGroups = new Set(
    environments.flatMap((profile) =>
      ["defense", "attack"].map(
        (mode) => `${profile.id}:${profile.revision}:${mode}`,
      ),
    ),
  );
  for (const key of resultGroups.keys())
    if (!validGroups.has(key)) resultGroups.delete(key);
  $("environment-select").replaceChildren(
    ...environments.map((profile) => {
      const option = element("option", profile.name);
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
      "./api/catalog?environmentId=" +
        encodeURIComponent(id) +
        "&testingMode=" +
        testingMode,
    );
    if (!response.ok) throw new Error("無法載入環境；請重新整理設定");
    const data = await response.json();
    if (
      currentEnvironment?.id !== data.profile.id ||
      currentEnvironment?.revision !== data.profile.revision
    ) {
      clearAttackCredentials();
      $("attack-client").value = data.profile.clientId || "";
    }
    currentEnvironment = data.profile;
    $("startup-help").hidden = true;
    catalog = data.catalog;
    const key = `${currentEnvironment.id}:${currentEnvironment.revision}:${testingMode}`;
    if (!resultGroups.has(key)) resultGroups.set(key, new Map());
    results = resultGroups.get(key);
    selected = catalog[0]?.id;
    displayedScenario = undefined;
    $("scenario-search").value = "";
    $("filter").replaceChildren(
      element("option", "所有分類"),
      ...[...new Set(catalog.map((s) => s.category))].map((category) =>
        element("option", category),
      ),
    );
    $("filter").firstElementChild.value = "all";
    $("environment-select").value = currentEnvironment.id;
    $("environment-mode").textContent =
      currentEnvironment.type === "http" ? "HTTP 服務" : "隔離模擬";
    $("environment-mode").dataset.mode = environmentMode();
    $("environment-mode").classList.toggle(
      "http",
      currentEnvironment.type === "http",
    );
    $("environment-name").textContent = currentEnvironment.name;
    $("environment-summary").textContent =
      currentEnvironment.baseUrl || "隔離模擬 · 不連線外部服務";
    $("environment-open").title =
      `${currentEnvironment.name} · ${$("environment-summary").textContent}`;
    $("environment-target").textContent =
      currentEnvironment.baseUrl || "程式內建模擬器";
    $("environment-notice").textContent =
      currentEnvironment.type === "http"
        ? "只檢查公開端點與未登入請求；缺少必要設定的情境會標為待確認。"
        : "執行內建隔離模擬，不會連線到你的服務。通過不代表正式服務安全。";
    $("console").textContent =
      `[ready] ${currentEnvironment.name} · ${environmentMode()}。結果依環境及設定版本分開保留。`;
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
  $("environment-panel").close();
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
      "./api/environments" +
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
let displayedScenario;
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
      element("small", scenario.category),
    );
    const status = results.get(scenario.id)?.status || "未執行";
    button.append(
      label,
      element("span", statusLabel(status), `result ${status}`),
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
  $("pass-label").textContent = testingMode === "attack" ? "操作成功" : "通過";
  $("fail-label").textContent = testingMode === "attack" ? "被阻擋" : "未通過";
  $("pass").className = testingMode === "attack" ? "SUCCEEDED" : "PASS";
  $("fail").className = testingMode === "attack" ? "BLOCKED" : "FAIL";
  $("pass").textContent = values.filter(
    (r) => r.status === (testingMode === "attack" ? "SUCCEEDED" : "PASS"),
  ).length;
  $("fail").textContent = values.filter(
    (r) => r.status === (testingMode === "attack" ? "BLOCKED" : "FAIL"),
  ).length;
  $("error").textContent = values.filter((r) => r.status === "ERROR").length;
  $("inconclusive").textContent = values.filter(
    (r) => r.status === "INCONCLUSIVE",
  ).length;
  $("runner-status").hidden = true;
  $("export-json").disabled = $("export-md").disabled =
    running || !values.length;
  return visible;
}
function detail() {
  const scenario = catalog.find((s) => s.id === selected);
  if (!scenario) {
    const empty = element("div", undefined, "empty");
    empty.append(element("p", "選擇情境以查看預期行為與測試結果。"));
    $("detail").replaceChildren(empty);
    return;
  }
  const result = results.get(selected);
  const wrap = element("div", undefined, "detail-content");
  wrap.append(
    element(
      "span",
      statusLabel(result?.status || "未執行"),
      `result-badge ${result?.status || ""}`,
    ),
    element("h3", scenario.title),
    element("p", scenario.expected),
  );
  const run = element("button", "執行此情境", "primary");
  run.disabled = running;
  run.onclick = () => execute([scenario]);
  const actions = element("div", undefined, "detail-run");
  actions.append(run);
  wrap.append(actions);
  const technical = element("details", undefined, "technical");
  technical.append(
    element("summary", "測試前提與技術資訊"),
    element(
      "p",
      `${scenario.id} · ${scenario.prerequisites.join("、")} · 最多 ${scenario.requestBudget} 個請求`,
    ),
  );
  if (result)
    technical.append(
      element(
        "p",
        `${result.durationMs} ms · cleanup: ${result.cleanup} · revision ${result.revision}`,
      ),
    );
  wrap.append(technical);
  if (testingMode === "attack")
    wrap.append(
      element(
        "p",
        "以攻擊者能力判讀：操作成功不等於漏洞；被阻擋也不代表所有路徑安全。",
        "muted",
      ),
    );
  if (result) {
    if (result.observations?.length) {
      const observations = element("ul");
      for (const observation of result.observations)
        observations.append(element("li", observation));
      wrap.append(element("h4", "觀察到的能力與限制"), observations);
    }
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
          `斷言驗證（${result.assertions.filter((a) => a.passed).length} / ${result.assertions.length}）`,
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
      wrap.append(element("h4", "改善建議"), recommendations);
    }
    wrap.append(element("h4", `HTTP 證據（${result.evidence.length}）`));
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
  }
  $("detail").replaceChildren(wrap);
  if (displayedScenario !== selected) {
    $("detail").parentElement.scrollTop = 0;
    displayedScenario = selected;
  }
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
      const response = await fetch("./api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: scenario.id,
          environmentId: currentEnvironment.id,
          environmentRevision: currentEnvironment.revision,
          testingMode,
          ...(testingMode === "attack" ? { attack: attackInput() } : {}),
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
      : `執行完成 · ${currentEnvironment.name}`;
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
    environment: environmentMode(),
    testingMode,
    environmentId: currentEnvironment.id,
    environmentName: currentEnvironment.name,
    configuration: currentEnvironment,
    limitations: [
      ...(testingMode === "attack"
        ? [
            "僅記錄持有 client secret 的 client_credentials 與指定 GET 操作；非完整 OIDC 驗收，不代表使用者冒用或漏洞。",
          ]
        : []),
      testingMode === "attack"
        ? "憑證與取得的 token 不保存、不匯出；已簽發的 token 未自動撤銷，效期由目標管理。"
        : currentEnvironment.type === "http"
          ? "僅測試所選 HTTP 目標的公開及無 session 端點；未驗證真實登入、輪替、撤銷或瀏覽器 CORS。"
          : "僅驗證隔離模擬器；不代表 HTTP 目標、Google 登入、D1 或瀏覽器 CORS 通過。",
    ],
    results: [...results.values()],
  };
  const text =
    format === "json"
      ? JSON.stringify(report, null, 2)
      : `# OAuth 安全測試報告\n\n${report.environmentName} · ${report.environment} · ${report.testingMode} · ${report.generatedAt}\n\n目標：${currentEnvironment.baseUrl || "isolated fixture"}\n\n${report.limitations.join("\n")}\n\n` +
        report.results
          .map(
            (r) =>
              `## ${r.title} — ${r.status}\n\n${r.expected}\n\n${r.assertions.map((a) => `- ${a.passed ? "PASS" : "FAIL"}: ${a.name}`).join("\n")}\n\n${(r.observations || []).join("\n")}\n\n${r.limitation || ""}\n\n${(r.recommendations || []).map((item) => `- 建議：${item}`).join("\n")}\n\n\`\`\`json\n${JSON.stringify(r.evidence, null, 2)}\n\`\`\`\n`,
          )
          .join("\n");
  const url = URL.createObjectURL(
    new Blob([text], {
      type: format === "json" ? "application/json" : "text/markdown",
    }),
  );
  const link = element("a");
  link.href = url;
  link.download = `oauth-${currentEnvironment.type === "simulation" ? "simulation" : currentEnvironment.id}${testingMode === "attack" ? "-attack" : ""}-report.${format === "json" ? "json" : "md"}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function statusLabel(status) {
  return { SUCCEEDED: "操作成功", BLOCKED: "被阻擋" }[status] || status;
}
function attackInput() {
  return {
    clientId: $("attack-client").value,
    clientSecret: $("attack-secret").value,
    scope: $("attack-scope").value,
    authMethod: $("attack-auth").value,
    tokenPath: $("attack-token-path").value,
    resourcePath: $("attack-resource-path").value,
  };
}
function clearAttackResults() {
  for (const [key, group] of resultGroups)
    if (key.endsWith(":attack")) group.clear();
}
function clearAttackCredentials() {
  $("attack-form").reset();
  clearAttackResults();
}
$("testing-mode").onchange = async () => {
  const previous = testingMode;
  testingMode = $("testing-mode").value;
  if (testingMode !== "attack") {
    $("attack-secret").value = "";
    clearAttackResults();
  }
  try {
    await selectEnvironment(currentEnvironment.id);
  } catch {
    testingMode = previous;
    $("testing-mode").value = previous;
  }
};
$("attack-open").onclick = () => $("attack-dialog").showModal();
$("attack-close").onclick = () => $("attack-dialog").close();
$("attack-form").onsubmit = (event) => {
  event.preventDefault();
  $("attack-dialog").close();
};
$("attack-form").addEventListener("input", () => {
  clearAttackResults();
  if (testingMode === "attack") {
    render();
    detail();
  }
});
$("attack-clear").onclick = () => {
  clearAttackCredentials();
  render();
  detail();
};
function filterScenarios() {
  const visible = render();
  if (!visible.some((s) => s.id === selected)) selected = visible[0]?.id;
  render();
  detail();
}
$("filter").onchange = filterScenarios;
$("scenario-search").oninput = filterScenarios;
$("run").onclick = () => execute(catalog);
$("cancel").onclick = () => controller?.abort();
for (const [id, format] of [
  ["export-json", "json"],
  ["export-md", "md"],
]) {
  $(id).onclick = () => {
    exportReport(format);
    document.querySelector(".export-menu").open = false;
  };
}
document.addEventListener("click", (event) => {
  const menu = document.querySelector(".export-menu");
  if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    document.querySelector(".export-menu").open = false;
});
$("environment-select").onchange = () =>
  selectEnvironment($("environment-select").value).catch(() => {});
$("environment-open").onclick = () => $("environment-panel").showModal();
$("environment-panel-close").onclick = $("environment-panel-done").onclick =
  () => $("environment-panel").close();
$("environment-dialog").addEventListener("close", () =>
  $("environment-panel").showModal(),
);
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
  $("runner-status").textContent = "OFFLINE";
  $("startup-help").hidden = false;
}
