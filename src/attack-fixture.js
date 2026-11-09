import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

export const DEMO_CLIENT = "demo-client";
export const DEMO_SECRET = "demo-secret";
export const DEMO_VERIFIER = "demo-verifier-".padEnd(43, "v");
// Faults are available to tests only, never to dashboard API callers.
export async function createAttackFixture({
  allowCodeReplay = false,
  allowRefreshReplay = false,
  allowMissingPkce = false,
  allowScopeExpansion = false,
} = {}) {
  const tokens = new Map([
    ["demo-access-token", { scope: "read", user: true }],
  ]);
  const refreshTokens = new Set(["demo-refresh-token"]);
  const codes = new Set(["demo-code"]);
  const challenge = createHash("sha256")
    .update(DEMO_VERIFIER)
    .digest("base64url");
  const server = createServer(async (req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const reply = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    const mint = (scope, user, refresh = false) => {
      const access_token = "demo-issued-" + randomUUID();
      tokens.set(access_token, { scope, user });
      const result = {
        access_token,
        token_type: "Bearer",
        scope,
        expires_in: 60,
      };
      if (refresh) {
        result.refresh_token = "demo-refresh-issued-" + randomUUID();
        refreshTokens.add(result.refresh_token);
      }
      return result;
    };
    if (req.url === "/.well-known/openid-configuration")
      return reply(200, {
        issuer: base,
        token_endpoint: base + "/token",
        userinfo_endpoint: base + "/userinfo",
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
          "none",
        ],
        grant_types_supported: [
          "client_credentials",
          "authorization_code",
          "refresh_token",
        ],
        code_challenge_methods_supported: ["S256"],
      });
    if (req.url === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = new URLSearchParams(raw);
      let basic = [];
      try {
        basic = Buffer.from(
          (req.headers.authorization || "").replace(/^Basic /, ""),
          "base64",
        )
          .toString()
          .split(":")
          .map((v) => decodeURIComponent(v.replaceAll("+", " ")));
      } catch {}
      const client = body.get("client_id") || basic[0];
      const secret = body.get("client_secret") || basic[1];
      if (
        !(client === DEMO_CLIENT && secret === DEMO_SECRET) &&
        !(client === "demo-public" && !secret)
      )
        return reply(401, { error: "invalid_client" });
      const grant = body.get("grant_type");
      const scope = body.get("scope") || "read";
      if (scope !== "read" && !(allowScopeExpansion && scope === "admin"))
        return reply(400, { error: "invalid_scope" });
      if (grant === "client_credentials") return reply(200, mint(scope, false));
      if (grant === "refresh_token") {
        const token = body.get("refresh_token");
        if (!refreshTokens.has(token))
          return reply(400, { error: "invalid_grant" });
        if (!allowRefreshReplay) refreshTokens.delete(token);
        return reply(200, mint(scope, true, true));
      }
      if (grant === "authorization_code") {
        const code = body.get("code");
        const verifier = body.get("code_verifier");
        if (
          !codes.has(code) ||
          body.get("redirect_uri") !== "https://app.example.test/callback"
        )
          return reply(400, { error: "invalid_grant" });
        if (
          !(allowMissingPkce && !verifier) &&
          (!verifier ||
            createHash("sha256").update(verifier).digest("base64url") !==
              challenge)
        )
          return reply(400, { error: "invalid_grant" });
        if (!allowCodeReplay) codes.delete(code);
        return reply(200, mint(scope, true));
      }
      return reply(400, { error: "unsupported_grant_type" });
    }
    if (
      ["/resource", "/userinfo", "/admin"].includes(req.url) &&
      req.method === "GET"
    ) {
      const token = tokens.get(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      );
      if (!token) return reply(401, { error: "invalid_token" });
      if (req.url === "/userinfo")
        return token.user
          ? reply(200, {
              sub: "demo-private-user",
              email: "fixture@example.invalid",
            })
          : reply(403, { error: "insufficient_scope" });
      if (req.url === "/admin" && token.scope !== "admin")
        return reply(403, { error: "insufficient_scope" });
      return reply(200, { message: "isolated demo resource" });
    }
    return reply(404, { error: "not_found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
