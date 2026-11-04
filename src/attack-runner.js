import {
  createAttackFixture,
  DEMO_CLIENT,
  DEMO_SECRET,
} from "./attack-fixture.js";

export const attackCatalog = [
  {
    id: "secret-token",
    title: "持有 client secret：嘗試取得 access token",
    expected:
      "以 client_credentials 嘗試取得 token；成功只證明 client 能力，不代表可冒用使用者或取得 ID token。",
  },
  {
    id: "secret-resource",
    title: "持有 client secret：嘗試讀取指定資源",
    expected:
      "先確認指定 GET 路徑未附憑證回 401／403，再取得 token 比較能否讀取；只記錄該路徑的能力。",
  },
].map((s) => ({
  ...s,
  category: "Client secret",
  revision: 1,
  requestBudget: s.id === "secret-resource" ? 4 : 2,
  prerequisites: [
    "client ID 與 client secret；HTTP 目標須支援標準 OAuth token 請求",
  ],
  testingMode: "attack",
}));

function path(value) {
  if (
    typeof value !== "string" ||
    !/^\/(?!\/)/.test(value) ||
    /[\\?#\u0000-\u0020\u007f]/.test(value)
  )
    throw new Error("Invalid endpoint path");
  const parsed = new URL(value, "http://target.invalid");
  if (parsed.origin !== "http://target.invalid" || parsed.pathname !== value)
    throw new Error("Invalid endpoint path");
  return value;
}
export function validateAttackInput(input = {}) {
  const fields = [
    "clientId",
    "clientSecret",
    "scope",
    "tokenPath",
    "resourcePath",
    "authMethod",
  ];
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !fields.includes(k))
  )
    throw new Error("Invalid attack input");
  for (const value of Object.values(input))
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new Error("Invalid attack input");
  for (const key of ["tokenPath", "resourcePath"])
    if (input[key]) path(input[key]);
  if (
    input.authMethod &&
    !["auto", "client_secret_basic", "client_secret_post"].includes(
      input.authMethod,
    )
  )
    throw new Error("Invalid client authentication");
  return { ...input };
}
const handlers = {
  "secret-token": async ({ acquire }) => {
    await acquire();
  },
  "secret-resource": async ({ acquire, request, settings, result }) => {
    if (!settings.resourcePath) {
      result.status = "INCONCLUSIVE";
      result.limitation = "尚未填寫資源路徑，未送出請求。";
      return;
    }
    const baseline = await request(settings.resourcePath);
    if (baseline.status >= 200 && baseline.status < 300) {
      result.status = "INCONCLUSIVE";
      result.observations.push(
        "未附憑證即可讀取此路徑，不能把公開存取算成 secret 帶來的能力；未傳送 secret。",
      );
      return;
    }
    if (![401, 403].includes(baseline.status)) {
      result.status = "INCONCLUSIVE";
      result.observations.push(
        "未登入對照未回 401／403，無法確認這是受保護的資源；未傳送 secret。",
      );
      return;
    }
    const token = await acquire();
    if (!token) return;
    const response = await request(settings.resourcePath, {
      headers: { Authorization: `Bearer ${token}` },
    });
    result.status =
      response.status >= 200 && response.status < 300
        ? "SUCCEEDED"
        : [401, 403].includes(response.status)
          ? "BLOCKED"
          : "INCONCLUSIVE";
    result.observations.push(
      result.status === "SUCCEEDED"
        ? "取得的 token 可讀取指定路徑；未證明其他路徑或管理權限。"
        : "已取得 token，但指定資源未回傳成功結果；詳見 HTTP 狀態。",
    );
  },
};
export function createAttackRunner({ minimumInterval = 500 } = {}) {
  const lastRequests = new Map();
  const cooldowns = new Map();
  return async function runAttack(id, environment, input, { signal } = {}) {
    const scenario = attackCatalog.find((s) => s.id === id);
    if (!scenario) throw new Error("Unknown attack scenario");
    const settings = validateAttackInput(input);
    const result = {
      ...scenario,
      timestamp: new Date().toISOString(),
      environment:
        environment.type === "simulation" ? "SIMULATION" : "CUSTOM_HTTP",
      environmentId: environment.id,
      environmentName: environment.name,
      environmentRevision: environment.revision,
      configuration: { ...environment },
      target: environment.baseUrl || "isolated-attack-fixture",
      status: "INCONCLUSIVE",
      assertions: [],
      observations: [],
      evidence: [],
      cleanup: "not-needed",
      limitation:
        "只驗證指定 client、scope 與路徑；client secret 不等於使用者 session。取得的 token 不保存、不匯出，亦未自動撤銷，其效期由目標管理。",
    };
    const started = performance.now();
    let fixture;
    try {
      if (environment.type === "simulation") {
        fixture = await createAttackFixture();
        settings.clientId ||= DEMO_CLIENT;
        settings.clientSecret ||= DEMO_SECRET;
        settings.resourcePath ||= "/resource";
      } else {
        settings.clientId ||= environment.clientId;
        if (!settings.clientId || !settings.clientSecret) {
          result.limitation = "請提供 client ID 與 client secret；未送出請求。";
          return result;
        }
      }
      const base = fixture?.url || environment.baseUrl;
      const secrets = [settings.clientSecret];
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
                  grant_type: "client_credentials",
                  ...(form.has("client_id")
                    ? { client_id: safe(form.get("client_id")) }
                    : {}),
                  ...(form.has("client_secret")
                    ? { client_secret: "[REDACTED]" }
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
      const acquire = async () => {
        let endpoint = settings.tokenPath;
        let auth = settings.authMethod || "auto";
        if (!endpoint) {
          const metadata = await request("/.well-known/openid-configuration");
          if (
            metadata.status !== 200 ||
            typeof metadata.body.token_endpoint !== "string" ||
            typeof metadata.body.issuer !== "string" ||
            new URL(metadata.body.issuer).origin !== base
          ) {
            result.limitation =
              "無法取得同目標的 OIDC discovery；請確認目標或明確指定 token 路徑。未傳送 secret。";
            return;
          }
          endpoint = metadata.body.token_endpoint;
          if (auth === "auto") {
            const methods = metadata.body
              .token_endpoint_auth_methods_supported || ["client_secret_basic"];
            auth = ["client_secret_basic", "client_secret_post"].find(
              (method) => Array.isArray(methods) && methods.includes(method),
            );
            if (!auth) {
              result.limitation =
                "Discovery 未宣告支援 client secret 認證；未傳送 secret。";
              return;
            }
          }
        }
        if (auth === "auto") auth = "client_secret_basic";
        const body = new URLSearchParams({
          grant_type: "client_credentials",
          ...(settings.scope ? { scope: settings.scope } : {}),
        });
        const headers = { "Content-Type": "application/x-www-form-urlencoded" };
        if (auth === "client_secret_basic") {
          const encode = (value) =>
            new URLSearchParams({ v: value }).toString().slice(2);
          headers.Authorization = `Basic ${Buffer.from(`${encode(settings.clientId)}:${encode(settings.clientSecret)}`).toString("base64")}`;
        } else {
          body.set("client_id", settings.clientId);
          body.set("client_secret", settings.clientSecret);
        }
        const response = await request(endpoint, {
          method: "POST",
          headers,
          body: body.toString(),
        });
        const token = response.body.access_token;
        if (
          response.status >= 200 &&
          response.status < 300 &&
          typeof token === "string" &&
          token.length > 0 &&
          /^Bearer$/i.test(response.body.token_type || "") &&
          !/[\r\n]/.test(token)
        ) {
          result.status = "SUCCEEDED";
          result.cleanup = "token-expiry";
          result.observations.push(
            "持有的 client secret 可取得 Bearer access token；不代表使用者登入、ID token 或越權。",
          );
          return token;
        }
        result.status =
          [400, 401, 403].includes(response.status) &&
          [
            "invalid_client",
            "unauthorized_client",
            "unsupported_grant_type",
            "invalid_scope",
          ].includes(response.body.error)
            ? "BLOCKED"
            : "INCONCLUSIVE";
        result.observations.push(
          result.status === "BLOCKED"
            ? "目標拒絕本次 client credentials 請求；不代表所有攻擊路徑都被阻擋。"
            : "回應不足以證明取得可使用的 Bearer access token。",
        );
      };
      await handlers[id]({ acquire, request, settings, result });
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
