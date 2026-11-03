import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let checked = 0;
async function check(directory) {
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (/\.(mjs|js)$/.test(entry.name)) {
      execFileSync(process.execPath, ["--check", join(root, path)], {
        stdio: "inherit",
      });
      checked++;
    }
  }
}
for (const directory of ["src", "public", "scripts", "test"])
  await check(directory);
console.log(`Syntax checked ${checked} JavaScript modules`);
