import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEnvironmentStore,
  validateEnvironment,
} from "../src/environments.js";
import { dashboardServer } from "../src/server.js";
import { createFixture, CLIENT, ORIGIN, REDIRECT } from "../src/fixture.js";
import { createHttpRunner } from "../src/http-runner.js";
import { createServer } from "node:http";

test("custom environment count is bounded without losing saved profiles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oauth-profile-limit-"));
  const store = createEnvironmentStore(join(directory, "environments.json"));
  try {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        store.create({ name: `Profile ${index}`, type: "simulation" }),
      ),
    );
    await assert.rejects(
      store.create({ name: "Over limit", type: "simulation" }),
      /environment_limit/,
    );
    assert.equal((await store.list()).length, 101);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("profiles persist across restarts with revisions and isolated deletion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oauth-profiles-"));
  const file = join(directory, "environments.json");
  try {
    const store = createEnvironmentStore(file);
    const [one, two] = await Promise.all([
      store.create({
        name: "Local worker",
        type: "http",
        baseUrl: "http://localhost:8787/",
      }),
      store.create({ name: "QA simulation", type: "simulation" }),
    ]);
    assert.equal(one.baseUrl, "http://localhost:8787");
    assert.equal((await createEnvironmentStore(file).list()).length, 3);
    const changed = await store.update(one.id, one.revision, {
      name: "Updated",
      type: "http",
      baseUrl: "https://qa.example.test",
    });
    assert.equal(changed.revision, 2);
    await assert.rejects(
      store.update(one.id, 1, { name: "Stale", type: "simulation" }),
      /environment_changed/,
    );
    await assert.rejects(
      store.remove("local", 1),
      /builtin_environment_readonly/,
    );
    await assert.rejects(store.remove(two.id, 99), /environment_changed/);
    await store.remove(two.id, 1);
    assert.equal((await store.list()).length, 2);
    assert.equal((await store.get(one.id)).name, "Updated");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(file, "utf8")).schemaVersion, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid target configuration and secret fields are rejected", () => {
  for (const baseUrl of [
    "file:///etc/passwd",
    "https://user:private@example.test",
    "https://example.test/path",
    "https://example.test?token=private",
    "http://169.254.169.254",
    "http://metadata.google.internal",
    "http://[::]",
  ])
    assert.throws(() =>
      validateEnvironment({ name: "invalid", type: "http", baseUrl }),
    );
  assert.throws(() =>
    validateEnvironment({
      name: "secret",
      type: "http",
      baseUrl: "https://qa.example.test",
      token: "private",
    }),
  );
  assert.throws(() => validateEnvironment({ name: "\n", type: "simulation" }));
  assert.equal(
    validateEnvironment({
      name: "IPv6 local",
      type: "http",
      baseUrl: "http://[::1]:8787",
    }).baseUrl,
    "http://[::1]:8787",
  );
});

test("corrupted stores fail closed and are never overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oauth-bad-profiles-"));
  const file = join(directory, "environments.json");
  try {
    await writeFile(file, "invalid json");
    const store = createEnvironmentStore(file);
    await assert.rejects(store.list(), /environment_store_unavailable/);
    await assert.rejects(
      store.create({ name: "new", type: "simulation" }),
      /environment_store_unavailable/,
    );
    assert.equal(await readFile(file, "utf8"), "invalid json");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP runner probes the saved target with measured results and redaction", async () => {
  const fixture = await createFixture();
  const run = createHttpRunner({ minimumInterval: 0 });
  const profile = {
    id: "test",
    name: "Local service",
    type: "http",
    revision: 1,
    baseUrl: fixture.url,
    clientId: CLIENT,
    origin: ORIGIN,
    redirectUri: REDIRECT,
  };
  try {
    for (const id of [
      "health",
      "jwks",
      "client-invalid",
      "redirect-exact",
      "state-bounds",
      "token-client",
      "token-origin",
      "token-session",
      "security-headers",
    ]) {
      const result = await run(id, profile);
      assert.equal(result.status, "PASS", id);
      assert.equal(result.environment, "CUSTOM_HTTP");
      assert.equal(result.target, fixture.url);
      assert.ok(
        result.evidence.length > 0 &&
          result.evidence.length <= result.requestBudget,
      );
      assert.ok(
        result.evidence.every((record) =>
          record.request.url.startsWith(fixture.url),
        ),
      );
      assert.ok(!JSON.stringify(result).includes("fixture-key-secret"));
    }
    const missing = await run("token-session", { ...profile, clientId: "" });
    assert.equal(missing.status, "INCONCLUSIVE");
    assert.equal(missing.evidence.length, 0);
    const unregistered = await run("state-bounds", {
      ...profile,
      clientId: "not-registered",
    });
    assert.equal(unregistered.status, "INCONCLUSIVE");
    assert.equal(unregistered.evidence.length, 1);
    const badOrigin = await run("token-session", {
      ...profile,
      origin: "https://wrong.test",
    });
    assert.equal(badOrigin.status, "INCONCLUSIVE");
    const mismatch = await run("discovery", profile);
    assert.equal(mismatch.status, "FAIL");
  } finally {
    await fixture.close();
  }
});

