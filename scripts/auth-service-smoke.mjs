import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPublicKey, verify } from "node:crypto";
import { redact } from "../src/runner.js";
import { loadAuthSource } from "./lib/auth-source.mjs";

const { createTestService, ISSUER, APP_ORIGIN, REDIRECT_URI, revision } =
  await loadAuthSource();
const results = [];
let suppressedWarnings = 0;
const originalWarn = console.warn;
console.warn = () => {
  suppressedWarnings++;
};
try {
  async function scenario(id, execute) {
    const started = performance.now();
    const s = await createTestService();
    const evidence = [];
    const assertions = [];
    const check = (name, condition) =>
      assertions.push({ name, passed: Boolean(condition) });
    async function request(path, init = {}) {
      if (evidence.length >= 12) throw new Error("Request budget exceeded");
      const headers = new Headers(init.headers);
      if (s.jar.size)
        headers.set(
          "cookie",
          [...s.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        );
      const response = await s.request(path, init);
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { htmlResponse: true, bytes: Buffer.byteLength(text) };
      }
      let requestBody;
      try {
        requestBody = init.body ? JSON.parse(init.body) : undefined;
      } catch {
        requestBody = { malformedJson: true };
      }
      evidence.push(
        redact({
          request: {
            method: init.method || "GET",
            path,
            headers: Object.fromEntries(headers),
            body: requestBody,
          },
          response: {
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body,
          },
        }),
      );
      return { status: response.status, headers: response.headers, body };
    }
    const authorize = (overrides = {}) =>
      "/authorize?" +
      new URLSearchParams({
        client_id: "app",
        redirect_uri: REDIRECT_URI,
        state: "client-state",
        ...overrides,
      });
    const post = (path, body, origin = APP_ORIGIN) =>
      request(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(body),
      });
    async function login() {
      const start = await request(authorize());
      const providerState = new URL(
        start.headers.get("location"),
      ).searchParams.get("state");
      return request(
        "/callback/google?" +
          new URLSearchParams({ state: providerState, code: "me" }),
      );
    }
    let status = "ERROR";
    try {
      await execute({ s, request, authorize, post, login, check });
      status =
        assertions.length && assertions.every((a) => a.passed)
          ? "PASS"
          : "FAIL";
    } catch {
      status = "ERROR";
    } finally {
      s.jar.clear();
    }
    results.push({
      id,
      timestamp: new Date().toISOString(),
      environment: "LOCAL_SOURCE",
      revision: 1,
      target: `auth-service@${revision}`,
      status,
      assertions,
      evidence,
      durationMs: Math.round(performance.now() - started),
      cleanup: "complete",
    });
  }

  await scenario(
    "authorization-validation",
    async ({ request, authorize, check }) => {
      for (const overrides of [
        { client_id: "unknown" },
        { redirect_uri: "https://evil.test" },
        { state: "" },
        { state: "x".repeat(513) },
      ]) {
        const r = await request(authorize(overrides));
        check(
          "Invalid authorization returns 400 without redirect or refresh cookie",
          r.status === 400 &&
            !r.headers.get("location") &&
            !r.headers.getSetCookie().some((c) => c.startsWith("__Host-rt=")),
        );
      }
    },
  );
  await scenario(
    "callback-state-replay",
    async ({ s, request, authorize, check }) => {
      const start = await request(authorize());
      const state = new URL(start.headers.get("location")).searchParams.get(
        "state",
      );
      const cookie = s.jar.get("__Host-oauth_state");
      const path = `/callback/google?state=${state}&code=me`;
      s.jar.clear();
      check(
        "Missing state cookie rejected",
        (await request(path)).status === 400,
      );
      s.jar.set("__Host-oauth_state", cookie);
      const first = await request(path);
      check(
        "Valid callback issues secure refresh cookie",
        first.status === 302 &&
          first.headers
            .getSetCookie()
            .some(
              (c) =>
                c.startsWith("__Host-rt=") &&
                /HttpOnly/i.test(c) &&
                /Secure/i.test(c) &&
                /SameSite=Lax/i.test(c),
            ),
      );
      check(
        "Client state returned without tokens",
        new URL(first.headers.get("location")).searchParams.get("state") ===
          "client-state" && !/token/.test(first.headers.get("location")),
      );
      s.jar.set("__Host-oauth_state", cookie);
      const replay = await request(path);
      check(
        "Replay cannot issue another session",
        replay.status === 400 &&
          !replay.headers.getSetCookie().some((c) => /^__Host-rt=.+/.test(c)),
      );
    },
  );
  await scenario("token-validation", async ({ s, post, login, check }) => {
    await login();
    for (const [body, origin, status, error] of [
      [{ client_id: "unknown" }, APP_ORIGIN, 400, "invalid_client"],
      [{ client_id: "app" }, null, 403, "invalid_origin"],
      [{ client_id: "app" }, "https://evil.test", 403, "invalid_origin"],
    ]) {
      const r = await post("/token", body, origin);
      check(
        "Invalid client or Origin cannot obtain token",
        r.status === status && r.body.error === error && !r.body.access_token,
      );
    }
    s.jar.clear();
    const missing = await post("/token", { client_id: "app" });
    check(
      "Missing session returns login_required",
      missing.status === 401 &&
        missing.body.error === "login_required" &&
        !missing.body.access_token,
    );
  });
  await scenario(
    "rotation-grace-revocation",
    async ({ s, post, login, check }) => {
      await login();
      const old = s.jar.get("__Host-rt");
      const first = await post("/token", { client_id: "app" });
      const next = s.jar.get("__Host-rt");
      check(
        "Valid session rotates cookie",
        first.status === 200 && first.body.access_token && old !== next,
      );
      s.clock.now += 30;
      s.jar.set("__Host-rt", old);
      const grace = await post("/token", { client_id: "app" });
      check(
        "30-second grace returns token without new cookie",
        grace.status === 200 &&
          grace.body.access_token &&
          grace.headers.getSetCookie().length === 0,
      );
      s.clock.now += 1;
      const reuse = await post("/token", { client_id: "app" });
      check(
        "Reuse after grace rejected",
        reuse.status === 401 && !reuse.body.access_token,
      );
      s.jar.set("__Host-rt", next);
      check(
        "Successor revoked too",
        (await post("/token", { client_id: "app" })).status === 401,
      );
    },
  );
  await scenario("concurrent-rotation", async ({ s, post, login, check }) => {
    await login();
    const old = s.jar.get("__Host-rt");
    const responses = await Promise.all([
      post("/token", { client_id: "app" }),
      post("/token", { client_id: "app" }),
    ]);
    check(
      "Concurrent calls both issue access tokens",
      responses.every((r) => r.status === 200 && r.body.access_token),
    );
    check(
      "Exactly one concurrent call rotates cookie",
      responses.filter((r) =>
        r.headers.getSetCookie().some((c) => c.startsWith("__Host-rt=")),
      ).length === 1,
    );
    check(
      "Browser jar receives successor session",
      s.jar.get("__Host-rt") !== old,
    );
    check(
      "Successor can issue another token",
      (await post("/token", { client_id: "app" })).status === 200,
    );
  });
  for (const all of [false, true])
    await scenario(
      all ? "logout-all" : "logout-single",
      async ({ s, post, login, check }) => {
        await login();
        const first = s.jar.get("__Host-rt");
        s.jar.clear();
        await login();
        const second = s.jar.get("__Host-rt");
        const logout = await post("/logout", { client_id: "app", all });
        check(
          "Logout clears refresh cookie",
          logout.status === 204 &&
            !s.jar.has("__Host-rt") &&
            logout.headers
              .getSetCookie()
              .some((c) => c.startsWith("__Host-rt=;") && /Max-Age=0/i.test(c)),
        );
        s.jar.set("__Host-rt", second);
        check(
          "Logged-out session cannot mint token",
          (await post("/token", { client_id: "app" })).status === 401,
        );
        s.jar.set("__Host-rt", first);
        const other = await post("/token", { client_id: "app" });
        check(
          all ? "Other device revoked" : "Other device remains valid",
          all
            ? other.status === 401
            : other.status === 200 && other.body.access_token,
        );
      },
    );
  await scenario("logout-origin", async ({ post, login, check }) => {
    await login();
    const r = await post("/logout", { client_id: "app" }, "https://evil.test");
    check(
      "Foreign Origin rejected without clearing cookie",
      r.status === 403 &&
        r.body.error === "invalid_origin" &&
        r.headers.getSetCookie().length === 0,
    );
    check(
      "Session remains usable",
      (await post("/token", { client_id: "app" })).status === 200,
    );
  });
  await scenario("metadata-jwt", async ({ request, post, login, check }) => {
    const discovery = await request("/.well-known/openid-configuration");
    check(
      "Discovery endpoints match source issuer",
      discovery.status === 200 &&
        discovery.body.issuer === ISSUER &&
        discovery.body.jwks_uri === `${ISSUER}/jwks` &&
        discovery.body.token_endpoint === `${ISSUER}/token` &&
        discovery.body.code_challenge_methods_supported.includes("S256"),
    );
    const jwks = await request("/jwks");
    check(
      "Only public ES256 keys exposed",
      jwks.status === 200 &&
        jwks.body.keys.length > 0 &&
        jwks.body.keys.every(
          (k) =>
            k.alg === "ES256" &&
            !["d", "k", "p", "q"].some((name) => name in k),
        ),
    );
    await login();
    const token = await post("/token", { client_id: "app" });
    const parts = token.body.access_token.split(".");
    const header = JSON.parse(Buffer.from(parts[0], "base64url"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
    const key = jwks.body.keys.find((k) => k.kid === header.kid);
    check(
      "Published key verifies issued JWT signature",
      header.alg === "ES256" &&
        key &&
        verify(
          "sha256",
          Buffer.from(parts.slice(0, 2).join(".")),
          {
            key: createPublicKey({ key, format: "jwk" }),
            dsaEncoding: "ieee-p1363",
          },
          Buffer.from(parts[2], "base64url"),
        ),
    );
    check(
      "JWT issuer, audience and expiry match source contract",
      claims.iss === ISSUER &&
        claims.aud === "app" &&
        claims.exp - claims.iat === 900,
    );
  });
  await scenario(
    "bounded-rate-limit",
    async ({ s, request, authorize, check }) => {
      s.rateLimit.limit = 3;
      for (let i = 0; i < 3; i++)
        check(
          "Within budget accepted",
          (await request(authorize())).status === 302,
        );
      const r = await request(authorize());
      check(
        "429 with Retry-After and no provider redirect",
        r.status === 429 &&
          r.headers.get("retry-after") === "60" &&
          !r.headers.get("location"),
      );
      s.rateLimit.reset();
      check(
        "Injected limiter reset restores access",
        (await request(authorize())).status === 302,
      );
    },
  );
  await scenario("malformed-json", async ({ request, check }) => {
    const r = await request("/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: APP_ORIGIN },
      body: '{"client_id":',
    });
    check(
      "Source normalizes malformed JSON to invalid_client",
      r.status === 400 &&
        r.body.error === "invalid_client" &&
        !r.body.access_token &&
        !/stack|trace|SyntaxError/.test(JSON.stringify(r.body)),
    );
    check(
      "Service remains healthy",
      (await request("/health")).body.ok === true,
    );
  });
} finally {
  console.warn = originalWarn;
}
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: "LOCAL_SOURCE",
  sourceRevision: revision,
  limitations: [
    "Real Hono routes using in-memory storage, fake Google provider and injected clock.",
    "Not HTTP deployment, D1, real Google login, or browser cookie/CORS validation.",
  ],
  suppressedWarnings,
  results,
};
const output = process.env.REPORT_PATH;
if (output)
  await writeFile(
    resolve(output),
    JSON.stringify(redact(report), null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
console.log(
  JSON.stringify({
    environment: report.environment,
    sourceRevision: revision,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results
      .filter((r) => r.status !== "PASS")
      .map((r) => ({
        id: r.id,
        status: r.status,
        assertions: r.assertions.filter((a) => !a.passed),
      })),
    reportWritten: Boolean(output),
  }),
);
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
