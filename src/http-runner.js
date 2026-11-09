import {
  oidcCatalog,
  arrayCatalog,
  serviceHandlers,
} from "./service-profiles.js";
import { httpHandlers } from "./http-scenarios.js";
import { randomUUID } from "node:crypto";
import { catalog, redact } from "./runner.js";

const supported = [
  "jwks",
  "discovery",
  "client-invalid",
  "redirect-exact",
  "state-bounds",
  "token-client",
  "token-origin",
  "token-session",
  "security-headers",
];
const expectations = {
  jwks: "公開端點回傳有效的 ES256 P-256 公鑰結構且不包含私密欄位；簽章一致性另需 session。",
  "security-headers":
    "盤點未登入錯誤回應的標頭；成功 token 回應快取策略尚未驗證。",
  "redirect-exact":
    "先確認合法 client / redirect 可建立交易，再驗證修改後的 redirect 被拒絕。",
  "state-bounds":
    "先確認合法 client / redirect / state 可建立交易，再驗證空或超長 state 被拒絕。",
};
export const httpCatalog = [
  {
    id: "health",
    title: "服務健康檢查",
    category: "Service",
    severity: "info",
    expected: "實際目標 /health 回傳 JSON ok:true",
    revision: 1,
    requestBudget: 1,
    prerequisites: ["已儲存的目標網址"],
  },
  ...catalog
    .filter((s) => supported.includes(s.id))
    .map((s) => ({
      ...s,
      revision: 2,
      expected: expectations[s.id] || s.expected,
      remediation:
        "對照所選 HTTP 目標的規格檢查結果；缺少已登記的設定應先補齊前置條件。",
      requestBudget: 4,
      prerequisites: [
        "已儲存的 HTTP 環境；部分情境需已登記 client / Origin / redirect URI",
      ],
    })),
];

