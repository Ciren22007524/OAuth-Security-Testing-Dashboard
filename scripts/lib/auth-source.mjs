import { registerHooks } from "node:module";
import { realpath, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export async function loadAuthSource() {
  if (!process.env.AUTH_SERVICE_PATH)
    throw new Error(
      "Set AUTH_SERVICE_PATH to an installed local auth-service checkout",
    );
  const root = await realpath(process.env.AUTH_SERVICE_PATH);
  await access(join(root, "src/test-helpers.ts"));
  const prefix = pathToFileURL(root + "/").href;
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (error) {
        if (specifier.startsWith(".") && context.parentURL?.startsWith(prefix))
          return next(specifier + ".ts", context);
        throw error;
      }
    },
  });
  const helpers = await import(
    pathToFileURL(join(root, "src/test-helpers.ts")).href
  );
  const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return { ...helpers, revision };
}
