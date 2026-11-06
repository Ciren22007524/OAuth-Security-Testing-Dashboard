import { createPublicKey, randomUUID } from "node:crypto";

export const serviceProfiles = [
  { id: "auth-service-oidc", name: "auth-service（標準 OIDC／RS256）" },
  { id: "array-session", name: "Array SSO Worker（本站 session）" },
  { id: "legacy", name: "舊版 JSON／ES256（相容舊設定）" },
];
const entry = (id, title, budget = 1) => ({
  id,
  title,
  category: "Service",
  revision: 1,
  requestBudget: budget,
  prerequisites: ["已核對服務類型與目標網址"],
  expected: title,
});
export const oidcCatalog = [
  entry("oidc-health", "auth-service 健康檢查"),
  entry("oidc-discovery", "標準 OIDC discovery 與 RS256／S256 宣告"),
  entry("oidc-jwks", "依 discovery 驗證 RSA 公開金鑰", 2),
];
export const arrayCatalog = [
  entry("array-health", "Array Worker 健康檢查"),
  entry("array-anonymous", "未登入的 /api/me 回 login_required"),
  entry("array-bearer", "無本站 session 時，隨機 Bearer 不能登入", 2),
];
const isJson = (r) =>
  /^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(
    r.headers["content-type"] || "",
  );
export const isArrayUser = (body) =>
  Boolean(
    body &&
      typeof body.user?.sub === "string" &&
      body.user.sub.length > 0 &&
      Number.isFinite(body.expiresAt) &&
      body.expiresAt > Date.now() / 1000,
  );
export const isArrayDenied = (r) =>
  r.status === 401 && r.body?.error === "login_required";
function uncertain(result, message) {
  result.status = "INCONCLUSIVE";
  result.limitation = message;
}
async function metadata({ request, result, environment }) {
  const response = await request("/.well-known/openid-configuration");
  if (
    response.status !== 200 ||
    !isJson(response) ||
    response.body.issuer !== environment.baseUrl
  ) {
    uncertain(
      result,
      "Discovery／issuer 不符合所選目標，請確認服務類型、網址與部署；不視為防護失敗。",
    );
    return;
  }
  for (const field of [
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
  ]) {
    let url;
    try {
      url = new URL(response.body[field]);
    } catch {
      uncertain(result, "Discovery 缺少有效端點。");
      return;
    }
    if (
      url.origin !== environment.baseUrl ||
      url.username ||
      url.password ||
      url.hash
    ) {
      uncertain(result, "Discovery 指向未設定的其他目標，未轉送請求或憑證。");
      return;
    }
  }
  return response.body;
}
export const serviceHandlers = Object.freeze({
  "oidc-health": async ({ request, check, result }) => {
    const r = await request("/health");
    if (r.status !== 200 || !isJson(r) || r.body.ok !== true) {
      uncertain(
        result,
        "未取得 auth-service 的 200 JSON ok:true，請確認部署與服務類型。",
      );
      return;
    }
    check("auth-service 200 JSON ok:true", true);
  },
  "oidc-discovery": async (context) => {
    const data = await metadata(context);
    if (!data) return;
    context.check(
      "宣告 code、PKCE S256、RS256",
      data.response_types_supported?.includes("code") &&
        data.code_challenge_methods_supported?.includes("S256") &&
        data.id_token_signing_alg_values_supported?.includes("RS256"),
    );
    context.result.limitation =
      "只核對公開 metadata；不代表已驗證登入、client scope、擁有者或 secret 輪替。";
  },
  "oidc-jwks": async (context) => {
    const data = await metadata(context);
    if (!data) return;
    const r = await context.request(data.jwks_uri);
    if (r.status !== 200 || !isJson(r)) {
      uncertain(context.result, "JWKS 請求受阻或不是 JSON，無法判定金鑰內容。");
      return;
    }
    const keys = r.body.keys;
    const valid =
      Array.isArray(keys) &&
      keys.length > 0 &&
      new Set(keys.map((k) => k?.kid)).size === keys.length &&
      keys.every((key) => {
        if (
          !key ||
          key.kty !== "RSA" ||
          key.alg !== "RS256" ||
          typeof key.kid !== "string" ||
          !key.kid ||
          ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((k) => k in key)
        )
          return false;
        try {
          return (
            createPublicKey({ key, format: "jwk" }).asymmetricKeyDetails
              .modulusLength >= 2048
          );
        } catch {
          return false;
        }
      });
    context.check(
      "公開且可解析的 RS256 RSA 金鑰（至少 2048 bit，無私鑰欄位）",
      valid,
    );
    context.result.limitation =
      "只驗證公開金鑰結構，未以實際簽發的 token 驗證簽章。";
  },
  "array-health": async ({ request, check, result }) => {
    const r = await request("/health");
    if (
      r.status !== 200 ||
      !isJson(r) ||
      r.body.service !== "array-sso-test" ||
      r.body.status !== "up"
    ) {
      uncertain(
        result,
        "未取得 Array Worker 的健康回應，請確認服務類型與部署。",
      );
      return;
    }
    check("Array Worker service/status 符合契約", true);
  },
  "array-anonymous": async ({ request, check, result }) => {
    const r = await request("/api/me");
    if (!isJson(r)) {
      uncertain(
        result,
        "/api/me 未回 JSON，可能是登入頁、代理或 WAF，未判為防護通過。",
      );
      return;
    }
    if (isArrayDenied(r)) {
      check("沒有 session 時回 401 login_required", true);
      return;
    }
    if (r.status === 200 && isArrayUser(r.body)) {
      check("沒有 session 時不能取得有效使用者資料", false);
      return;
    }
    uncertain(result, "/api/me 回應不符合已知成功／拒絕契約。");
  },
  "array-bearer": async ({ request, check, result }) => {
    const baseline = await request("/api/me");
    if (!isJson(baseline) || !isArrayDenied(baseline)) {
      uncertain(result, "未登入對照不成立，未嘗試 Bearer 請求。");
      return;
    }
    const r = await request("/api/me", {
      headers: { Authorization: `Bearer dashboard-invalid-${randomUUID()}` },
    });
    if (!isJson(r)) {
      uncertain(result, "Bearer 回應不是 JSON，不能當成 session 邊界證據。");
      return;
    }
    check("隨機無效 Bearer 未建立本站登入", isArrayDenied(r));
    result.limitation =
      "此檢查只使用隨機無效 Bearer；不宣稱已測有效 provider token 的 issuer／audience。";
  },
});