export function getHttpCatalog(environment) {
  return (
    { "auth-service-oidc": oidcCatalog, "array-session": arrayCatalog }[
      environment.protocol
    ] || httpCatalog
  );
}
export function createHttpRunner({ minimumInterval = 500 } = {}) {
  const lastRequests = new Map();
  const cooldowns = new Map();
  return async function runHttpScenario(id, environment, { signal } = {}) {
    const scenario = getHttpCatalog(environment).find((s) => s.id === id);
    if (!scenario) throw new Error("Unknown HTTP scenario");
    const result = {
      ...scenario,
      timestamp: new Date().toISOString(),
      environment: "CUSTOM_HTTP",
      environmentId: environment.id,
      environmentName: environment.name,
      environmentRevision: environment.revision,
      target: environment.baseUrl,
      configuration: { ...environment },
      status: "ERROR",
      assertions: [],
      evidence: [],
      cleanup: "not-needed",
    };
    const started = performance.now();
    const check = (name, passed) =>
      result.assertions.push({ name, passed: Boolean(passed) });
    const missing = [];
    if (
      [
        "redirect-exact",
        "state-bounds",
        "token-origin",
        "token-session",
        "security-headers",
      ].includes(id) &&
      !environment.clientId
    )
      missing.push("client ID");
    if (
      ["state-bounds", "redirect-exact"].includes(id) &&
      !environment.redirectUri
    )
      missing.push("已登記 redirect URI");
    if (
      ["token-session", "security-headers"].includes(id) &&
      !environment.origin
    )
      missing.push("已登記 Origin");
    try {
      if ((cooldowns.get(environment.baseUrl) || 0) > Date.now()) {
        result.status = "INCONCLUSIVE";
        result.rateLimited = true;
        result.retryAfterSeconds = Math.ceil(
          (cooldowns.get(environment.baseUrl) - Date.now()) / 1000,
        );
        result.limitation = `目標仍在限流等待期（${result.retryAfterSeconds} 秒），未送出請求。`;
        return result;
      }
      if (missing.length) {
        result.status = "INCONCLUSIVE";
        result.limitation = `尚未設定 ${missing.join("、")}，未送出請求。`;
        return result;
      }
      async function request(path, options = {}) {
        signal?.throwIfAborted();
        if (result.evidence.length >= scenario.requestBudget)
          throw new Error("Budget exceeded");
        const remaining =
          minimumInterval -
          (Date.now() - (lastRequests.get(environment.baseUrl) || 0));
        if (remaining > 0)
          await new Promise((resolve, reject) => {
            const timer = setTimeout(done, remaining);
            function done() {
              signal?.removeEventListener("abort", cancel);
              resolve();
            }
            function cancel() {
              clearTimeout(timer);
              signal?.removeEventListener("abort", cancel);
              reject(new Error("Cancelled"));
            }
            signal?.addEventListener("abort", cancel, { once: true });
            if (signal?.aborted) cancel();
          });
        signal?.throwIfAborted();
        const url = new URL(path, environment.baseUrl);
        if (url.origin !== environment.baseUrl)
          throw new Error("Target mismatch");
        lastRequests.set(environment.baseUrl, Date.now());
        const timeout = AbortSignal.timeout(5000);
        const response = await fetch(url, {
          ...options,
          redirect: "manual",
          credentials: "omit",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        // Never persist unstructured HTML/error text or forward cookies to another request.
        let bytes = 0;
        const chunks = [];
        try {
          for await (const chunk of response.body || []) {
            bytes += chunk.length;
            if (bytes > 64 * 1024) throw new Error("Response too large");
            chunks.push(chunk);
          }
        } catch {
          await response.body?.cancel().catch(() => {});
          throw new Error("Response could not be read");
        }
        let body;
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          body =
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? parsed
              : { nonObjectJson: true, bytes };
        } catch {
          body = { nonJson: true, bytes };
        }
        const headers = Object.fromEntries(response.headers);
        result.evidence.push(
          redact({
            request: {
              method: options.method || "GET",
              url: url.href,
              headers: options.headers || {},
              body: options.body ? JSON.parse(options.body) : undefined,
            },
            response: {
              status: response.status,
              headers,
              body:
                environment.protocol === "array-session"
                  ? {
                      service:
                        body.service === "array-sso-test"
                          ? body.service
                          : undefined,
                      status: body.status === "up" ? body.status : undefined,
                      error:
                        body.error === "login_required"
                          ? body.error
                          : undefined,
                      userPresent: typeof body.user?.sub === "string",
                      expiryPresent: Number.isFinite(body.expiresAt),
                      nonJson: body.nonJson,
                    }
                  : body,
            },
          }),
        );
        if (response.status === 429) {
          const raw = headers["retry-after"];
          const seconds = /^\d+$/.test(raw || "")
            ? Number(raw)
            : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
          result.rateLimited = true;
          result.retryAfterSeconds = Number.isFinite(seconds)
            ? Math.min(3600, Math.max(1, seconds))
            : 60;
          cooldowns.set(
            environment.baseUrl,
            Date.now() + result.retryAfterSeconds * 1000,
          );
          const error = new Error("Rate limited");
          error.rateLimited = true;
          throw error;
        }
        return { status: response.status, headers, body };
      }
      if (Object.hasOwn(serviceHandlers, id)) {
        await serviceHandlers[id]({ request, check, result, environment });
        if (result.status !== "INCONCLUSIVE")
          result.status =
            result.assertions.length && result.assertions.every((a) => a.passed)
              ? "PASS"
              : "FAIL";
        return result;
      }
      const unknown = `dashboard-unregistered-${randomUUID()}`;
      const authorize = (overrides = {}) =>
        "/authorize?" +
        new URLSearchParams({
          client_id: environment.clientId || unknown,
          redirect_uri:
            environment.redirectUri || "https://dashboard.invalid/callback",
          state: "dashboard-probe",
          ...overrides,
        });
      const token = (client, origin) =>
        request("/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(origin ? { Origin: origin } : {}),
          },
          body: JSON.stringify({ client_id: client }),
        });
      const noIssuance = (r) =>
        !r.body.access_token && !r.headers.location && !r.headers["set-cookie"];
      if (["redirect-exact", "state-bounds"].includes(id)) {
        const baseline = await request(authorize());
        if (
          baseline.status !== 302 ||
          !baseline.headers.location ||
          !/oauth_state=/.test(baseline.headers["set-cookie"] || "")
        ) {
          result.status = "INCONCLUSIVE";
          result.limitation =
            "合法設定未能建立 OAuth 交易，尚不能驗證此控制。請確認已登記的 client ID / redirect URI 與目標存取條件。";
          return result;
        }
        check("合法設定可建立交易（不跟隨 provider redirect）", true);
        result.cleanup = "server-expiry";
        result.limitation =
          "只建立短期 OAuth 交易作為合法設定對照；未登入或保留 cookie，交易由目標的期限機制清理。";
      }
      await httpHandlers[id]({
        id,
        environment,
        result,
        request,
        check,
        authorize,
        token,
        unknown,
        noIssuance,
      });
      if (result.status !== "INCONCLUSIVE")
        result.status =
          result.assertions.length && result.assertions.every((a) => a.passed)
            ? "PASS"
            : "FAIL";
    } catch (error) {
      result.status = error.rateLimited ? "INCONCLUSIVE" : "ERROR";
      result.error = signal?.aborted
        ? "Run cancelled"
        : error.rateLimited
          ? "目標已限流，停止此情境；稍後重試。"
          : "無法完成目標請求；請檢查連線、TLS 與環境網路設定。";
    } finally {
      result.durationMs = Math.round(performance.now() - started);
    }
    return result;
  };
}
