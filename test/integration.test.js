import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dashboardServer } from "../src/server.js";
import { runIntegration } from "../src/integration-runner.js";

test("integration requires configured local sources, accepts no credentials and refuses HTTP target", async () => {
  const work = await mkdtemp(join(tmpdir(), "integration-unconfigured-"));
  const original = {
    auth: process.env.AUTH_SERVICE_PATH,
    array: process.env.ARRAY_DEMO_PATH,
  };
  process.env.AUTH_SERVICE_PATH = join(work, "auth");
  process.env.ARRAY_DEMO_PATH = join(work, "array");
  const server = dashboardServer({ environmentsFile: join(work, "env.json") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const data = await (
      await fetch(base + "/api/catalog?testingMode=integration")
    ).json();
    assert.equal(data.catalog.length, 2);
    assert.equal(data.integration.ready, false);
    const post = (body) =>
      fetch(base + "/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify(body),
      });
    const response = await post({
      id: "integration-user-a",
      testingMode: "integration",
    });
    const result = await response.json();
    assert.equal(result.status, "INCONCLUSIVE");
    assert.equal(result.evidence.length, 0);
    assert.match(result.error, /setup:integration/);
    for (const extra of [
      { attack: { clientSecret: "should-not-be-used" } },
      { fault: "old-session-still-valid" },
      { sourcePath: "/tmp/arbitrary" },
    ]) {
      const rejected = await post({
        id: "integration-user-a",
        testingMode: "integration",
        ...extra,
      });
      assert.equal(rejected.status, 400);
      await rejected.text();
    }
    await assert.rejects(runIntegration("unknown", { id: "local" }));
    const created = await fetch(base + "/api/environments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({
        name: "HTTP",
        type: "http",
        baseUrl: "http://127.0.0.1:1",
      }),
    });
    const profile = await created.json();
    const unsupported = await (
      await fetch(
        base +
          "/api/catalog?testingMode=integration&environmentId=" +
          profile.id,
      )
    ).json();
    assert.deepEqual(unsupported.catalog, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (original.auth === undefined) delete process.env.AUTH_SERVICE_PATH;
    else process.env.AUTH_SERVICE_PATH = original.auth;
    if (original.array === undefined) delete process.env.ARRAY_DEMO_PATH;
    else process.env.ARRAY_DEMO_PATH = original.array;
    await rm(work, { recursive: true, force: true });
  }
});
