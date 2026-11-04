import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAttackRunner,
  validateAttackInput,
  attackCatalog,
} from "../src/attack-runner.js";
import { createAttackFixture, DEMO_SECRET } from "../src/attack-fixture.js";
import { dashboardServer } from "../src/server.js";

import { catalog } from "../src/runner.js";
import { httpCatalog } from "../src/http-runner.js";
import { simulationHandlers } from "../src/simulation-scenarios.js";
import { httpHandlers } from "../src/http-scenarios.js";

test("every defense scenario has an explicit registered handler", () => {
  for (const scenario of catalog)
    if (!["browser-cors", "jwt-verifier"].includes(scenario.id))
      assert.equal(typeof simulationHandlers[scenario.id], "function");
  for (const scenario of httpCatalog)
    assert.equal(typeof httpHandlers[scenario.id], "function");
});

const profile = { id: "local", name: "test", type: "simulation", revision: 1 };
const live = (url) => ({
  ...profile,
  id: "test-http",
  type: "http",
  baseUrl: url,
});
async function target(t, handler) {
  const server = createServer((req, res) =>
    handler(req, res, `http://127.0.0.1:${server.address().port}`),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}
const run = () => createAttackRunner({ minimumInterval: 0 });

test("attack fixture demonstrates client capability without changing defense semantics", async () => {
  const runner = run();
  for (const scenario of attackCatalog) {
    const result = await runner(scenario.id, profile, {});
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.testingMode, "attack");
    assert.equal(result.evidence.length, scenario.requestBudget);
    assert.equal(result.cleanup, "token-expiry");
    assert.doesNotMatch(
      JSON.stringify(result),
      /demo-secret|demo-access-token/,
    );
    if (scenario.id === "secret-resource")
      assert.deepEqual(
        result.evidence.map((e) => e.response.status),
        [401, 200, 200, 200],
      );
  }
  assert.equal(
    (await runner("secret-token", profile, { clientSecret: "wrong" })).status,
    "BLOCKED",
  );
  assert.equal(
    (await runner("secret-token", profile, { scope: "admin" })).status,
    "BLOCKED",
  );
});

test("standard OIDC discovery and both secret authentication methods work against HTTP target", async (t) => {
  const fixture = await createAttackFixture();
  t.after(() => fixture.close());
  for (const authMethod of ["auto", "client_secret_post"]) {
    const result = await run()("secret-resource", live(fixture.url), {
      clientId: "demo-client",
      clientSecret: DEMO_SECRET,
      scope: "read",
      resourcePath: "/resource",
      authMethod,
    });
    assert.equal(result.status, "SUCCEEDED");
    assert.doesNotMatch(
      JSON.stringify(result),
      /demo-secret|demo-access-token/,
    );
  }
});

test("missing credentials or resource path sends no request and public resource is not attributed to secret", async (t) => {
  let calls = 0;
  const base = await target(t, (req, res) => {
    calls++;
    json(res, 200, { public: true });
  });
  assert.equal(
    (await run()("secret-token", live(base), {})).status,
    "INCONCLUSIVE",
  );
  assert.equal(
    (
      await run()("secret-resource", live(base), {
        clientId: "x",
        clientSecret: "private-secret",
      })
    ).status,
    "INCONCLUSIVE",
  );
  assert.equal(calls, 0);
  const result = await run()("secret-resource", live(base), {
    clientId: "x",
    clientSecret: "private-secret",
    resourcePath: "/public",
  });
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(calls, 1);
  assert.match(result.observations[0], /未附憑證/);
});

