import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export const CLIENT = "dashboard-test";
export const ORIGIN = "https://dashboard.test";
export const REDIRECT = `${ORIGIN}/callback`;

// A protocol fixture, not a copy of the private service. Never uses real accounts.
export async function createFixture({ vulnerable = false, fault } = {}) {
  const transactions = new Map();
  const sessions = new Map();
  let now = 0;
  let revoked = false;
  function seed() {
    const token = randomUUID();
    sessions.set(token, { expires: now + 3600_000, used: null, next: null });
    return token;
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const url = new URL(req.url, "http://fixture");
    const reply = (status, data, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(data));
    };
    if (req.method === "GET" && url.pathname === "/health")
      return reply(200, { ok: true });
    if (req.method === "GET" && url.pathname === "/authorize") {
      if (
        url.searchParams.get("client_id") !== CLIENT &&
        fault !== "authorize-client"
      )
        return reply(400, { error: "invalid_client" });
      if (url.searchParams.get("redirect_uri") !== REDIRECT && !vulnerable)
        return reply(400, { error: "invalid_redirect_uri" });
      const state = url.searchParams.get("state");
      if ((!state || state.length > 512) && fault !== "state-bounds")
        return reply(400, { error: "invalid_state" });
      const providerState = randomUUID();
      transactions.set(providerState, {
        expires: now + 600_000,
        clientState: state,
      });
      return reply(
        302,
        { provider: "mock", transactionCreated: true },
        {
          Location: `/mock-provider?state=${encodeURIComponent(providerState)}`,
          "Set-Cookie": `__Host-oauth_state=${providerState}; Secure; HttpOnly; SameSite=Lax; Path=/`,
        },
      );
    }
    if (req.method === "GET" && url.pathname === "/callback/google") {
      const state = url.searchParams.get("state");
      const cookie = /(?:^|;\s*)__Host-oauth_state=([^;]+)/.exec(
        req.headers.cookie || "",
      )?.[1];
      const transaction = transactions.get(state);
      if (
        !state ||
        !transaction ||
        (state !== cookie && fault !== "callback-cookie")
      )
        return reply(400, { error: "invalid_state" });
      if (fault !== "callback-replay") transactions.delete(state);
      const back = new URL(REDIRECT);
      back.searchParams.set("state", transaction.clientState);
      if (transaction.expires < now) {
        back.searchParams.set("error", "login_expired");
        return reply(
          302,
          { error: "login_expired" },
          { Location: back.toString() },
        );
      }
      const token = seed();
      return reply(
        302,
        { authenticated: true },
        {
          Location: back.toString(),
          "Set-Cookie": `__Host-rt=${token}; Secure; HttpOnly; SameSite=Lax; Path=/`,
        },
      );
    }
    if (req.method === "POST" && url.pathname === "/token") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) return reply(413, { error: "body_too_large" });
      }
      let input;
      try {
        input = JSON.parse(body);
      } catch {
        return reply(400, { error: "invalid_json" });
      }
      if (input?.client_id !== CLIENT && fault !== "token-client")
        return reply(400, { error: "invalid_client" });
      if (req.headers.origin !== ORIGIN && fault !== "token-origin")
        return reply(403, { error: "invalid_origin" });
      res.setHeader("Access-Control-Allow-Origin", ORIGIN);
      const token = /(?:^|;\s*)__Host-rt=([^;]+)/.exec(
        req.headers.cookie || "",
      )?.[1];
      let session = sessions.get(token);
      if (fault === "token-session" && (!session || session.expires <= now))
        session = sessions.get(seed());
      if (revoked || !session || session.expires <= now)
        return reply(401, { error: "login_required" });
      if (session.used !== null && now - session.used > 30_000) {
        revoked = fault !== "reuse-revoke";
        return reply(401, { error: "login_required" });
      }
      if (session.used !== null && fault === "reject-grace")
        return reply(401, { error: "login_required" });
      let headers = {};
      if (session.used === null) {
        session.used = now;
        session.next = seed();
        headers = {
          "Set-Cookie": `__Host-rt=${session.next}; Secure; HttpOnly; SameSite=Lax; Path=/`,
        };
      }
      if (fault === "duplicate-rotation-cookie")
        headers = {
          "Set-Cookie": `__Host-rt=${session.next}; Secure; HttpOnly; SameSite=Lax; Path=/`,
        };
      // Opaque fixture value: intentionally not presented as a signed JWT.
      return reply(
        200,
        { access_token: `fixture-${randomUUID()}`, token_type: "Bearer" },
        headers,
      );
    }
    reply(404, { error: "not_found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    seed,
    advance: (ms) => {
      now += ms;
    },
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
