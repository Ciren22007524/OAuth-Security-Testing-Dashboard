import { createAttackFixture } from "./attack-fixture.js";
import {
  attackCatalog,
  validateAttackInput,
  demoSettings,
} from "./attack-catalog.js";
import { attackHandlers } from "./attack-scenarios.js";
export { attackCatalog, validateAttackInput } from "./attack-catalog.js";

export function createAttackRunner({ minimumInterval = 500 } = {}) {
  const lastRequests = new Map();
  const cooldowns = new Map();
  return async function runAttack(
    id,
    environment,
    input,
    { signal, fixtureOptions } = {},
  ) {
    const scenario = attackCatalog.find((s) => s.id === id);
    if (!scenario) throw new Error("Unknown attack scenario");
    const settings = validateAttackInput(input, id);
    const result = {
      ...scenario,
      timestamp: new Date().toISOString(),
      environment:
        environment.type === "simulation" ? "SIMULATION" : "CUSTOM_HTTP",
      environmentId: environment.id,
      environmentName: environment.name,
      environmentRevision: environment.revision,
      configuration: {
        id: environment.id,
        name: environment.name,
        type: environment.type,
        revision: environment.revision,
        ...(environment.baseUrl ? { baseUrl: environment.baseUrl } : {}),
      },
      target: environment.baseUrl || "isolated-attack-fixture",
      status: "INCONCLUSIVE",
      assertions: [],
      observations: [],
      evidence: [],
      cleanup: "not-needed",
      limitation:
        "只驗證本情境提供的參數；取得的 token 與個人資料不保存、不匯出。已簽發 token 未自動撤銷，效期由目標管理。",
    };
    const started = performance.now();
    let fixture;
    try {
      if (environment.type === "simulation") {
        fixture = await createAttackFixture(fixtureOptions);
        for (const [key, value] of Object.entries(demoSettings(id)))
          if (!settings[key]) settings[key] = value;
      }
      const missing = scenario.required.filter((key) => !settings[key]);
      if (missing.length) {
        result.limitation = `本情境尚未填寫：${missing.map((key) => scenario.fields.find((f) => f.key === key).label).join("、")}。未送出請求。`;
        return result;
      }
      const base = fixture?.url || environment.baseUrl;
      const secrets = [
        settings.clientSecret,
        settings.accessToken,
        settings.refreshToken,
        settings.code,
        settings.codeVerifier,
      ];
      const safe = (value) =>
        typeof value === "string"
          ? secrets
              .filter(Boolean)
              .reduce(
                (text, secret) =>
                  text
                    .replaceAll(secret, "[REDACTED]")
                    .replaceAll(encodeURIComponent(secret), "[REDACTED]"),
                value,
              )
              .slice(0, 1024)
          : value;
      async function request(endpoint, options = {}) {
        signal?.throwIfAborted();
        const url = new URL(endpoint, base);
        if (url.origin !== base || url.username || url.password || url.hash)
          throw new Error("Endpoint outside selected target");
        if ((cooldowns.get(base) || 0) > Date.now()) {
          result.rateLimited = true;
          throw new Error("Rate limited");
        }
        if (result.evidence.length >= scenario.requestBudget)
          throw new Error("Request budget exceeded");
        const remaining =
          minimumInterval - (Date.now() - (lastRequests.get(base) || 0));
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
        lastRequests.set(base, Date.now());
        const response = await fetch(url, {
          ...options,
          redirect: "manual",
          credentials: "omit",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
            : AbortSignal.timeout(5000),
        });
        let bytes = 0;
        const chunks = [];
        for await (const chunk of response.body || []) {
          bytes += chunk.length;
          if (bytes > 65536) throw new Error("Response too large");
          chunks.push(chunk);
        }
        let body = {};
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString());
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            body = parsed;
        } catch {}
        if (typeof body.access_token === "string")
          secrets.push(body.access_token);
        if (typeof body.id_token === "string") secrets.push(body.id_token);
        if (typeof body.refresh_token === "string")
          secrets.push(body.refresh_token);
        const knownErrors = [
          "invalid_client",
          "unauthorized_client",
          "unsupported_grant_type",
          "invalid_scope",
          "invalid_grant",
          "invalid_request",
          "invalid_token",
          "insufficient_scope",
        ];
        const form = options.body
          ? new URLSearchParams(options.body)
          : undefined;
        result.evidence.push({
          request: {
            method: options.method || "GET",
            url: safe(url.href),
            headers: {
              ...(options.headers?.["Content-Type"]
                ? { "Content-Type": options.headers["Content-Type"] }
                : {}),
              ...(options.headers?.Authorization
                ? { Authorization: "[REDACTED]" }
                : {}),
            },
            body: form
              ? {
                  grant_type: form.get("grant_type"),
                  ...(form.has("client_id")
                    ? { client_id: safe(form.get("client_id")) }
                    : {}),
                  ...Object.fromEntries(
                    ["client_secret", "refresh_token", "code", "code_verifier"]
                      .filter((key) => form.has(key))
                      .map((key) => [key, "[REDACTED]"]),
                  ),
                  ...(form.has("redirect_uri")
                    ? { redirect_uri: safe(form.get("redirect_uri")) }
                    : {}),
                  ...(form.has("scope")
                    ? { scope: safe(form.get("scope")) }
                    : {}),
                }
              : undefined,
          },
          response: {
            status: response.status,
            body: {
              bytes,
              accessTokenPresent:
                typeof body.access_token === "string" &&
                Boolean(body.access_token),
              subjectPresent: typeof body.sub === "string" && Boolean(body.sub),
              idTokenPresent:
                typeof body.id_token === "string" && Boolean(body.id_token),
              error: knownErrors.includes(body.error) ? body.error : undefined,
              scope:
                typeof body.scope === "string" ? safe(body.scope) : undefined,
            },
          },
        });
        if (response.status === 429) {
          const value = response.headers.get("retry-after");
          const seconds = /^\d+$/.test(value || "")
            ? Number(value)
            : Math.ceil((Date.parse(value) - Date.now()) / 1000);
          result.rateLimited = true;
          cooldowns.set(
            base,
            Date.now() +
              (Number.isFinite(seconds)
                ? Math.min(3600, Math.max(1, seconds))
                : 60) *
                1000,
          );
          throw new Error("Rate limited");
        }
        return { status: response.status, body };
      }
      let metadata;
      async function discovery() {
        if (metadata) return metadata;
        const response = await request("/.well-known/openid-configuration");
        if (
          response.status !== 200 ||
          typeof response.body.issuer !== "string" ||
          new URL(response.body.issuer).origin !== base
        ) {
          result.limitation =
            "無法取得同目標的 OIDC discovery；請確認目標或指定端點路徑。";
          return;
        }
        metadata = response.body;
        return metadata;
      }
      async function endpoint(key, override) {
        if (override) return override;
        const document = await discovery();
        if (!document || typeof document[key] !== "string") {
          result.limitation =
            "Discovery 未提供本情境需要的端點；請明確指定同目標的路徑。";
          return;
        }
        const url = new URL(document[key]);
        if (url.origin !== base || url.username || url.password || url.hash)
          throw new Error("Endpoint outside selected target");
        return url.href;
      }
      async function exchange(parameters) {
        const target = await endpoint("token_endpoint", settings.tokenPath);
        if (!target) return;
        let auth = settings.authMethod || "auto";
        if (auth === "auto") {
          const document = settings.tokenPath ? undefined : await discovery();
          const methods = document?.token_endpoint_auth_methods_supported || [
            "client_secret_basic",
          ];
          auth = ["client_secret_basic", "client_secret_post"].find(
            (method) => Array.isArray(methods) && methods.includes(method),
          );
          if (!auth) {
            result.status = "INCONCLUSIVE";
            result.limitation =
              "Discovery 未宣告支援此情境的 client secret 認證；未傳送憑證。";
            return;
          }
        }
        if (auth !== "none" && !settings.clientSecret) {
          result.status = "INCONCLUSIVE";
          result.limitation =
            "此認證方式需要本情境的 client secret；公開 client 請明確選擇不附 secret。";
          return;
        }
        const body = new URLSearchParams(parameters);
        const headers = { "Content-Type": "application/x-www-form-urlencoded" };
        if (auth === "client_secret_basic") {
          const encode = (value) =>
            new URLSearchParams({ v: value }).toString().slice(2);
          headers.Authorization = `Basic ${Buffer.from(`${encode(settings.clientId)}:${encode(settings.clientSecret)}`).toString("base64")}`;
        } else {
          body.set("client_id", settings.clientId);
          if (auth === "client_secret_post")
            body.set("client_secret", settings.clientSecret);
        }
        return request(target, {
          method: "POST",
          headers,
          body: body.toString(),
        });
      }
      await attackHandlers[id]({
        exchange,
        endpoint,
        request,
        settings,
        result,
      });
    } catch {
      result.status = result.rateLimited ? "INCONCLUSIVE" : "ERROR";
      result.error = signal?.aborted
        ? "已停止操作。"
        : result.rateLimited
          ? "目標限流，已停止；稍後再試。"
          : "無法完成請求；請確認連線、端點與回應格式。未跟隨重新導向或跨目標轉送憑證。";
    } finally {
      if (fixture) {
        lastRequests.delete(fixture.url);
        cooldowns.delete(fixture.url);
        await fixture.close();
      }
      result.durationMs = Math.round(performance.now() - started);
    }
    return result;
  };
}
