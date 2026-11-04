const succeeded = (response) => response.status >= 200 && response.status < 300;
const rejection = (response) =>
  [400, 401, 403].includes(response.status) &&
  [
    "invalid_client",
    "invalid_grant",
    "unauthorized_client",
    "unsupported_grant_type",
    "invalid_scope",
    "invalid_request",
  ].includes(response.body.error);
async function exchange(context, parameters) {
  const response = await context.exchange(parameters);
  if (!response) return;
  const token = response.body.access_token;
  if (
    succeeded(response) &&
    typeof token === "string" &&
    token.length > 0 &&
    /^Bearer$/i.test(response.body.token_type || "") &&
    !/[\r\n]/.test(token)
  ) {
    context.result.status = "SUCCEEDED";
    context.result.cleanup = "token-expiry";
    context.result.observations.push(
      "本次參數取得 Bearer access token；未推定其他使用者或管理權限。",
    );
    return { token, response };
  }
  context.result.status = rejection(response) ? "BLOCKED" : "INCONCLUSIVE";
  context.result.observations.push(
    rejection(response)
      ? "目標拒絕本次 token 交換。"
      : "回應不足以證明取得可使用的 Bearer token。",
  );
}
const clientGrant = (scope) => ({
  grant_type: "client_credentials",
  ...(scope ? { scope } : {}),
});
const codeGrant = (settings) => ({
  grant_type: "authorization_code",
  code: settings.code,
  redirect_uri: settings.redirectUri,
  ...(settings.codeVerifier ? { code_verifier: settings.codeVerifier } : {}),
});
const refreshGrant = (settings) => ({
  grant_type: "refresh_token",
  refresh_token: settings.refreshToken,
  ...(settings.scope ? { scope: settings.scope } : {}),
});
async function baseline(context, endpoint) {
  const response = await context.request(endpoint);
  if (![401, 403].includes(response.status)) {
    context.result.status = "INCONCLUSIVE";
    context.result.observations.push(
      succeeded(response)
        ? "未附憑證即可讀取，不能把公開存取算成此憑證帶來的能力。"
        : "未登入對照未回 401／403，無法確認受保護的前提。",
    );
    return false;
  }
  return true;
}
async function read(context, endpoint, token, userinfo = false) {
  const response = await context.request(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });
  context.result.status =
    succeeded(response) &&
    (!userinfo ||
      (typeof response.body.sub === "string" && response.body.sub.length > 0))
      ? "SUCCEEDED"
      : [401, 403].includes(response.status)
        ? "BLOCKED"
        : "INCONCLUSIVE";
  context.result.observations.push(
    context.result.status === "SUCCEEDED"
      ? userinfo
        ? "此 token 可取得含 sub 的 UserInfo JSON；個人資料未保存。"
        : "此 token 可讀取指定 GET 路徑；未證明其他路徑的權限。"
      : "此 token 未完成指定資源讀取，請對照 HTTP 狀態。",
  );
}
async function replay(context, parameters) {
  const first = await exchange(context, parameters);
  if (!first) {
    context.result.status = "INCONCLUSIVE";
    context.result.observations.push(
      "第一次兌換沒有有效對照，不能判定重播防護。",
    );
    return;
  }
  const second = await context.exchange(parameters);
  if (!second) return;
  context.result.status =
    succeeded(second) &&
    typeof second.body.access_token === "string" &&
    Boolean(second.body.access_token) &&
    /^Bearer$/i.test(second.body.token_type || "")
      ? "SUCCEEDED"
      : second.body.error === "invalid_grant" &&
          [400, 401, 403].includes(second.status)
        ? "BLOCKED"
        : "INCONCLUSIVE";
  context.result.observations.push(
    context.result.status === "SUCCEEDED"
      ? "同一枚憑證第二次仍可兌換；refresh 重用可能受寬限設計影響，須依規格判讀。"
      : context.result.status === "BLOCKED"
        ? "第一次兌換成功，第二次相同憑證回 invalid_grant。"
        : "第二次回應不足以確認重播是否可行。",
  );
}
export const attackHandlers = Object.freeze({
  "secret-token": (context) =>
    exchange(context, clientGrant(context.settings.scope)),
  "secret-resource": async (context) => {
    if (!(await baseline(context, context.settings.resourcePath))) return;
    const issued = await exchange(context, clientGrant(context.settings.scope));
    if (issued)
      await read(context, context.settings.resourcePath, issued.token);
  },
  "secret-scope": async (context) => {
    const { baselineScope, elevatedScope } = context.settings;
    if (baselineScope === elevatedScope) {
      context.result.limitation = "對照與嘗試的 scope 必須不同。";
      return;
    }
    const first = await exchange(context, clientGrant(baselineScope));
    if (!first) {
      context.result.status = "INCONCLUSIVE";
      context.result.observations.push(
        "已知 scope 的兌換未成功，不能判定 scope 擴張。",
      );
      return;
    }
    const second = await exchange(context, clientGrant(elevatedScope));
    if (!second) return;
    const before = new Set(
      (typeof first.response.body.scope === "string"
        ? first.response.body.scope
        : ""
      ).split(/\s+/),
    );
    const after = new Set(
      (typeof second.response.body.scope === "string"
        ? second.response.body.scope
        : ""
      ).split(/\s+/),
    );
    const requested = elevatedScope.split(/\s+/).filter(Boolean);
    if (
      !requested.every((s) => after.has(s)) ||
      !requested.some((s) => !before.has(s))
    ) {
      context.result.status = "INCONCLUSIVE";
      context.result.observations.push(
        "已簽發 token，但 scope 回應無法證明新增要求的範圍。",
      );
      return;
    }
    context.result.observations.push(
      "回應宣告了對照 token 未有的要求 scope；是否超出原授權仍須依 client 政策判讀。",
    );
  },
  "token-resource": async (context) => {
    if (await baseline(context, context.settings.resourcePath))
      await read(
        context,
        context.settings.resourcePath,
        context.settings.accessToken,
      );
  },
  "token-userinfo": async (context) => {
    const endpoint = await context.endpoint(
      "userinfo_endpoint",
      context.settings.userinfoPath,
    );
    if (endpoint && (await baseline(context, endpoint)))
      await read(context, endpoint, context.settings.accessToken, true);
  },
  "refresh-token": (context) =>
    exchange(context, refreshGrant(context.settings)),
  "refresh-replay": (context) =>
    replay(context, refreshGrant(context.settings)),
  "code-exchange": (context) => exchange(context, codeGrant(context.settings)),
  "code-replay": (context) => replay(context, codeGrant(context.settings)),
  "pkce-missing": async (context) => {
    const parameters = codeGrant(context.settings);
    delete parameters.code_verifier;
    const without = await exchange(context, parameters);
    if (without) {
      context.result.observations.push(
        "省略 verifier 仍兌換成功；請確認此授權碼原本確實綁定 PKCE，才可評估影響。",
      );
      return;
    }
    const rejected = context.result.status;
    const valid = await exchange(context, codeGrant(context.settings));
    context.result.status =
      valid && rejected === "BLOCKED" ? "BLOCKED" : "INCONCLUSIVE";
    context.result.observations.push(
      valid
        ? "省略 verifier 被拒絕，提供正確 verifier 可成功，PKCE 對照成立。"
        : "正確 verifier 也未能兌換，可能授權碼已失效，無法判定 PKCE 防護。",
    );
  },
});
