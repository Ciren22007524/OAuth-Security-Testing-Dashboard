import { createServer } from "node:http";

export const DEMO_CLIENT = "demo-client";
export const DEMO_SECRET = "demo-secret";
export async function createAttackFixture() {
  const tokens = new Set();
  const server = createServer(async (req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const reply = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/.well-known/openid-configuration")
      return reply(200, {
        issuer: base,
        token_endpoint: `${base}/token`,
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
        ],
        grant_types_supported: ["client_credentials"],
      });
    if (req.url === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = new URLSearchParams(raw);
      const basic = Buffer.from(
        (req.headers.authorization || "").replace(/^Basic /, ""),
        "base64",
      )
        .toString()
        .split(":")
        .map((value) => decodeURIComponent(value.replaceAll("+", " ")));
      const client = body.get("client_id") || basic[0];
      const secret = body.get("client_secret") || basic[1];
      if (client !== DEMO_CLIENT || secret !== DEMO_SECRET)
        return reply(401, { error: "invalid_client" });
      if (body.get("grant_type") !== "client_credentials")
        return reply(400, { error: "unsupported_grant_type" });
      if (body.get("scope") && body.get("scope") !== "read")
        return reply(400, { error: "invalid_scope" });
      const token = "demo-access-token";
      tokens.add(token);
      return reply(200, {
        access_token: token,
        token_type: "Bearer",
        scope: "read",
        expires_in: 60,
      });
    }
    if (req.url === "/resource" && req.method === "GET")
      return tokens.has(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      )
        ? reply(200, { message: "isolated demo resource" })
        : reply(401, { error: "invalid_token" });
    return reply(404, { error: "not_found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
