import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export class EnvironmentError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.status = status;
  }
}
export const LOCAL_ENVIRONMENT = Object.freeze({
  id: "local",
  name: "本地模擬",
  type: "simulation",
  revision: 1,
  builtin: true,
});
const fields = ["name", "type", "baseUrl", "clientId", "origin", "redirectUri"];
function text(value, max) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new EnvironmentError("invalid_environment");
  return value.trim();
}
function address(value, originOnly = false) {
  let url;
  try {
    url = new URL(text(value, 2048));
  } catch {
    throw new EnvironmentError("invalid_url");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (originOnly && url.pathname !== "/")
  )
    throw new EnvironmentError("invalid_url");
  // Private staging networks and loopback are supported; metadata endpoints are not.
  const host = url.hostname.toLowerCase();
  if (
    /^(?:169\.254\.|0\.|metadata\.google\.internal$|\[?(?:fe80:|::\]|fd00:ec2:))/.test(
      host,
    )
  )
    throw new EnvironmentError("unsupported_target");
  return originOnly ? url.origin : url.href;
}
export function validateEnvironment(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new EnvironmentError("invalid_environment");
  const name = text(input.name, 80);
  if (!name || !["simulation", "http"].includes(input.type))
    throw new EnvironmentError("invalid_environment");
  if (input.type === "simulation") return { name, type: "simulation" };
  const result = { name, type: "http", baseUrl: address(input.baseUrl, true) };
  if (input.clientId) result.clientId = text(input.clientId, 200);
  if (input.origin) result.origin = address(input.origin, true);
  if (input.redirectUri) result.redirectUri = address(input.redirectUri);
  return result;
}

export function createEnvironmentStore(filePath) {
  let queue = Promise.resolve();
  async function read() {
    try {
      const file = await readFile(filePath, "utf8");
      if (Buffer.byteLength(file) > 1024 * 1024)
        throw new Error("Store too large");
      const data = JSON.parse(file);
      if (
        data.schemaVersion !== 1 ||
        !Array.isArray(data.environments) ||
        data.environments.length > 100
      )
        throw new Error("Invalid store");
      const ids = new Set();
      const validated = [];
      for (const environment of data.environments) {
        if (
          !environment ||
          Object.keys(environment).some(
            (key) => ![...fields, "id", "revision"].includes(key),
          )
        )
          throw new Error("Unexpected stored field");
        if (
          !/^[a-f0-9-]{36}$/.test(environment.id) ||
          ids.has(environment.id) ||
          !Number.isSafeInteger(environment.revision) ||
          environment.revision < 1
        )
          throw new Error("Invalid profile");
        ids.add(environment.id);
        const settings = validateEnvironment(
          Object.fromEntries(
            fields
              .filter((field) => field in environment)
              .map((field) => [field, environment[field]]),
          ),
        );
        validated.push({
          ...settings,
          id: environment.id,
          revision: environment.revision,
        });
      }
      return validated;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new EnvironmentError("environment_store_unavailable", 503);
    }
  }
  const list = async () => [LOCAL_ENVIRONMENT, ...(await read())];
  async function get(id) {
    const environment = (await list()).find((item) => item.id === id);
    if (!environment) throw new EnvironmentError("environment_not_found", 404);
    return environment;
  }
  function mutate(operation) {
    const work = queue.then(async () => {
      const environments = await read();
      const result = operation(environments);
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(
          temporary,
          JSON.stringify({ schemaVersion: 1, environments }, null, 2) + "\n",
          { flag: "wx", mode: 0o600 },
        );
        await rename(temporary, filePath);
      } finally {
        await rm(temporary, { force: true });
      }
      return result;
    });
    queue = work.catch(() => {});
    return work;
  }
  function editable(environments, id, revision) {
    if (id === LOCAL_ENVIRONMENT.id)
      throw new EnvironmentError("builtin_environment_readonly", 409);
    const index = environments.findIndex((item) => item.id === id);
    if (index < 0) throw new EnvironmentError("environment_not_found", 404);
    if (environments[index].revision !== revision)
      throw new EnvironmentError("environment_changed", 409);
    return index;
  }
  return {
    list,
    get,
    create: (input) =>
      mutate((environments) => {
        if (environments.length >= 100)
          throw new EnvironmentError("environment_limit", 409);
        const environment = {
          ...validateEnvironment(input),
          id: randomUUID(),
          revision: 1,
        };
        environments.push(environment);
        return environment;
      }),
    update: (id, revision, input) =>
      mutate((environments) => {
        const index = editable(environments, id, revision);
        const environment = {
          ...validateEnvironment(input),
          id,
          revision: revision + 1,
        };
        environments[index] = environment;
        return environment;
      }),
    remove: (id, revision) =>
      mutate((environments) => {
        environments.splice(editable(environments, id, revision), 1);
        return { deleted: true };
      }),
  };
}
