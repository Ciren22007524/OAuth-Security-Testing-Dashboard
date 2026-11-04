import { build } from "esbuild";
import { inject } from "postject";
import { mkdir, readFile, writeFile, copyFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeWindowsSignature } from "./lib/pe-signature.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const platform = process.argv.includes("--windows")
  ? "win32"
  : process.platform;
if (!["win32", "linux"].includes(platform) || process.arch !== "x64")
  throw new Error("This build supports Windows/Linux x64");
const directory = join(root, "dist");
await mkdir(directory, { recursive: true });
const bundle = join(directory, "desktop.cjs");
await build({
  entryPoints: [join(root, "src/desktop-entry.js")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  legalComments: "none",
});
const executable = join(
  directory,
  platform === "win32"
    ? "OAuthSecurityLab-windows-x64.exe"
    : "OAuthSecurityLab-linux-x64",
);
if (platform === process.platform) await copyFile(process.execPath, executable);
else {
  const release = `https://nodejs.org/dist/${process.version}`;
  const artifact = "win-x64/node.exe";
  const sums = await fetch(release + "/SHASUMS256.txt");
  if (!sums.ok) throw new Error("Unable to read official checksums");
  const line = (await sums.text())
    .split("\n")
    .find((line) => line.trim().endsWith("  " + artifact));
  if (!line) throw new Error("Official artifact checksum missing");
  const expected = line.split(/\s+/)[0];
  const response = await fetch(release + "/" + artifact);
  if (!response.ok) throw new Error("Unable to download official Node runtime");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error("Official Node checksum mismatch");
  await writeFile(executable, bytes);
}
if (platform === "win32")
  await writeFile(
    executable,
    removeWindowsSignature(await readFile(executable)),
  );
const licenseResponse = await fetch(
  `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
);
if (!licenseResponse.ok)
  throw new Error("Unable to read official Node license");
const nodeLicense = join(directory, "NODE-LICENSE.txt");
await writeFile(nodeLicense, await licenseResponse.text());
await copyFile(join(root, "LICENSE"), join(directory, "APP-LICENSE.txt"));
const config = {
  main: bundle,
  output: join(directory, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgv: ["--use-env-proxy"],
  execArgvExtension: "none",
  assets: Object.fromEntries(
    ["index.html", "app.js", "style.css"].map((file) => [
      `public/${file}`,
      join(root, "public", file),
    ]),
  ),
};
config.assets["licenses/node.txt"] = nodeLicense;
config.assets["licenses/app.txt"] = join(root, "LICENSE");
const configPath = join(directory, "sea-config.json");
await writeFile(configPath, JSON.stringify(config, null, 2));
execFileSync(process.execPath, ["--experimental-sea-config", configPath], {
  cwd: root,
  stdio: "inherit",
});
await inject(executable, "NODE_SEA_BLOB", await readFile(config.output), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});
if (platform !== "win32") await chmod(executable, 0o755);
const digest = createHash("sha256")
  .update(await readFile(executable))
  .digest("hex");
await writeFile(
  executable + ".sha256",
  `${digest}  ${executable.split(/[\\/]/).at(-1)}\n`,
);
console.log(`Built ${resolve(executable)}\nSHA-256 ${digest}`);
