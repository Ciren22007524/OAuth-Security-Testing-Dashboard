import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadAuthSource } from "./lib/auth-source.mjs";
import { openBrowser } from "./lib/browser.mjs";

const { createTestService, revision, REDIRECT_URI } = await loadAuthSource();
const servers = [];
let browser;
const assertions = [];
const observations = [];
const started = performance.now();
const check = (name, condition) =>
  assertions.push({ name, passed: Boolean(condition) });
async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://localhost:${server.address().port}`;
}
const page = (_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(
    "<!doctype html><title>Isolated CORS test</title><p>LOCAL_SOURCE browser fixture</p>",
  );
};
try {
  const allowed = await listen(page);
  const foreign = await listen(page);
  let service;
  const auth = await listen(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const response = await service.app.fetch(
        new Request(`${auth}${req.url}`, {
          method: req.method,
          headers,
          ...(!["GET", "HEAD"].includes(req.method)
            ? { body: Buffer.concat(chunks) }
            : {}),
        }),
        service.env,
      );
      observations.push({
        method: req.method,
        path: req.url,
        status: response.status,
        cookiePresent: Boolean(req.headers.cookie),
        origin: req.headers.origin,
        allowOrigin: response.headers.get("access-control-allow-origin"),
      });
      res.statusCode = response.status;
      for (const [key, value] of response.headers)
        if (key !== "set-cookie") res.setHeader(key, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("set-cookie", cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  service = await createTestService({
    ISSUER: auth,
    CLIENTS: [{ id: "app", origins: [allowed], redirectUris: [REDIRECT_URI] }],
  });
  // Login uses only the upstream fake provider; no browser visits Google.
  await service.login();
  browser = await openBrowser();
  const seeded = await browser.call("Network.setCookie", {
    name: "__Host-rt",
    value: service.jar.get("__Host-rt"),
    url: auth,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  });
  check(
    "Chromium accepts isolated secure HttpOnly __Host cookie on loopback",
    seeded.success,
  );
  async function navigate(origin) {
    await browser.call("Page.navigate", { url: origin });
    for (let i = 0; i < 100; i++) {
      if (
        await browser.evaluate(
          `location.origin===${JSON.stringify(origin)} && document.readyState==='complete'`,
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Page navigation timed out");
  }
  const fetchToken = `(async()=>{try{const r=await fetch(${JSON.stringify(auth + "/token")},{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:'app'})});const b=await r.json();return {readable:true,status:r.status,hasToken:typeof b.access_token==='string',error:b.error};}catch{return {readable:false};}})()`;
  await navigate(allowed);
  const accepted = await browser.evaluate(fetchToken);
  check(
    "Allowed Origin can read issued access token with browser credentials",
    accepted.readable && accepted.status === 200 && accepted.hasToken,
  );
  check(
    "Allowed preflight permits the registered Origin",
    observations.some(
      (o) =>
        o.method === "OPTIONS" &&
        o.origin === allowed &&
        o.allowOrigin === allowed,
    ),
  );
  check(
    "Browser sends refresh cookie to token endpoint",
    observations.some(
      (o) => o.method === "POST" && o.status === 200 && o.cookiePresent,
    ),
  );
  check(
    "HttpOnly refresh cookie cannot be read by page JavaScript",
    !(await browser.evaluate("document.cookie.includes('__Host-rt')")),
  );
  await navigate(foreign);
  const before = observations.length;
  const blocked = await browser.evaluate(fetchToken);
  check(
    "Foreign Origin JavaScript cannot read token response",
    !blocked.readable,
  );
  const foreignObservations = observations.slice(before);
  check(
    "Foreign preflight has no allow-origin header",
    foreignObservations.some(
      (o) =>
        o.method === "OPTIONS" &&
        o.origin === foreign &&
        o.allowOrigin === null,
    ),
  );
  check(
    "Rejected preflight prevents POST request",
    !foreignObservations.some((o) => o.method === "POST"),
  );
  await navigate(allowed);
  const resumed = await browser.evaluate(fetchToken);
  check(
    "Blocked foreign attempt does not destroy valid browser session",
    resumed.status === 200 && resumed.hasToken,
  );
  service.clock.now += 3601;
  const expired = await browser.evaluate(fetchToken);
  check(
    "Allowed Origin can read login_required after injected expiration",
    expired.readable &&
      expired.status === 401 &&
      expired.error === "login_required" &&
      !expired.hasToken,
  );
} finally {
  await browser?.close();
  for (const server of servers.reverse())
    await new Promise((resolve) => server.close(resolve));
}
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: "LOCAL_SOURCE_BROWSER",
  sourceRevision: revision,
  revision: 1,
  target: `auth-service@${revision}`,
  durationMs: Math.round(performance.now() - started),
  cleanup: "complete",
  status: assertions.every((a) => a.passed) ? "PASS" : "FAIL",
  assertions,
  observations,
  limitations: [
    "Chromium against loopback HTTP bridge, real Hono source with fake Google and memory store.",
    "Loopback Secure-cookie exceptions and same-site localhost ports do not prove production HTTPS or cross-site behavior. No remote D1 or real Google login.",
  ],
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
    status: report.status,
    passed: assertions.filter((a) => a.passed).length,
    failed: assertions.filter((a) => !a.passed),
  }),
);
if (report.status !== "PASS") process.exitCode = 1;
