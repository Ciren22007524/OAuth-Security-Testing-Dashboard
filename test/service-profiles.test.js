import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { createHttpRunner, getHttpCatalog } from "../src/http-runner.js";
import {
  createAttackRunner,
  getAttackCatalog,
  validateAttackInput,
} from "../src/attack-runner.js";
import { validateEnvironment } from "../src/environments.js";
const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: "source-test-key",
  use: "sig",
};
async function target(t, handler) {
  const server = createServer((req, res) =>
    handler(req, res, `http://127.0.0.1:${server.address().port}`),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
const profile = (baseUrl, protocol) => ({
  id: "profile",
  name: "test",
  type: "http",
  revision: 1,
  baseUrl,
  protocol,
});
const reply = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

test("protocol catalogs isolate legacy, current OIDC and Array session", () => {
  assert.equal(
    getHttpCatalog(profile("http://localhost", "legacy")).length,
    10,
  );
  assert.equal(
    getHttpCatalog(profile("http://localhost", "auth-service-oidc")).length,
    3,
  );
  assert.equal(
    getAttackCatalog(profile("http://localhost", "auth-service-oidc")).length,
    7,
  );
  assert.ok(
    getAttackCatalog(profile("http://localhost", "array-session")).every(
      (s) => s.category === "Array session",
    ),
  );
  assert.throws(() =>
    validateEnvironment({
      name: "x",
      type: "http",
      baseUrl: "http://localhost",
      protocol: "__proto__",
    }),
  );
  assert.throws(() =>
    validateAttackInput(
      { sessionCookie: "x\r\nCookie: other=1" },
      "array-held-session",
    ),
  );
  assert.equal(
    validateEnvironment({
      name: "x",
      type: "http",
      baseUrl: "http://localhost",
    }).protocol,
    undefined,
  );
});

test("current discovery follows declared /oidc JWKS and accepts valid RS256 instead of ES256", async (t) => {
  const paths = [];
  let privateKey = false;
  const base = await target(t, (req, res, origin) => {
    paths.push(req.url);
    if (req.url === "/health") return reply(res, 200, { ok: true });
    if (req.url.startsWith("/.well-known"))
      return reply(res, 200, {
        issuer: origin,
        authorization_endpoint: origin + "/oidc/auth",
        token_endpoint: origin + "/oidc/token",
        jwks_uri: origin + "/oidc/jwks",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    if (req.url === "/oidc/jwks")
      return reply(res, 200, {
        keys: [
          { ...key, ...(privateKey ? { d: "private-test-material" } : {}) },
        ],
      });
    reply(res, 404, {});
  });
  const runner = createHttpRunner({ minimumInterval: 0 });
  const env = profile(base, "auth-service-oidc");
  for (const id of ["oidc-health", "oidc-discovery", "oidc-jwks"])
    assert.equal((await runner(id, env)).status, "PASS", id);
  assert.ok(!paths.includes("/jwks"));
  privateKey = true;
  const bad = await runner("oidc-jwks", env);
  assert.equal(bad.status, "FAIL");
  assert.ok(!JSON.stringify(bad).includes("private-test-material"));
});

test("OIDC discovery cannot fetch foreign JWKS or manufacture pass from HTML", async (t) => {
  let outside = 0;
  const foreign = await target(t, (req, res) => {
    outside++;
    reply(res, 200, { keys: [key] });
  });
  let html = false;
  const base = await target(t, (req, res, origin) =>
    html
      ? reply(res, 200, "<html>login</html>", "text/html")
      : reply(res, 200, {
          issuer: origin,
          authorization_endpoint: origin + "/oidc/auth",
          token_endpoint: origin + "/oidc/token",
          jwks_uri: foreign + "/keys",
        }),
  );
  const runner = createHttpRunner({ minimumInterval: 0 });
  assert.equal(
    (await runner("oidc-jwks", profile(base, "auth-service-oidc"))).status,
    "INCONCLUSIVE",
  );
  assert.equal(outside, 0);
  html = true;
  assert.equal(
    (await runner("oidc-discovery", profile(base, "auth-service-oidc"))).status,
    "INCONCLUSIVE",
  );
});

test("Array session reads follow JSON schema, redact identities and never use generic OAuth grants", async (t) => {
  const cookie = "A".repeat(43);
  let mode = "normal";
  const base = await target(t, (req, res) => {
    if (req.url === "/health")
      return reply(res, 200, { service: "array-sso-test", status: "up" });
    if (mode === "html")
      return reply(res, 200, "<html>login</html>", "text/html");
    if (mode === "expired")
      return reply(res, 200, { user: { sub: "private-user" }, expiresAt: 1 });
    if (req.headers.cookie === `__Host-array_sso_session=${cookie}`)
      return reply(res, 200, {
        user: {
          sub: "private-user",
          name: "Private Person",
          email: "private@example.test",
        },
        expiresAt: Date.now() / 1000 + 600,
      });
    reply(res, 401, { error: "login_required" });
  });
  const env = profile(base, "array-session"),
    read = createHttpRunner({ minimumInterval: 0 }),
    attack = createAttackRunner({ minimumInterval: 0 });
  for (const id of ["array-health", "array-anonymous", "array-bearer"])
    assert.equal((await read(id, env)).status, "PASS");
  for (const id of ["array-no-session", "array-forged-session"])
    assert.equal((await attack(id, env, {})).status, "BLOCKED");
  const result = await attack("array-held-session", env, {
    sessionCookie: cookie,
  });
  assert.equal(result.status, "SUCCEEDED");
  for (const secret of [
    cookie,
    "private-user",
    "Private Person",
    "private@example.test",
  ])
    assert.ok(!JSON.stringify(result).includes(secret));
  mode = "html";
  assert.equal((await read("array-anonymous", env)).status, "INCONCLUSIVE");
  assert.equal(
    (await attack("array-held-session", env, { sessionCookie: cookie })).status,
    "INCONCLUSIVE",
  );
  mode = "expired";
  assert.equal(
    (await attack("array-no-session", env, {})).status,
    "INCONCLUSIVE",
  );
});

test("generic protected resources require declared JSON data field, not just a 2xx", async (t) => {
  let mode = "html";
  const base = await target(t, (req, res) => {
    if (!req.headers.authorization)
      return reply(res, 401, { error: "invalid_token" });
    if (mode === "html")
      return reply(res, 200, "<html>login</html>", "text/html");
    if (mode === "error") return reply(res, 200, { error: "login_required" });
    reply(res, 200, { data: { id: "resource-value" } });
  });
  const runner = createAttackRunner({ minimumInterval: 0 }),
    env = profile(base, "legacy"),
    input = {
      accessToken: "operator-supplied-private-token",
      resourcePath: "/data",
      successField: "data.id",
    };
  assert.equal(
    (await runner("token-resource", env, input)).status,
    "INCONCLUSIVE",
  );
  mode = "error";
  assert.equal(
    (await runner("token-resource", env, input)).status,
    "INCONCLUSIVE",
  );
  mode = "data";
  assert.equal(
    (await runner("token-resource", env, input)).status,
    "SUCCEEDED",
  );
  input.successField = "data.missing";
  assert.equal(
    (await runner("token-resource", env, input)).status,
    "INCONCLUSIVE",
  );
});