test("API CRUD, stale selection and persisted HTTP execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oauth-api-profiles-"));
  const fixture = await createFixture();
  const server = dashboardServer({
    environmentsFile: join(directory, "environments.json"),
    httpInterval: 0,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, method, body, origin = base) =>
    fetch(base + path, {
      method,
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const denied = await send(
      "/api/environments",
      "POST",
      { name: "foreign", type: "simulation" },
      "https://evil.test",
    );
    assert.equal(denied.status, 403);
    await denied.text();
    const created = await send("/api/environments", "POST", {
      name: "My local target",
      type: "http",
      baseUrl: fixture.url,
    });
    assert.equal(created.status, 201);
    const profile = await created.json();
    const catalog = await (
      await fetch(base + `/api/catalog?environmentId=${profile.id}`)
    ).json();
    assert.equal(catalog.environment, "CUSTOM_HTTP");
    assert.ok(catalog.catalog.some((s) => s.id === "health"));
    assert.ok(!catalog.catalog.some((s) => s.id === "logout-all"));
    const stale = await send("/api/run", "POST", {
      id: "health",
      environmentId: profile.id,
      environmentRevision: 999,
    });
    assert.equal(stale.status, 409);
    await stale.text();
    const run = await send("/api/run", "POST", {
      id: "health",
      environmentId: profile.id,
      environmentRevision: 1,
    });
    const result = await run.json();
    assert.equal(result.status, "PASS");
    assert.equal(result.environmentName, profile.name);
    const changed = await send("/api/environments/" + profile.id, "PUT", {
      name: "Renamed target",
      type: "http",
      baseUrl: fixture.url,
      revision: 1,
    });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).revision, 2);
    const removed = await send("/api/environments/" + profile.id, "DELETE", {
      revision: 2,
    });
    assert.equal(removed.status, 200);
    await removed.text();
    const list = await (await fetch(base + "/api/environments")).json();
    assert.equal(list.environments.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP runner never follows redirects and treats throttling as inconclusive", async () => {
  let received = 0;
  const server = createServer((req, res) => {
    received++;
    if (received === 1) {
      res.writeHead(302, {
        Location: "/must-not-follow",
        "Content-Type": "text/plain",
      });
      res.end("private unstructured content");
    } else {
      res.writeHead(429, {
        "Retry-After": "60",
        "Content-Type": "application/json",
      });
      res.end('{"error":"rate_limited"}');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const profile = {
    id: "http",
    name: "bounded",
    revision: 1,
    type: "http",
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
  try {
    const run = createHttpRunner({ minimumInterval: 0 });
    const redirect = await run("health", profile);
    assert.equal(redirect.status, "FAIL");
    assert.equal(received, 1);
    assert.ok(
      !JSON.stringify(redirect).includes("private unstructured content"),
    );
    const limited = await run("health", profile);
    assert.equal(limited.status, "INCONCLUSIVE");
    assert.equal(limited.evidence[0].response.status, 429);
    const cooling = await run("health", profile);
    assert.equal(cooling.status, "INCONCLUSIVE");
    assert.equal(cooling.evidence.length, 0);
    assert.equal(received, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("cancelling during HTTP pacing prevents another target request", async () => {
  const fixture = await createFixture();
  const run = createHttpRunner({ minimumInterval: 200 });
  const profile = {
    id: "http",
    name: "bounded",
    revision: 1,
    type: "http",
    baseUrl: fixture.url,
  };
  try {
    assert.equal((await run("health", profile)).status, "PASS");
    const controller = new AbortController();
    const pending = run("health", profile, { signal: controller.signal });
    controller.abort();
    const result = await pending;
    assert.equal(result.status, "ERROR");
    assert.equal(result.evidence.length, 0);
    assert.match(result.error, /cancelled/);
  } finally {
    await fixture.close();
  }
});

test("oversized target responses are bounded and never recorded", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: "x".repeat(70 * 1024) }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await createHttpRunner({ minimumInterval: 0 })("health", {
      id: "http",
      name: "oversized",
      revision: 1,
      type: "http",
      baseUrl: `http://127.0.0.1:${server.address().port}`,
    });
    assert.equal(result.status, "ERROR");
    assert.equal(result.evidence.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("environment mutations cannot race an active target request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oauth-profile-busy-"));
  let complete;
  let observed;
  const received = new Promise((resolve) => {
    observed = resolve;
  });
  const target = createServer((_req, res) => {
    complete = () => {
      if (res.writableEnded) return;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    };
    observed();
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const server = dashboardServer({
    environmentsFile: join(directory, "environments.json"),
    httpInterval: 0,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, method, body) =>
    fetch(base + path, {
      method,
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const profile = await (
      await send("/api/environments", "POST", {
        name: "original",
        type: "http",
        baseUrl: `http://127.0.0.1:${target.address().port}`,
      })
    ).json();
    const running = send("/api/run", "POST", {
      id: "health",
      environmentId: profile.id,
      environmentRevision: 1,
    });
    await received;
    const mutation = await send("/api/environments/" + profile.id, "PUT", {
      name: "changed",
      type: "simulation",
      revision: 1,
    });
    assert.equal(mutation.status, 429);
    await mutation.text();
    complete();
    const result = await (await running).json();
    assert.equal(result.status, "PASS");
    assert.equal(result.environmentName, "original");
  } finally {
    complete?.();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => target.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
