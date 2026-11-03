import test from "node:test";
import assert from "node:assert/strict";
import {
  catalog,
  runScenario,
  redact,
  makeReport,
  markdownReport,
} from "../src/runner.js";
import { createFixture, CLIENT, REDIRECT } from "../src/fixture.js";

for (const scenario of catalog) {
  test(`scenario: ${scenario.id}`, async () => {
    const result = await runScenario(scenario.id);
    assert.equal(
      result.status,
      scenario.id === "browser-cors" ? "INCONCLUSIVE" : "PASS",
    );
    assert.equal(result.cleanup, "complete");
    assert.ok(result.evidence.length <= scenario.requestBudget);
    if (result.status === "PASS") assert.ok(result.assertions.length > 0);
    assert.ok(result.assertions.every((a) => a.passed));
    const serialized = JSON.stringify(result);
    assert.ok(!/__Host-rt=[a-f0-9-]{36}/.test(serialized));
    assert.ok(!/fixture-[a-f0-9-]{36}/.test(serialized));
  });
}

test("intentionally vulnerable redirect fixture produces FAIL with evidence", async () => {
  const result = await runScenario("redirect-exact", { vulnerable: true });
  assert.equal(result.status, "FAIL");
  assert.equal(result.assertions.filter((a) => !a.passed).length, 4);
  assert.equal(result.evidence[0].response.status, 302);
});

// Each mutation disables exactly one fixture control, independently of assertions.
for (const [scenario, fault] of [
  ["client-invalid", "authorize-client"],
  ["state-bounds", "state-bounds"],
  ["callback-state", "callback-cookie"],
  ["callback-replay", "callback-replay"],
  ["token-client", "token-client"],
  ["token-origin", "token-origin"],
  ["token-session", "token-session"],
  ["rotation", "duplicate-rotation-cookie"],
  ["reuse-grace", "reject-grace"],
  ["reuse-revoke", "reuse-revoke"],
  ["logout-session", "logout-revoke"],
  ["logout-all", "logout-all"],
  ["logout-origin", "logout-origin"],
  ["logout-client", "logout-client"],
  ["jwks", "jwks-private"],
  ["discovery", "discovery"],
  ["rate-limit", "rate-limit"],
  ["malformed-json", "error-leak"],
  ["security-headers", "sensitive-cache"],
]) {
  test(`control regression is detected: ${scenario}`, async () => {
    const result = await runScenario(scenario, { fault });
    assert.equal(result.status, "FAIL");
    assert.ok(result.assertions.some((a) => !a.passed));
    assert.ok(result.evidence.length > 0);
    assert.equal(result.cleanup, "complete");
  });
}

test("callback transaction expires using injected clock", async () => {
  const fixture = await createFixture();
  try {
    const query = new URLSearchParams({
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      state: "expires",
    });
    const authorize = await fetch(`${fixture.url}/authorize?${query}`, {
      redirect: "manual",
    });
    assert.equal(authorize.status, 302);
    const state = new URL(
      authorize.headers.get("location"),
      fixture.url,
    ).searchParams.get("state");
    await authorize.text();
    fixture.advance(600_001);
    const callback = await fetch(
      `${fixture.url}/callback/google?state=${state}`,
      {
        headers: { Cookie: `__Host-oauth_state=${state}` },
        redirect: "manual",
      },
    );
    assert.equal(callback.status, 302);
    assert.equal(
      new URL(callback.headers.get("location")).searchParams.get("error"),
      "login_expired",
    );
    assert.equal(callback.headers.get("set-cookie"), null);
    assert.deepEqual(await callback.json(), { error: "login_expired" });
  } finally {
    await fixture.close();
  }
});

test("nested sensitive data is redacted in reports", () => {
  const value = redact({
    headers: { Cookie: "private", Authorization: "Bearer private" },
    response: {
      access_token: "private",
      email: "private",
      sub: "private",
      ok: true,
    },
    path: "/callback?state=private&code=private&access_token=private&refresh_token=private",
    jwk: { d: "private", k: "private", x: "public" },
    nested: {
      accessToken: "private",
      jwt: "private",
      note: "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJl",
    },
  });
  assert.ok(!JSON.stringify(value).includes("private"));
  assert.equal(value.response.ok, true);
  assert.equal(value.jwk.x, "public");
  assert.equal(value.nested.note, "[REDACTED]");
  const report = makeReport([
    {
      title: "example",
      status: "PASS",
      expected: "test",
      assertions: [],
      evidence: [{ refresh_token: "private" }],
    },
  ]);
  assert.ok(!JSON.stringify(report).includes("private"));
  assert.ok(!markdownReport(report).includes("private"));
  assert.match(markdownReport(report), /SIMULATION/);
});

test("cancelled runs report ERROR without manufacturing a pass", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runScenario("rotation", { signal: controller.signal });
  assert.equal(result.status, "ERROR");
  assert.equal(result.evidence.length, 0);
  assert.equal(result.cleanup, "complete");
});

test("unknown scenarios are rejected", async () => {
  await assert.rejects(runScenario("unknown"), /Unknown scenario/);
});
