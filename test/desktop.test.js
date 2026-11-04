import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  desktopDataFile,
  browserCommand,
  startDesktop,
} from "../src/desktop.js";
import { removeWindowsSignature } from "../scripts/lib/pe-signature.mjs";

test("portable runtime ignores working directory and chooses a free loopback port", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oauth-desktop-"));
  const options = {
    environmentsFile: join(directory, "environments.json"),
    readAsset: (file) =>
      readFile(new URL("../public/" + file, import.meta.url)),
    openBrowser: false,
  };
  const first = await startDesktop(options);
  const second = await startDesktop({
    ...options,
    environmentsFile: join(directory, "second.json"),
  });
  try {
    assert.notEqual(first.url, second.url);
    assert.equal((await fetch(first.url + "/")).status, 200);
    const profiles = await (
      await fetch(first.url + "/api/environments")
    ).json();
    assert.equal(profiles.environments[0].id, "local");
    assert.equal(first.server.address().address, "127.0.0.1");
  } finally {
    await first.close();
    await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("portable settings use user storage and browser launch uses no shell", () => {
  assert.equal(
    desktopDataFile({
      platform: "win32",
      env: { LOCALAPPDATA: "user-data" },
      home: "home",
    }),
    join("user-data", "OAuthSecurityLab", "environments.json"),
  );
  assert.equal(
    desktopDataFile({ env: { DASHBOARD_ENVIRONMENTS_FILE: "custom.json" } }),
    "custom.json",
  );
  assert.deepEqual(browserCommand("http://127.0.0.1:1234", "win32"), [
    "rundll32.exe",
    ["url.dll,FileProtocolHandler", "http://127.0.0.1:1234"],
  ]);
});
test("modified PE binary is explicitly unsigned without preserving stale certificate metadata", () => {
  const input = Buffer.alloc(1024);
  input.write("MZ");
  input.writeUInt32LE(64, 0x3c);
  input.write("PE\0\0", 64);
  input.writeUInt16LE(0x20b, 88);
  const security = 88 + 112 + 32;
  input.writeUInt32LE(1000, security);
  input.writeUInt32LE(24, security + 4);
  const output = removeWindowsSignature(input);
  assert.equal(output.length, 1000);
  assert.equal(output.readUInt32LE(security), 0);
  assert.equal(input.readUInt32LE(security), 1000);
  assert.throws(() => removeWindowsSignature(Buffer.from("bad")), /Invalid PE/);
});