test("discovery cannot forward credentials to another origin and redirects are never followed", async (t) => {
  let outside = 0;
  const foreign = await target(t, (req, res) => {
    outside++;
    json(res, 200, {});
  });
  let calls = 0;
  const base = await target(t, (req, res, origin) => {
    calls++;
    if (req.url.startsWith("/.well-known"))
      json(res, 200, { issuer: origin, token_endpoint: foreign + "/token" });
    else json(res, 302, {}, { Location: foreign + "/token" });
  });
  const settings = { clientId: "x", clientSecret: "never-forward-me" };
  assert.equal(
    (await run()("secret-token", live(base), settings)).status,
    "ERROR",
  );
  assert.equal(calls, 1);
  assert.equal(outside, 0);
  const redirected = await run()("secret-token", live(base), {
    ...settings,
    tokenPath: "/token",
  });
  assert.equal(redirected.status, "INCONCLUSIVE");
  assert.equal(outside, 0);
});

test("evidence omits reflected secrets, issued tokens, arbitrary response fields and headers", async (t) => {
  const secret = "sensitive:secret/value";
  const base = await target(t, async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = new URLSearchParams(raw);
    assert.equal(body.get("client_secret"), secret);
    json(
      res,
      200,
      {
        access_token: "issued-private-token",
        id_token: "private-id-token",
        refresh_token: "private-refresh-token",
        token_type: "Bearer",
        scope: secret,
        echo: raw,
        nested: { secret },
      },
      {
        "Set-Cookie": "private-cookie=" + encodeURIComponent(secret),
        "X-Reflection": secret,
      },
    );
  });
  const result = await run()("secret-token", live(base), {
    clientId: "client",
    clientSecret: secret,
    authMethod: "client_secret_post",
    tokenPath: "/token",
  });
  assert.equal(result.status, "SUCCEEDED");
  const serialized = JSON.stringify(result);
  for (const value of [
    secret,
    encodeURIComponent(secret),
    "issued-private-token",
    "private-id-token",
    "private-refresh-token",
    "private-cookie",
  ])
    assert.ok(!serialized.includes(value));
  assert.equal(result.evidence[0].response.body.scope, "[REDACTED]");
  assert.equal(result.evidence[0].response.body.idTokenPresent, true);
});

test("OAuth rejections, malformed success and unavailable resources have distinct outcomes", async (t) => {
  let outcome = "reject";
  const base = await target(t, (req, res) => {
    if (outcome === "reject")
      json(res, 400, { error: "unsupported_grant_type" });
    else if (outcome === "malformed")
      json(res, 200, { message: "not a token" });
    else if (outcome === "oversized")
      json(res, 200, { data: "x".repeat(66000) });
    else json(res, 503, { error: "service_down" });
  });
  const settings = {
    clientId: "x",
    clientSecret: "a-secret",
    tokenPath: "/token",
    resourcePath: "/resource",
  };
  assert.equal(
    (await run()("secret-token", live(base), settings)).status,
    "BLOCKED",
  );
  outcome = "malformed";
  assert.equal(
    (await run()("secret-token", live(base), settings)).status,
    "INCONCLUSIVE",
  );
  outcome = "oversized";
  assert.equal(
    (await run()("secret-token", live(base), settings)).status,
    "ERROR",
  );
  outcome = "down";
  const result = await run()("secret-resource", live(base), settings);
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.evidence.length, 1);
});

test("attack runner observes cancellation and target cooldown", async (t) => {
  let calls = 0;
  const base = await target(t, (req, res) => {
    calls++;
    json(res, 429, { error: "slow_down" }, { "Retry-After": "60" });
  });
  const runner = run();
  const settings = {
    clientId: "x",
    clientSecret: "secret",
    tokenPath: "/token",
  };
  const first = await runner("secret-token", live(base), settings);
  assert.equal(first.status, "INCONCLUSIVE");
  assert.equal(first.rateLimited, true);
  const second = await runner("secret-token", live(base), settings);
  assert.equal(second.rateLimited, true);
  assert.equal(calls, 1);
  const cancelled = await runner("secret-token", live(base), settings, {
    signal: AbortSignal.abort(),
  });
  assert.equal(cancelled.status, "ERROR");
  assert.equal(calls, 1);
});

