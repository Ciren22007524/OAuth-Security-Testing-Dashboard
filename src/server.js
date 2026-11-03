import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { catalog, runScenario } from "./runner.js";
import { createEnvironmentStore, EnvironmentError } from "./environments.js";
import { createHttpRunner, httpCatalog } from "./http-runner.js";

export function dashboardServer({
  environmentsFile = process.env.DASHBOARD_ENVIRONMENTS_FILE ||
    fileURLToPath(new URL("../.local/environments.json", import.meta.url)),
  httpInterval = 500,
} = {}) {
  let active = false;
  const environments = createEnvironmentStore(environmentsFile);
  const runHttp = createHttpRunner({ minimumInterval: httpInterval });
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
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      if (req.method === "GET" && path === "/api/environments")
        return json(200, { environments: await environments.list() });
      if (req.method === "GET" && path === "/api/catalog") {
        const profile = await environments.get(
          url.searchParams.get("environmentId") || "local",
        );
        return json(200, {
          environment:
            profile.type === "simulation" ? "SIMULATION" : "CUSTOM_HTTP",
          profile,
          catalog: profile.type === "simulation" ? catalog : httpCatalog,
        });
      }
      if (req.method === "GET" && path === "/api/health")
        return json(200, { ok: true, environment: "SIMULATION" });
      const profileMatch = /^\/api\/environments(?:\/([a-z0-9-]+))?$/.exec(
        path,
      );
      if (
        (profileMatch && ["POST", "PUT", "DELETE"].includes(req.method)) ||
        (req.method === "POST" && path === "/api/run")
      ) {
        if (
          req.headers.origin !== `http://${host}` ||
          req.headers["content-type"] !== "application/json"
        )
          return json(403, { error: "same_origin_json_required" });
        if (active) return json(429, { error: "runner_busy" });
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 8192)
            return json(413, { error: "body_too_large" });
        }
        let input;
        try {
          input = JSON.parse(raw);
        } catch {
          return json(400, { error: "invalid_json" });
        }
        if (!input || typeof input !== "object" || Array.isArray(input))
          return json(400, { error: "invalid_input" });
        if (active) return json(429, { error: "runner_busy" });
        active = true;
        try {
          if (profileMatch) {
            const environmentId = profileMatch[1];
            if (req.method === "POST" && !environmentId)
              return json(201, await environments.create(input));
            if (req.method === "PUT" && environmentId) {
              const { revision, ...profile } = input;
              return json(
                200,
                await environments.update(environmentId, revision, profile),
              );
            }
            if (
              req.method === "DELETE" &&
              environmentId &&
              Object.keys(input).length === 1
            )
              return json(
                200,
                await environments.remove(environmentId, input.revision),
              );
            return json(400, { error: "invalid_environment_operation" });
          }
          const profile = await environments.get(
            input.environmentId || "local",
          );
          const selectedCatalog =
            profile.type === "simulation" ? catalog : httpCatalog;
          if (
            !selectedCatalog.some((s) => s.id === input.id) ||
            Object.keys(input).some(
              (k) =>
                !["id", "environmentId", "environmentRevision"].includes(k),
            )
          )
            return json(400, { error: "invalid_scenario" });
          if (
            (profile.id !== "local" ||
              input.environmentRevision !== undefined) &&
            input.environmentRevision !== profile.revision
          )
            return json(409, { error: "environment_changed" });
          const controller = new AbortController();
          res.on("close", () => {
            if (!res.writableEnded) controller.abort();
          });
          return json(
            200,
            profile.type === "http"
              ? await runHttp(input.id, profile, { signal: controller.signal })
              : {
                  ...(await runScenario(input.id, {
                    signal: controller.signal,
                  })),
                  environmentId: profile.id,
                  environmentName: profile.name,
                  environmentRevision: profile.revision,
                  configuration: profile,
                },
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
    } catch (error) {
      if (!res.headersSent)
        json(error instanceof EnvironmentError ? error.status : 500, {
          error:
            error instanceof EnvironmentError
              ? error.message
              : "internal_error",
        });
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
      `Dashboard listening on loopback port ${port} (environment profiles enabled)`,
    ),
  );
}
