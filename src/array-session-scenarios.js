import { randomBytes } from "node:crypto";
import { isArrayUser, isArrayDenied } from "./service-profiles.js";
const json = (response) =>
  response.jsonObject &&
  /^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(response.contentType || "");
function classify(result, response) {
  result.status =
    json(response) && response.status === 200 && isArrayUser(response.body)
      ? "SUCCEEDED"
      : json(response) && isArrayDenied(response)
        ? "BLOCKED"
        : "INCONCLUSIVE";
  result.observations.push(
    result.status === "SUCCEEDED"
      ? "取得符合 Array /api/me 契約的有效 session 身分；個人資料未匯出。"
      : result.status === "BLOCKED"
        ? "此請求收到 401 JSON login_required；只代表本次條件不能讀取本站身分。"
        : "回應不是已知的 Array API 成功／拒絕契約，不能當作防護成功。",
  );
}
export const arrayAttackHandlers = Object.freeze({
  "array-no-session": async ({ request, result }) =>
    classify(result, await request("/api/me")),
  "array-forged-session": async ({ request, result }) =>
    classify(
      result,
      await request("/api/me", {
        headers: {
          Cookie: `__Host-array_sso_session=${randomBytes(32).toString("base64url")}`,
        },
      }),
    ),
  "array-held-session": async ({ request, settings, result }) => {
    const baseline = await request("/api/me");
    if (!json(baseline) || !isArrayDenied(baseline)) {
      result.observations.push(
        "未登入對照不成立，未傳送此情境的 session cookie。",
      );
      return;
    }
    classify(
      result,
      await request("/api/me", {
        headers: {
          Cookie: `__Host-array_sso_session=${settings.sessionCookie}`,
        },
      }),
    );
  },
});
