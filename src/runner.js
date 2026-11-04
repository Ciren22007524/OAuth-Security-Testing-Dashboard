import { simulationHandlers } from "./simulation-scenarios.js";
import { generateKeyPairSync, sign, verify, randomUUID } from "node:crypto";
import { createFixture, CLIENT, ORIGIN, REDIRECT } from "./fixture.js";

export const catalog = [
  [
    "security-headers",
    "敏感回應快取與標頭盤點",
    "Session",
    "medium",
    "Token 回應必須 no-store；缺少一般安全標頭列為建議，不逕稱可利用漏洞",
  ],
  [
    "authorize-valid",
    "合法 OAuth 授權流程",
    "OAuth",
    "info",
    "接受已登記的 client、redirect 與 state",
  ],
  [
    "client-invalid",
    "拒絕未知 Client",
    "OAuth",
    "high",
    "未知 client 不得導向供應商",
  ],
  [
    "redirect-exact",
    "Redirect URI 精確比對",
    "OAuth",
    "high",
    "拒絕子網域、路徑、編碼與 fragment 變體",
  ],
  [
    "state-bounds",
    "State 必填與長度限制",
    "OAuth",
    "medium",
    "缺少或超長 state 不建立交易",
  ],
  [
    "callback-state",
    "Callback State 與 Cookie",
    "OAuth",
    "high",
    "不匹配或缺少 cookie 不得建立登入",
  ],
  [
    "callback-replay",
    "Callback 一次性交易",
    "OAuth",
    "high",
    "成功 callback 只能消耗一次",
  ],
  [
    "token-client",
    "Token Client 驗證",
    "Session",
    "high",
    "未知 client 回傳 invalid_client",
  ],
  [
    "token-origin",
    "Token Origin 驗證",
    "Session",
    "high",
    "錯誤或缺少 Origin 不得發 token",
  ],
  [
    "token-session",
    "Refresh Session 有效性",
    "Session",
    "high",
    "缺少、無效、過期 cookie 不得發 token",
  ],
  [
    "rotation",
    "Refresh 並行輪替",
    "Session",
    "high",
    "並行請求只有一個輪替 cookie，另一個僅取得 access token",
  ],
  [
    "reuse-grace",
    "30 秒重用寬限邊界",
    "Session",
    "info",
    "明確記錄 30 秒內允許重用的設計取捨",
  ],
  [
    "reuse-revoke",
    "超過寬限後撤銷",
    "Session",
    "high",
    "只對本次隔離 fixture 驗證 session 撤銷",
  ],
  [
    "jwt-verifier",
    "JWT 簽章與 Claims",
    "JWT",
    "high",
    "本機驗證器拒絕竄改、過期、issuer 與 audience 錯誤",
  ],
  [
    "browser-cors",
    "真實瀏覽器 CORS",
    "Browser",
    "medium",
    "需要瀏覽器及整合環境；Node 請求不足以證明",
  ],
  [
    "logout-session",
    "單一裝置登出",
    "Session",
    "high",
    "清除 cookie 並撤銷目前 session，其他裝置仍可使用",
  ],
  [
    "logout-all",
    "所有裝置登出",
    "Session",
    "high",
    "隔離身份的所有 session 都不能再換 token",
  ],
  [
    "logout-origin",
    "Logout Origin 驗證",
    "Session",
    "high",
    "錯誤或缺少 Origin 不得登出有效 session",
  ],
  [
    "logout-client",
    "Logout Client 驗證",
    "Session",
    "high",
    "未知 client 不得撤銷 session",
  ],
  [
    "jwks",
    "JWKS 公鑰與簽章一致性",
    "JWT",
    "high",
    "僅公開 ES256 公鑰，kid 與實際簽章一致",
  ],
  [
    "discovery",
    "Discovery 端點一致性",
    "OAuth",
    "medium",
    "issuer、各端點與 S256 / ES256 宣告一致；不宣稱完整 OIDC",
  ],
  [
    "rate-limit",
    "授權限流與恢復",
    "OAuth",
    "medium",
    "有界請求觸發 429、Retry-After，注入時鐘後恢復",
  ],
  [
    "malformed-json",
    "錯誤 JSON 不洩漏內部資訊",
    "Session",
    "medium",
    "400 錯誤不發 token、不洩漏 stack，後續請求正常",
  ],
].map(([id, title, category, severity, expected]) => ({
  id,
  title,
  category,
  severity,
  expected,
  revision: 1,
  requestBudget: 8,
  prerequisites:
    id === "browser-cors" ? ["實際瀏覽器與授權測試環境"] : ["隔離本機 fixture"],
  remediation:
    "對照 auth-service 最新規格檢查驗證與 session 邊界；模擬結果不代表正式服務結果。",
}));

