import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createDashboardServer } from "./application.js";

export function desktopDataFile({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (env.DASHBOARD_ENVIRONMENTS_FILE) return env.DASHBOARD_ENVIRONMENTS_FILE;
  const directory =
    platform === "win32"
      ? env.LOCALAPPDATA || join(home, "AppData", "Local")
      : env.XDG_CONFIG_HOME || join(home, ".config");
  return join(directory, "OAuthSecurityLab", "environments.json");
}
export function browserCommand(url, platform = process.platform) {
  if (platform === "win32")
    return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}
export async function startDesktop({
  readAsset,
  environmentsFile = desktopDataFile(),
  openBrowser = true,
  port = 0,
} = {}) {
  const server = createDashboardServer({ environmentsFile, readAsset });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  if (openBrowser) {
    const [command, args] = browserCommand(url);
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () =>
      console.error(`無法自動開啟瀏覽器，請手動輸入：${url}`),
    );
    child.unref();
  }
  return {
    url,
    server,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
