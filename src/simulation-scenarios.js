import { verify, createPublicKey } from "node:crypto";
import { ORIGIN, REDIRECT, ISSUER } from "./fixture.js";

// Each handler owns one scenario or a closely related family.
const handlers = {
  "security-headers": async ({ fixture, result, assert, token }) => {
    const response = await token(fixture.seed());
    assert(
      "實際發 token 的回應禁止快取",
      response.status === 200 &&
        response.body.access_token &&
        response.headers["cache-control"] === "no-store",
    );
    result.recommendations = [
      "content-security-policy",
      "strict-transport-security",
      "referrer-policy",
    ]
      .filter((header) => !response.headers[header])
      .map(
        (header) => `未觀察到 ${header}；應依正式 HTTPS 部署與頁面用途評估。`,
      );
    result.limitation =
      "缺少一般安全標頭僅列建議；loopback HTTP 不適合驗證正式 HSTS。";
  },
  "logout-session": async ({ id, fixture, assert, token, logout, denied }) => {
    const first = fixture.seed();
    const other = fixture.seed();
    const response = await logout(first, { all: id === "logout-all" });
    assert(
      "登出 204 並用安全屬性清除 cookie",
      response.status === 204 &&
        response.body === null &&
        /__Host-rt=;/.test(response.headers["set-cookie"]) &&
        /Max-Age=0/.test(response.headers["set-cookie"]) &&
        /Secure; HttpOnly; SameSite=Lax; Path=\//.test(
          response.headers["set-cookie"],
        ),
    );
    assert(
      "保留舊 cookie 也無法再取得 token",
      denied(await token(first), 401, "login_required"),
    );
    const followup = await token(other);
    assert(
      id === "logout-all" ? "另一裝置亦被撤銷" : "另一裝置仍可取得 token",
      id === "logout-all"
        ? denied(followup, 401, "login_required")
        : followup.status === 200 && followup.body.access_token,
    );
  },
  "logout-origin": async ({ id, fixture, assert, token, logout, denied }) => {
    const session = fixture.seed();
    const cases =
      id === "logout-origin"
        ? [{ origin: null }, { origin: "https://evil.test" }]
        : [{ client: "unknown" }];
    for (const options of cases) {
      const response = await logout(session, options);
      assert(
        "不合法登出回應且不清除 cookie",
        denied(
          response,
          id === "logout-origin" ? 403 : 400,
          id === "logout-origin" ? "invalid_origin" : "invalid_client",
        ),
      );
    }
    const followup = await token(session);
    assert(
      "拒絕登出後 session 仍有效",
      followup.status === 200 && followup.body.access_token,
    );
  },
  jwks: async ({ fixture, assert, request }) => {
    const response = await request("/jwks");
    const keys = response.body.keys;
    assert(
      "200 JSON 與公鑰快取策略",
      response.status === 200 &&
        response.headers["content-type"].includes("application/json") &&
        response.headers["cache-control"] === "public, max-age=3600",
    );
    assert(
      "只公開 ES256 P-256 簽章公鑰",
      Array.isArray(keys) &&
        keys.length === 1 &&
        keys.every(
          (key) =>
            key.kty === "EC" &&
            key.crv === "P-256" &&
            key.alg === "ES256" &&
            key.use === "sig" &&
            key.x &&
            key.y &&
            !["d", "p", "q", "dp", "dq", "qi", "k"].some((name) => name in key),
        ),
    );
    const parts = fixture.issueJwt().split(".");
    const header = JSON.parse(Buffer.from(parts[0], "base64url"));
    const key = keys.find((key) => key.kid === header.kid);
    let jwtVerified = false;
    try {
      jwtVerified =
        header.alg === "ES256" &&
        Boolean(key) &&
        verify(
          "sha256",
          Buffer.from(parts.slice(0, 2).join(".")),
          {
            key: createPublicKey({ key, format: "jwk" }),
            dsaEncoding: "ieee-p1363",
          },
          Buffer.from(parts[2], "base64url"),
        );
    } catch {
      // 公鑰無法解析或簽章驗證拋錯（例如 fault 注入私鑰材料使 Node
      // 拒絕建立公鑰）視為此斷言失敗，而非讓整個情境變成 ERROR。
      jwtVerified = false;
    }
    assert("kid / alg 與公開金鑰可驗證實際 fixture JWT", jwtVerified);
  },
  discovery: async ({
    fixture,
    result,
    assert,
    token,
    request,
    logout,
    authorize,
  }) => {
    const response = await request("/.well-known/openid-configuration");
    const metadata = response.body;
    assert(
      "200 與公開 metadata 快取",
      response.status === 200 &&
        response.headers["cache-control"] === "public, max-age=3600",
    );
    assert(
      "issuer 與端點完全一致",
      metadata.issuer === ISSUER &&
        metadata.authorization_endpoint === `${ISSUER}/authorize` &&
        metadata.token_endpoint === `${ISSUER}/token` &&
        metadata.end_session_endpoint === `${ISSUER}/logout` &&
        metadata.jwks_uri === `${ISSUER}/jwks`,
    );
    assert(
      "宣告 code / public / S256 / ES256",
      metadata.response_types_supported?.includes("code") &&
        metadata.subject_types_supported?.includes("public") &&
        metadata.code_challenge_methods_supported?.includes("S256") &&
        metadata.id_token_signing_alg_values_supported?.includes("ES256"),
    );
    result.limitation =
      "只驗證 metadata 與 fixture 一致性；不是完整 OIDC 認證。";
  },
  "rate-limit": async ({
    fixture,
    result,
    assert,
    request,
    denied,
    authorize,
  }) => {
    for (let i = 0; i < 3; i++)
      assert(
        `限額內第 ${i + 1} 個請求正常`,
        (await request(authorize())).status === 302,
      );
    const limited = await request(authorize());
    assert(
      "超額回 429、Retry-After 且無新交易 cookie",
      denied(limited, 429, "rate_limited") &&
        limited.headers["retry-after"] === "60",
    );
    fixture.advance(60_000);
    assert("注入時鐘後配額恢復", (await request(authorize())).status === 302);
    result.limitation =
      "本機固定窗口配額為 3；正式 Cloudflare 每機房限流並非此精確計數模型。";
  },
  "malformed-json": async ({
    fixture,
    result,
    assert,
    token,
    request,
    denied,
  }) => {
    const response = await request("/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: '{"client_id":',
    });
    assert("錯誤 JSON 400 且不發 token", denied(response, 400, "invalid_json"));
    assert(
      "不洩漏 stack 或內部例外",
      !/stack|trace|internal|SyntaxError|Error:/.test(
        JSON.stringify(response.body),
      ),
    );
    const valid = await token(fixture.seed());
    assert(
      "錯誤後有效請求仍可取得 token",
      valid.status === 200 &&
        valid.body.access_token &&
        valid.headers["cache-control"] === "no-store",
    );
    result.limitation =
      "fixture 使用 invalid_json；auth-service 對 JSON parse 失敗以 invalid_client 正規化。";
  },
  "authorize-valid": async ({ assert, request, authorize }) => {
    const r = await request(authorize());
    assert(
      "合法授權建立 mock 交易與 state cookie",
      r.status === 302 &&
        r.headers.location.startsWith("/mock-provider?") &&
        r.headers["set-cookie"].includes("HttpOnly") &&
        r.body.transactionCreated,
    );
  },
  "client-invalid": async ({ assert, request, denied, authorize }) => {
    assert(
      "400 invalid_client、無 redirect 或 cookie",
      denied(
        await request(authorize({ client_id: "unknown" })),
        400,
        "invalid_client",
      ),
    );
  },
  "redirect-exact": async ({ assert, request, denied, authorize }) => {
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
  },
  "state-bounds": async ({ assert, request, denied, authorize }) => {
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
  },
  "callback-state": async ({
    id,
    fixture,
    assert,
    token,
    request,
    denied,
    authorize,
  }) => {
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
  },
  "token-client": async ({ assert, token, denied }) => {
    assert(
      "未知 client 不發 token",
      denied(await token(null, ORIGIN, "unknown"), 400, "invalid_client"),
    );
  },
  "token-origin": async ({ fixture, assert, token, denied }) => {
    const session = fixture.seed();
    for (const origin of [null, "https://evil.test"])
      assert(
        origin ? "拒絕錯誤 Origin" : "拒絕缺少 Origin",
        denied(await token(session, origin), 403, "invalid_origin"),
      );
  },
  "token-session": async ({ fixture, assert, token, denied }) => {
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
  },
  rotation: async ({ id, fixture, result, assert, token, denied }) => {
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
        assert("30 秒後舊 token 被拒絕", denied(reused, 401, "login_required"));
        const next = /__Host-rt=([^;]+)/.exec(first.headers["set-cookie"])?.[1];
        assert(
          "後繼 session 亦撤銷",
          denied(await token(next), 401, "login_required"),
        );
      }
    }
  },
};
handlers["logout-all"] = handlers["logout-session"];
handlers["logout-client"] = handlers["logout-origin"];
handlers["callback-replay"] = handlers["callback-state"];
handlers["reuse-grace"] = handlers["rotation"];
handlers["reuse-revoke"] = handlers["rotation"];
export const simulationHandlers = Object.freeze(handlers);