export function redact(value, key = "") {
  if (
    /cookie|^authorization$|secret|password|email|^sub$|^(?:(?:access|refresh|id)[_-]?)?token$|^jwt$|^(?:d|p|q|dp|dq|qi|k)$/i.test(
      key,
    )
  )
    return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redact(v, k)]),
    );
  if (typeof value === "string")
    return value
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        "[REDACTED]",
      )
      .replace(
        /([?&](?:state|code|access_token|refresh_token)=)[^&\s]*/gi,
        "$1[REDACTED]",
      );
  return value;
}

function verifierChecks() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = encode({ alg: "ES256", typ: "JWT" });
  const claims = {
    iss: "fixture-issuer",
    aud: "client-a",
    sub: "fixture-user",
    exp: 2000,
  };
  function mint(payload) {
    const message = `${header}.${encode(payload)}`;
    return `${message}.${sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  }
  function accepts(token, audience = "client-a") {
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url"));
    return (
      verify(
        "sha256",
        Buffer.from(parts.slice(0, 2).join(".")),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(parts[2], "base64url"),
      ) &&
      payload.iss === claims.iss &&
      payload.aud === audience &&
      payload.exp > 1000
    );
  }
  const valid = mint(claims);
  const tampered = valid.split(".");
  tampered[1] = encode({ ...claims, sub: "altered" });
  const badSignature = valid.split(".");
  const signature = Buffer.from(badSignature[2], "base64url");
  signature[0] ^= 1;
  badSignature[2] = signature.toString("base64url");
  return [
    ["接受有效簽章", accepts(valid)],
    ["拒絕 payload 竄改", !accepts(tampered.join("."))],
    ["拒絕簽章竄改", !accepts(badSignature.join("."))],
    ["拒絕跨 client audience", !accepts(valid, "client-b")],
    ["拒絕 issuer 不符", !accepts(mint({ ...claims, iss: "wrong" }))],
    ["拒絕過期", !accepts(mint({ ...claims, exp: 999 }))],
  ];
}

export async function runScenario(
  id,
  { vulnerable = false, fault, signal } = {},
) {
  const scenario = catalog.find((item) => item.id === id);
  if (!scenario) throw new Error("Unknown scenario");
  const started = performance.now();
  const evidence = [];
  const assertions = [];
  let fixture;
  const result = {
    ...scenario,
    timestamp: new Date().toISOString(),
    environment: "SIMULATION",
    target: "isolated-loopback-fixture",
    evidence,
    assertions,
    status: "ERROR",
    cleanup: "not-started",
  };
  const assert = (name, passed) =>
    assertions.push({ name, passed: Boolean(passed) });
  try {
    signal?.throwIfAborted();
    if (id === "browser-cors") {
      result.status = "INCONCLUSIVE";
      result.limitation = "未執行真實瀏覽器、Google 登入或正式服務測試。";
    } else if (id === "jwt-verifier") {
      for (const [name, passed] of verifierChecks()) assert(name, passed);
      result.status = assertions.every((a) => a.passed) ? "PASS" : "FAIL";
      result.limitation =
        "本機 ES256 verifier fixture；不是 /token 的 JWT 驗證結果。";
    } else {
      fixture = await createFixture({
        vulnerable,
        fault,
        rateLimit: id === "rate-limit" ? 3 : 100,
      });
      let count = 0;
      async function request(path, options = {}) {
        signal?.throwIfAborted();
        if (++count > scenario.requestBudget)
          throw new Error("Request budget exceeded");
        const response = await fetch(`${fixture.url}${path}`, {
          ...options,
          redirect: "manual",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
            : AbortSignal.timeout(3000),
        });
        const text = await response.text();
        const body = text ? JSON.parse(text) : null;
        const headers = Object.fromEntries(response.headers);
        let requestBody;
        if (options.body) {
          try {
            requestBody = JSON.parse(options.body);
          } catch {
            requestBody = {
              malformedJson: true,
              bytes: Buffer.byteLength(options.body),
            };
          }
        }
        evidence.push(
          redact({
            request: {
              method: options.method || "GET",
              path,
              headers: options.headers || {},
              body: requestBody,
            },
            response: { status: response.status, headers, body },
          }),
        );
        return { status: response.status, body, headers };
      }
      const authorize = (overrides = {}) =>
        "/authorize?" +
        new URLSearchParams({
          client_id: CLIENT,
          redirect_uri: REDIRECT,
          state: "fixture-state",
          ...overrides,
        });
      const token = (cookie, origin = ORIGIN, client = CLIENT) =>
        request("/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(origin ? { Origin: origin } : {}),
            ...(cookie ? { Cookie: `__Host-rt=${cookie}` } : {}),
          },
          body: JSON.stringify({ client_id: client }),
        });
      const denied = (r, status, error) =>
        r.status === status &&
        r.body.error === error &&
        !r.body.access_token &&
        !r.headers["set-cookie"] &&
        !r.headers.location;
      const logout = (
        session,
        { all = false, origin = ORIGIN, client = CLIENT } = {},
      ) =>
        request("/logout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(origin ? { Origin: origin } : {}),
            Cookie: `__Host-rt=${session}`,
          },
          body: JSON.stringify({ client_id: client, all }),
        });
      await simulationHandlers[id]({
        id,
        fixture,
        result,
        assert,
        token,
        request,
        logout,
        denied,
        authorize,
      });
      result.status =
        assertions.length && assertions.every((a) => a.passed)
          ? "PASS"
          : "FAIL";
    }
  } catch (error) {
    result.status = "ERROR";
    result.error =
      error.name === "AbortError"
        ? "Run cancelled"
        : "Scenario execution failed";
  } finally {
    if (fixture) await fixture.close();
    result.cleanup = "complete";
    result.durationMs = Math.round(performance.now() - started);
  }
  return result;
}

export function makeReport(results) {
  return {
    schemaVersion: 1,
    runId: randomUUID(),
    generatedAt: new Date().toISOString(),
    environment: "SIMULATION",
    limitations: [
      "Only isolated protocol and verifier fixtures were tested.",
      "No live auth-service, Google login, remote D1, or browser CORS validation.",
    ],
    results: redact(results),
  };
}

export function markdownReport(report) {
  return (
    `# OAuth Security Test Report\n\nEnvironment: SIMULATION\n\nGenerated: ${report.generatedAt}\n\n${report.limitations.join("\n\n")}\n\n` +
    report.results
      .map(
        (r) =>
          `## ${r.title}: ${r.status}\n\n${r.expected}\n\n${r.assertions.map((a) => `- ${a.passed ? "PASS" : "FAIL"}: ${a.name}`).join("\n")}\n\n${r.limitation || ""}\n\n${(r.recommendations || []).map((item) => `- 建議：${item}`).join("\n")}\n\nEvidence:\n\n\`\`\`json\n${JSON.stringify(r.evidence, null, 2)}\n\`\`\`\n`,
      )
      .join("\n")
  );
}