test("attack settings reject URLs, control characters and unexpected data", () => {
  for (const input of [
    { resourcePath: "https://example.test" },
    { tokenPath: "//example.test/token" },
    { tokenPath: "/token?secret=x" },
    { resourcePath: "/\\evil" },
    { clientSecret: "x\ny" },
    { authMethod: "none" },
    { unknown: "x" },
  ])
    assert.throws(() => validateAttackInput(input));
});

test("API separates catalogs, rejects mode confusion and never persists credentials", async (t) => {
  const work = await mkdtemp(join(tmpdir(), "oauth-attack-test-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const file = join(work, "environments.json");
  const server = dashboardServer({ environmentsFile: file, httpInterval: 0 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const defense = await (await fetch(base + "/api/catalog")).json();
  assert.equal(defense.catalog.length, 23);
  const attack = await (
    await fetch(base + "/api/catalog?testingMode=attack")
  ).json();
  assert.equal(attack.catalog.length, 2);
  const created = await post("/api/environments", {
    name: "demo",
    type: "simulation",
  });
  assert.equal(created.status, 201);
  const result = await post("/api/run", {
    id: "secret-token",
    testingMode: "attack",
    attack: { clientSecret: DEMO_SECRET },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "SUCCEEDED");
  assert.equal((await post("/api/run", { id: "secret-token" })).status, 400);
  assert.equal(
    (await post("/api/run", { id: "rotation", testingMode: "attack" })).status,
    400,
  );
  assert.equal(
    (
      await post("/api/run", {
        id: "rotation",
        attack: { clientSecret: DEMO_SECRET },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("/api/run", {
        id: "secret-token",
        testingMode: "attack",
        attack: { rawUrl: "https://example.test" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await post("/api/run", { id: "secret-token", testingMode: "__proto__" }))
      .status,
    400,
  );
  assert.equal(
    (
      await post("/api/environments", {
        name: "bad",
        type: "simulation",
        clientSecret: DEMO_SECRET,
      })
    ).status,
    400,
  );
  const fixture = await createAttackFixture();
  t.after(() => fixture.close());
  const httpProfile = await post("/api/environments", {
    name: "OIDC target",
    type: "http",
    baseUrl: fixture.url,
    clientId: "demo-client",
  });
  const httpResult = await post("/api/run", {
    id: "secret-resource",
    testingMode: "attack",
    environmentId: httpProfile.body.id,
    environmentRevision: httpProfile.body.revision,
    attack: { clientSecret: DEMO_SECRET, resourcePath: "/resource" },
  });
  assert.equal(httpResult.status, 200);
  assert.equal(httpResult.body.status, "SUCCEEDED");
  assert.equal(httpResult.body.environment, "CUSTOM_HTTP");
  for (const testingMode of [["attack"], null, {}])
    assert.equal(
      (await post("/api/run", { id: "secret-token", testingMode })).status,
      400,
    );
  assert.doesNotMatch(await readFile(file, "utf8"), /demo-secret|clientSecret/);
});

test("discovery without supported secret auth sends no secret and cancellation stops paced token request", async (t) => {
  let calls = 0;
  let rejectAuth = true;
  const controller = new AbortController();
  const base = await target(t, (req, res, origin) => {
    calls++;
    json(res, 200, {
      issuer: origin,
      token_endpoint: origin + "/token",
      token_endpoint_auth_methods_supported: rejectAuth
        ? ["private_key_jwt"]
        : ["client_secret_basic"],
    });
    if (!rejectAuth) setTimeout(() => controller.abort(), 20);
  });
  const settings = { clientId: "x", clientSecret: "test-private-secret" };
  const unsupported = await run()("secret-token", live(base), settings);
  assert.equal(unsupported.status, "INCONCLUSIVE");
  assert.equal(calls, 1);
  rejectAuth = false;
  const cancelled = await createAttackRunner({ minimumInterval: 200 })(
    "secret-token",
    live(base),
    settings,
    { signal: controller.signal },
  );
  assert.equal(cancelled.status, "ERROR");
  assert.equal(calls, 2);
});
