import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAuthSource } from "./lib/auth-source.mjs";
import { createHttpRunner, httpCatalog } from "../src/http-runner.js";

const { createTestService, revision, APP_ORIGIN, REDIRECT_URI } =
  await loadAuthSource();
let service;
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const response = await service.app.fetch(
      new Request(base + req.url, {
        method: req.method,
        headers,
        ...(!["GET", "HEAD"].includes(req.method)
          ? { body: Buffer.concat(chunks) }
          : {}),
      }),
      service.env,
    );
    res.statusCode = response.status;
    for (const [key, value] of response.headers)
      if (key !== "set-cookie") res.setHeader(key, value);
    if (response.headers.getSetCookie().length)
      res.setHeader("set-cookie", response.headers.getSetCookie());
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  service = await createTestService({ ISSUER: base });
  const profile = {
    id: "source-http-reference",
    name: "Actual auth-service local HTTP",
    type: "http",
    revision: 1,
    baseUrl: base,
    clientId: "app",
    origin: APP_ORIGIN,
    redirectUri: REDIRECT_URI,
  };
  const run = createHttpRunner({ minimumInterval: 10 });
  for (const scenario of httpCatalog)
    results.push(await run(scenario.id, profile));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: "LOCAL_SOURCE_HTTP",
  sourceRevision: revision,
  limitations: [
    "Real Hono routes over an isolated loopback HTTP bridge, fake Google, memory store.",
    "No production or remote D1 validation. Temporary OAuth transactions are discarded with the memory fixture.",
  ],
  results,
};
if (process.env.REPORT_PATH)
  await writeFile(
    resolve(process.env.REPORT_PATH),
    JSON.stringify(report, null, 2) + "\n",
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
  }),
);
if (results.some((r) => r.status !== "PASS")) process.exitCode = 1;
