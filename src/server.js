import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { catalog, runScenario } from "./runner.js";

export function dashboardServer() {
  let active = false;
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      // Bind loopback and reject DNS rebinding; mutations also require same-origin JSON.
      const host = req.headers.host;
      if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host))
        return json(403, { error: "invalid_host" });
      const path = new URL(req.url, `http://${host}`).pathname;
      if (req.method === "GET" && path === "/api/catalog")
        return json(200, { environment: "SIMULATION", catalog });
      if (req.method === "GET" && path === "/api/health")
        return json(200, { ok: true, environment: "SIMULATION" });
      if (req.method === "POST" && path === "/api/run") {
        if (
          req.headers.origin !== `http://${host}` ||
          req.headers["content-type"] !== "application/json"
        )
          return json(403, { error: "same_origin_json_required" });
        if (active) return json(429, { error: "runner_busy" });
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 1024) return json(413, { error: "body_too_large" });
        }
        let input;
        try {
          input = JSON.parse(raw);
        } catch {
          return json(400, { error: "invalid_json" });
        }
        if (
          !catalog.some((s) => s.id === input?.id) ||
          Object.keys(input).some((k) => k !== "id")
        )
          return json(400, { error: "invalid_scenario" });
        // Another request may finish reading its body while this one awaits data.
        if (active) return json(429, { error: "runner_busy" });
        active = true;
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        try {
          return json(
            200,
            await runScenario(input.id, { signal: controller.signal }),
          );
        } finally {
          active = false;
        }
      }
      const assets = {
        "/": ["index.html", "text/html; charset=utf-8"],
        "/app.js": ["app.js", "text/javascript; charset=utf-8"],
        "/style.css": ["style.css", "text/css; charset=utf-8"],
      };
      if (req.method !== "GET" || !assets[path])
        return json(404, { error: "not_found" });
      const [file, type] = assets[path];
      const content = await readFile(
        new URL(`../public/${file}`, import.meta.url),
      );
      res.writeHead(200, { "Content-Type": type });
      res.end(content);
    } catch {
      if (!res.headersSent) json(500, { error: "internal_error" });
      else res.end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  dashboardServer().listen(port, "127.0.0.1", () =>
    console.log(
      `Dashboard listening on loopback port ${port} (SIMULATION only)`,
    ),
  );
}
