const definitions = {
  clientId: {
    maxLength: 200,
    label: "Client ID",
    placeholder: "例如測試 client 的 ID",
  },
  clientSecret: {
    label: "Client secret",
    type: "password",
    placeholder: "此情境持有的 client secret",
  },
  accessToken: {
    label: "已取得的 access token",
    type: "password",
    maxLength: 4096,
  },
  refreshToken: {
    label: "已取得的 refresh token",
    type: "password",
    maxLength: 4096,
  },
  code: { label: "已取得的授權碼", type: "password" },
  codeVerifier: {
    label: "原始 PKCE code_verifier",
    type: "password",
    maxLength: 128,
  },
  redirectUri: {
    maxLength: 1024,
    label: "此授權碼對應的 redirect URI",
    type: "url",
    placeholder: "https://app.example.test/callback",
  },
  scope: { label: "要求的 scope（選填）", maxLength: 512 },
  baselineScope: {
    label: "已知允許的對照 scope",
    placeholder: "例如 read",
    maxLength: 512,
  },
  elevatedScope: {
    label: "要嘗試擴大的 scope",
    placeholder: "例如 admin",
    maxLength: 512,
  },
  authMethod: {
    label: "Client 認證方式",
    type: "select",
    options: [
      { value: "auto", label: "依 OIDC discovery" },
      { value: "client_secret_basic", label: "client_secret_basic" },
      { value: "client_secret_post", label: "client_secret_post" },
      { value: "none", label: "公開 client，不附 secret" },
    ],
  },
  tokenPath: {
    maxLength: 1024,
    label: "Token 路徑（選填）",
    placeholder: "留白讀取 discovery；或 /oauth/token",
  },
  resourcePath: { label: "要讀取的資源路徑", placeholder: "例如 /api/profile" },
  userinfoPath: {
    label: "UserInfo 路徑（選填）",
    placeholder: "留白使用 discovery 的 userinfo_endpoint",
  },
};
const tokenFields = ["clientId", "clientSecret", "authMethod", "tokenPath"];
const scenarios = [
  {
    id: "secret-token",
    title: "持有 client secret：取得 access token",
    category: "Client secret",
    expected: "以 client_credentials 嘗試取得此 client 的 Bearer token。",
    fields: [...tokenFields, "scope"],
    required: ["clientId", "clientSecret"],
    requestBudget: 2,
  },
  {
    id: "secret-resource",
    title: "持有 client secret：讀取受保護資源",
    category: "Client secret",
    expected: "先確認未附憑證回 401／403，再取得 token 比較指定資源是否可讀。",
    fields: [...tokenFields, "scope", "resourcePath"],
    required: ["clientId", "clientSecret", "resourcePath"],
    requestBudget: 4,
  },
  {
    id: "secret-scope",
    title: "持有 client secret：擴大要求的 scope",
    category: "Client secret",
    expected:
      "先取得已知 scope 的對照 token，再要求另一 scope；只確認實際簽發範圍的變化。",
    fields: [...tokenFields, "baselineScope", "elevatedScope"],
    required: ["clientId", "clientSecret", "baselineScope", "elevatedScope"],
    requestBudget: 3,
  },
  {
    id: "token-resource",
    title: "持有 access token：讀取指定資源",
    category: "Access token",
    expected:
      "比較未附憑證與附上此 token 的 GET 回應，確認持有者能否讀取指定路徑。",
    fields: ["accessToken", "resourcePath"],
    required: ["accessToken", "resourcePath"],
    requestBudget: 2,
  },
  {
    id: "token-userinfo",
    title: "持有 access token：取得使用者資訊",
    category: "Access token",
    expected:
      "比較 UserInfo 的未登入對照，觀察此 token 是否取得含 sub 的 JSON 回應；不匯出使用者資料。",
    fields: ["accessToken", "userinfoPath"],
    required: ["accessToken"],
    requestBudget: 3,
  },
  {
    id: "refresh-token",
    title: "持有 refresh token：換取新 access token",
    category: "Refresh token",
    expected: "使用這枚 refresh token、client 與選填 secret 嘗試更新 token。",
    fields: [...tokenFields, "refreshToken", "scope"],
    required: ["clientId", "refreshToken"],
    requestBudget: 2,
    impact: "可能輪替提供的 refresh token；新 token 不會保留。",
  },
  {
    id: "refresh-replay",
    title: "持有舊 refresh token：輪替後再次重用",
    category: "Refresh token",
    expected:
      "先成功兌換，再重送同一枚舊 refresh token；初次兌換失敗不算已證明重用防護。",
    fields: [...tokenFields, "refreshToken", "scope"],
    required: ["clientId", "refreshToken"],
    requestBudget: 3,
    impact:
      "會對同一 refresh token 兌換兩次，可能使原 session 或 token family 失效。",
  },
  {
    id: "code-exchange",
    title: "持有授權碼：嘗試換取 token",
    category: "授權碼／PKCE",
    expected:
      "使用授權碼、對應 redirect URI 與選填 verifier／secret 兌換 token。",
    fields: [...tokenFields, "code", "redirectUri", "codeVerifier"],
    required: ["clientId", "code", "redirectUri"],
    requestBudget: 2,
    impact: "成功交換會消耗這枚授權碼。",
  },
  {
    id: "code-replay",
    title: "持有授權碼：成功兌換後重播",
    category: "授權碼／PKCE",
    expected:
      "先證明這枚授權碼可用，再以相同參數重送；只在有效對照成立後判讀重播是否成功。",
    fields: [...tokenFields, "code", "redirectUri", "codeVerifier"],
    required: ["clientId", "code", "redirectUri"],
    requestBudget: 3,
    impact: "會消耗授權碼並重送一次；provider 可能撤銷相關 token。",
  },
  {
    id: "pkce-missing",
    title: "持有 PKCE 授權碼：省略 verifier 兌換",
    category: "授權碼／PKCE",
    expected:
      "先省略 verifier；若被拒絕，再使用原始 verifier 驗證授權碼本身有效。",
    fields: [...tokenFields, "code", "redirectUri", "codeVerifier"],
    required: ["clientId", "code", "redirectUri", "codeVerifier"],
    requestBudget: 3,
    impact: "請使用原本綁定 PKCE 的授權碼；成功交換會消耗它。",
  },
];
export const attackCatalog = scenarios.map((s) => ({
  ...s,
  revision: 2,
  testingMode: "attack",
  prerequisites: s.required.map((key) => definitions[key].label),
  fields: s.fields.map((key) => ({
    key,
    ...definitions[key],
    ...(key === "authMethod" && s.category === "Client secret"
      ? {
          options: definitions.authMethod.options.filter(
            (option) => option.value !== "none",
          ),
        }
      : {}),
    required: s.required.includes(key),
    maxLength: definitions[key].maxLength || 2048,
  })),
}));
const paths = new Set(["tokenPath", "resourcePath", "userinfoPath"]);
export function validateAttackInput(input = {}, id) {
  const scenario = id && attackCatalog.find((s) => s.id === id);
  const fields = scenario
    ? scenario.fields.map((f) => f.key)
    : Object.keys(definitions);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new Error("Invalid attack input");
  for (const [key, value] of Object.entries(input)) {
    if (
      typeof value !== "string" ||
      value.length > (definitions[key].maxLength || 2048) ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new Error("Invalid attack input");
    if (value && paths.has(key)) {
      const parsed = new URL(value, "http://target.invalid");
      if (
        !/^\/(?!\/)/.test(value) ||
        /[\\?#\s]/.test(value) ||
        parsed.origin !== "http://target.invalid" ||
        parsed.pathname !== value
      )
        throw new Error("Invalid endpoint path");
    }
    if (key === "redirectUri" && value) {
      const url = new URL(value);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new Error("Invalid redirect URI");
    }
  }
  if (
    input.authMethod &&
    !(
      scenario?.fields.find((f) => f.key === "authMethod")?.options ||
      definitions.authMethod.options
    ).some((o) => o.value === input.authMethod)
  )
    throw new Error("Invalid client authentication");
  return { ...input };
}
export function demoSettings(id) {
  const all = {
    clientId: "demo-client",
    clientSecret: "demo-secret",
    accessToken: "demo-access-token",
    refreshToken: "demo-refresh-token",
    code: "demo-code",
    codeVerifier: "demo-verifier-".padEnd(43, "v"),
    redirectUri: "https://app.example.test/callback",
    baselineScope: "read",
    elevatedScope: "admin",
    resourcePath: "/resource",
  };
  const scenario = attackCatalog.find((s) => s.id === id);
  return Object.fromEntries(
    scenario.fields.filter((f) => all[f.key]).map((f) => [f.key, all[f.key]]),
  );
}
