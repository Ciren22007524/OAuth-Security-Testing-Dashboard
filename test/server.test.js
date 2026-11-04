import test from "node:test";
import assert from "node:assert/strict";
import { dashboardServer } from "../src/server.js";
import { catalog as scenarios } from "../src/runner.js";

test("dashboard serves assets and runs only same-origin simulation requests", async () => {
  const server = dashboardServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ["/", "/index.html", "/app.js", "/style.css"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-security-policy"),
        /frame-ancestors 'none'/,
      );
      assert.ok((await response.text()).length > 100);
    }
    const catalog = await (await fetch(base + "/api/catalog")).json();
    assert.equal(catalog.environment, "SIMULATION");
    assert.equal(catalog.catalog.length, scenarios.length);
    const request = (body, origin = base) =>
      fetch(base + "/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
    const foreign = await request({ id: "rotation" }, "https://evil.test");
    assert.equal(foreign.status, 403);
    await foreign.text();
    const live = await request({
      id: "rotation",
      target: "https://auth.cirenjhong.com",
    });
    assert.equal(live.status, 400);
    await live.text();
    const unknown = await request({ id: "unknown" });
    assert.equal(unknown.status, 400);
    await unknown.text();
    const fault = await request({ id: "token-origin", fault: "token-origin" });
    assert.equal(fault.status, 400);
    await fault.text();
    const run = await request({ id: "rotation" });
    assert.equal(run.status, 200);
    const result = await run.json();
    assert.equal(result.status, "PASS");
    assert.equal(result.environment, "SIMULATION");
    assert.equal(result.evidence.length, 3);
    const missing = await fetch(base + "/does-not-exist");
    assert.equal(missing.status, 404);
    await missing.text();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
