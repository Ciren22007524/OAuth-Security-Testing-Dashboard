import { generateKeyPairSync, sign, verify, randomUUID } from "node:crypto";
import { createFixture, CLIENT, ORIGIN, REDIRECT } from "./fixture.js";

export const catalog = [
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
  if (/cookie|authorization|token|secret|password|email|^sub$/i.test(key))
    return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redact(v, k)]),
    );
  if (typeof value === "string")
    return value.replace(
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
      fixture = await createFixture({ vulnerable, fault });
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
        const body = await response.json();
        const headers = Object.fromEntries(response.headers);
        evidence.push(
          redact({
            request: {
              method: options.method || "GET",
              path,
              headers: options.headers || {},
              body: options.body ? JSON.parse(options.body) : undefined,
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
      if (id === "authorize-valid") {
        const r = await request(authorize());
        assert(
          "合法授權建立 mock 交易與 state cookie",
          r.status === 302 &&
            r.headers.location.startsWith("/mock-provider?") &&
            r.headers["set-cookie"].includes("HttpOnly") &&
            r.body.transactionCreated,
        );
      } else if (id === "client-invalid") {
        assert(
          "400 invalid_client、無 redirect 或 cookie",
          denied(
            await request(authorize({ client_id: "unknown" })),
            400,
            "invalid_client",
          ),
        );
      } else if (id === "redirect-exact") {
        for (const uri of [
          "https://dashboard.test.evil/callback",
          `${REDIRECT}/extra`,
          "https://dashboard.test/%63allback",
          `${REDIRECT}#fragment`,
        ])
          assert(
            `拒絕 ${uri}`,
            denied(
              await request(authorize({ redirect_uri: uri })),
              400,
              "invalid_redirect_uri",
            ),
          );
      } else if (id === "state-bounds") {
        for (const state of ["", "x".repeat(513)])
          assert(
            state ? "拒絕超長 state" : "拒絕空 state",
            denied(await request(authorize({ state })), 400, "invalid_state"),
          );
        const boundary = await request(authorize({ state: "x".repeat(512) }));
        assert(
          "512 字元邊界可接受",
          boundary.status === 302 &&
            boundary.headers.location.startsWith("/mock-provider?"),
        );
      } else if (id === "callback-state" || id === "callback-replay") {
        const start = await request(authorize());
        const providerState = new URL(
          start.headers.location,
          fixture.url,
        ).searchParams.get("state");
        const path = `/callback/google?state=${providerState}&code=mock-code`;
        const headers = { Cookie: `__Host-oauth_state=${providerState}` };
        if (id === "callback-state") {
          assert(
            "缺少 cookie 不發 session",
            denied(await request(path), 400, "invalid_state"),
          );
          assert(
            "錯誤 cookie 不發 session",
            denied(
              await request(path, {
                headers: { Cookie: "__Host-oauth_state=wrong" },
              }),
              400,
              "invalid_state",
            ),
          );
        } else {
          const first = await request(path, { headers });
          assert(
            "首次 callback 成功且 cookie 安全屬性存在",
            first.status === 302 &&
              /__Host-rt=/.test(first.headers["set-cookie"]) &&
              /Secure; HttpOnly; SameSite=Lax; Path=\//.test(
                first.headers["set-cookie"],
              ),
          );
          assert(
            "導回 client 原始 state 且網址不含 token",
            new URL(first.headers.location).searchParams.get("state") ===
              "fixture-state" && !/token/.test(first.headers.location),
          );
          assert(
            "重播被拒絕且無 session cookie",
            denied(await request(path, { headers }), 400, "invalid_state"),
          );
        }
      } else if (id === "token-client") {
        assert(
          "未知 client 不發 token",
          denied(await token(null, ORIGIN, "unknown"), 400, "invalid_client"),
        );
      } else if (id === "token-origin") {
        const session = fixture.seed();
        for (const origin of [null, "https://evil.test"])
          assert(
            origin ? "拒絕錯誤 Origin" : "拒絕缺少 Origin",
            denied(await token(session, origin), 403, "invalid_origin"),
          );
      } else if (id === "token-session") {
        for (const session of [null, "invalid"])
          assert(
            session ? "拒絕無效 session" : "拒絕缺少 session",
            denied(await token(session), 401, "login_required"),
          );
        const expired = fixture.seed();
        fixture.advance(3600_001);
        assert(
          "拒絕過期 session",
          denied(await token(expired), 401, "login_required"),
        );
      } else {
        const session = fixture.seed();
        if (id === "rotation") {
          const responses = await Promise.all([token(session), token(session)]);
          assert(
            "並行請求都得到 access token",
            responses.every((r) => r.status === 200 && r.body.access_token),
          );
          const rotated = responses.filter((r) => r.headers["set-cookie"]);
          assert("僅一個請求設定輪替 cookie", rotated.length === 1);
          const next = /__Host-rt=([^;]+)/.exec(
            rotated[0]?.headers["set-cookie"] || "",
          )?.[1];
          const followup = await token(next);
          assert(
            "後繼 session 可實際使用",
            followup.status === 200 && followup.body.access_token,
          );
        } else {
          const first = await token(session);
          assert(
            "有效 session 可取得 token",
            first.status === 200 && first.body.access_token,
          );
          fixture.advance(id === "reuse-grace" ? 30_000 : 30_001);
          const reused = await token(session);
          if (id === "reuse-grace") {
            assert(
              "30 秒邊界允許重用且不再換 cookie",
              reused.status === 200 &&
                reused.body.access_token &&
                !reused.headers["set-cookie"],
            );
            result.limitation = "已記錄寬限設計取捨；允許重用本身不列為漏洞。";
          } else {
            assert(
              "30 秒後舊 token 被拒絕",
              denied(reused, 401, "login_required"),
            );
            const next = /__Host-rt=([^;]+)/.exec(
              first.headers["set-cookie"],
            )?.[1];
            assert(
              "後繼 session 亦撤銷",
              denied(await token(next), 401, "login_required"),
            );
          }
        }
      }
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
          `## ${r.title}: ${r.status}\n\n${r.expected}\n\n${r.assertions.map((a) => `- ${a.passed ? "PASS" : "FAIL"}: ${a.name}`).join("\n")}\n\n${r.limitation || ""}\n\nEvidence:\n\n\`\`\`json\n${JSON.stringify(r.evidence, null, 2)}\n\`\`\`\n`,
      )
      .join("\n")
  );
}
