// Each handler owns one scenario or a closely related family.
const handlers = {
  health: async ({ request, check }) => {
    const r = await request("/health");
    check("200 JSON ok:true", r.status === 200 && r.body.ok === true);
  },
  jwks: async ({ result, request, check }) => {
    const r = await request("/jwks");
    const keys = r.body.keys;
    check(
      "200 JSON 公開 ES256 P-256 公鑰",
      r.status === 200 &&
        Array.isArray(keys) &&
        keys.length > 0 &&
        keys.every(
          (k) =>
            k &&
            k.kty === "EC" &&
            k.crv === "P-256" &&
            k.alg === "ES256" &&
            typeof k.kid === "string" &&
            typeof k.x === "string" &&
            typeof k.y === "string" &&
            !["d", "k", "p", "q", "dp", "dq", "qi"].some((name) => name in k),
        ),
    );
    result.limitation =
      "未取得真實 session；僅驗證公開金鑰結構，尚未驗證與實際簽發 token 的一致性。";
  },
  discovery: async ({ environment, result, request, check }) => {
    const r = await request("/.well-known/openid-configuration");
    check(
      "200 且 issuer / endpoints 對應所選目標",
      r.status === 200 &&
        r.body.issuer === environment.baseUrl &&
        r.body.jwks_uri === `${environment.baseUrl}/jwks` &&
        r.body.authorization_endpoint === `${environment.baseUrl}/authorize` &&
        r.body.token_endpoint === `${environment.baseUrl}/token`,
    );
    check(
      "宣告 S256 與 ES256",
      r.body.code_challenge_methods_supported?.includes("S256") &&
        r.body.id_token_signing_alg_values_supported?.includes("ES256"),
    );
    result.limitation = "Metadata 一致性不代表完整 OIDC 或 Google 登入已驗證。";
  },
  "client-invalid": async ({
    request,
    check,
    authorize,
    unknown,
    noIssuance,
  }) => {
    const r = await request(authorize({ client_id: unknown }));
    check(
      "未知 client 回 400 且不導向外站／發 session",
      r.status === 400 && noIssuance(r),
    );
  },
  "redirect-exact": async ({
    environment,
    request,
    check,
    authorize,
    noIssuance,
  }) => {
    for (const redirect_uri of [
      `${environment.redirectUri}#dashboard-probe`,
      `${environment.redirectUri}/extra`,
    ]) {
      const r = await request(authorize({ redirect_uri }));
      check(
        "修改 redirect 被拒絕且不導向外站",
        r.status === 400 && noIssuance(r),
      );
    }
  },
  "state-bounds": async ({ request, check, authorize, noIssuance }) => {
    for (const state of ["", "x".repeat(513)]) {
      const r = await request(authorize({ state }));
      check(
        "空或超長 state 被拒絕且不發交易 cookie",
        r.status === 400 && noIssuance(r),
      );
    }
  },
  "token-client": async ({
    environment,
    check,
    token,
    unknown,
    noIssuance,
  }) => {
    const r = await token(unknown, environment.origin);
    check(
      "未知 client 回 invalid_client 且不發 token",
      r.status === 400 && r.body.error === "invalid_client" && noIssuance(r),
    );
  },
  "token-origin": async ({ environment, result, check, token, noIssuance }) => {
    for (const origin of [undefined, "https://dashboard-untrusted.invalid"]) {
      const r = await token(environment.clientId, origin);
      if (r.status === 400 && r.body.error === "invalid_client") {
        result.status = "INCONCLUSIVE";
        result.limitation = "目標不認得此 client ID，尚不能驗證 Origin 控制。";
        return result;
      }
      check(
        "缺少或錯誤 Origin 回 invalid_origin 且不發 token",
        r.status === 403 && r.body.error === "invalid_origin" && noIssuance(r),
      );
    }
    result.limitation =
      "Node Origin 驗證不代表瀏覽器 CORS 或帶 session 的跨站行為已通過。";
  },
  "token-session": async ({ id, environment, result, check, token }) => {
    const r = await token(environment.clientId, environment.origin);
    if (
      (r.status === 400 && r.body.error === "invalid_client") ||
      (r.status === 403 && r.body.error === "invalid_origin")
    ) {
      result.status = "INCONCLUSIVE";
      result.limitation =
        "client ID 或 Origin 尚未通過目標登記檢查，尚不能驗證無 session 的行為。";
      return result;
    }
    check(
      "未提供 session 回 login_required 且不發 token",
      r.status === 401 &&
        r.body.error === "login_required" &&
        !r.body.access_token &&
        !r.headers.location,
    );
    if (id === "security-headers") {
      result.recommendations = [
        "content-security-policy",
        "referrer-policy",
        "strict-transport-security",
      ]
        .filter((header) => !r.headers[header])
        .map((header) => `未觀察到 ${header}，依正式部署評估。`);
      result.limitation =
        "未登入的錯誤回應標頭盤點；尚未驗證成功 token 回應的 no-store。";
    }
  },
};
handlers["security-headers"] = handlers["token-session"];
export const httpHandlers = Object.freeze(handlers);
