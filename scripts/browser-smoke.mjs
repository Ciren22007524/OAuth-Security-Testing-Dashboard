import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardServer } from "../src/server.js";
import { catalog } from "../src/runner.js";
import { createFixture } from "../src/fixture.js";
const scenarioCount = catalog.length;
const passCount = scenarioCount - 1;
const work = await mkdtemp(join(tmpdir(), "oauth-ui-"));
const server = dashboardServer({
  environmentsFile: join(work, "environments.json"),
});
const httpTarget = await createFixture();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = join(work, "profile");
const downloads = join(work, "downloads");
await mkdir(profile);
await mkdir(downloads);
const chrome = spawn(
  process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  [
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
let ws;
let chromeError;
chrome.on("error", (error) => {
  chromeError = error;
});
try {
  let pages;
  for (let i = 0; i < 100; i++) {
    try {
      if (chromeError) throw chromeError;
      const port = (
        await readFile(join(profile, "DevToolsActivePort"), "utf8")
      ).split("\n")[0];
      pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!pages) throw Error("Chrome startup failed");
  ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (e) => {
    const v = JSON.parse(e.data);
    if (v.id) {
      pending.get(v.id)?.(v);
      pending.delete(v.id);
    }
    if (v.method === "Runtime.exceptionThrown")
      errors.push(v.params.exceptionDetails.text);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (v) =>
        v.error ? reject(Error(JSON.stringify(v.error))) : resolve(v.result),
      );
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) =>
    (
      await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result.value;
  const wait = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(`Timeout: ${expression}`);
  };
  async function checkCatalogScrolling() {
    await evaluate(
      "document.getElementById('catalog').scrollIntoView({block:'center'});document.getElementById('catalog').scrollTop=0",
    );
    const before = await evaluate(
      "({page:scrollY, x:document.getElementById('catalog').getBoundingClientRect().left+40,y:document.getElementById('catalog').getBoundingClientRect().top+40})",
    );
    const wheel = () =>
      call("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: before.x,
        y: before.y,
        deltaX: 0,
        deltaY: 300,
      });
    await wheel();
    await wait("document.getElementById('catalog').scrollTop>0");
    if (await evaluate(`scrollY!==${before.page}`))
      throw Error("Catalog wheel scrolled page");
    await evaluate(
      "document.getElementById('catalog').scrollTop=document.getElementById('catalog').scrollHeight",
    );
    await wheel();
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (await evaluate(`scrollY!==${before.page}`))
      throw Error("Catalog boundary chained scrolling to page");
    await evaluate(
      "document.getElementById('catalog').scrollTop=0;window.scrollTo(0,0)",
    );
  }
  async function checkResponseScrolling() {
    // A long response must use the detail column's scroll area, never a nested pre.
    await evaluate(String.raw`(() => {
      const pre = document.querySelector('.evidence-item pre');
      pre.dataset.original = pre.textContent;
      pre.textContent += '\n' + 'long-response-line '.repeat(30).concat('\n').repeat(100);
      document.querySelector('.detail').scrollTop = 0;
    })()`);
    const layout = await evaluate(`(() => {
      const panel = document.querySelector('.detail');
      const pre = document.querySelector('.evidence-item pre');
      panel.scrollTop = pre.offsetTop;
      const rect = panel.getBoundingClientRect();
      return {x:rect.left+80, y:rect.top+rect.height/2, top:panel.scrollTop, catalog:document.getElementById('catalog').scrollTop,
        fits:document.documentElement.scrollHeight<=innerHeight && rect.bottom<=innerHeight,
        nested:getComputedStyle(pre).overflowY};
    })()`);
    if (!layout.fits || layout.nested !== "visible")
      throw Error("Response layout has page or nested scrolling");
    await call("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: layout.x,
      y: layout.y,
      deltaX: 0,
      deltaY: 300,
    });
    await wait(`document.querySelector('.detail').scrollTop>${layout.top}`);
    if (
      await evaluate(
        `scrollY!==0 || document.getElementById('catalog').scrollTop!==${layout.catalog}`,
      )
    )
      throw Error("Response wheel moved page or catalog");
    await evaluate(
      "document.querySelector('.detail').scrollTop=document.querySelector('.detail').scrollHeight",
    );
    await call("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: layout.x,
      y: layout.y,
      deltaX: 0,
      deltaY: 300,
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (await evaluate("scrollY!==0"))
      throw Error("Response boundary scrolled page");
    await evaluate(`(() => {
      const pre = document.querySelector('.evidence-item pre');
      pre.textContent = pre.dataset.original;
      delete pre.dataset.original;
      document.querySelector('.detail').scrollTop = 0;
      document.getElementById('execution-log').open = true;
    })()`);
    if (await evaluate("document.documentElement.scrollHeight>innerHeight"))
      throw Error("Execution log pushed workspace outside viewport");
    await evaluate("document.getElementById('execution-log').open=false");
    await evaluate(
      "document.querySelector('.detail').scrollTop=document.querySelector('.detail').scrollHeight;document.querySelectorAll('.scenario')[1].click()",
    );
    if (await evaluate("document.querySelector('.detail').scrollTop!==0"))
      throw Error("New scenario retained old response scroll position");
    await evaluate("document.querySelector('.scenario').click()");
  }
  async function checkEnvironmentPanel() {
    const height = await evaluate(
      "document.getElementById('workspace').clientHeight",
    );
    await evaluate(
      "document.getElementById('environment-open').focus();document.getElementById('environment-open').click()",
    );
    await wait("document.getElementById('environment-panel').open");
    if (
      !(await evaluate(
        `document.getElementById('workspace').clientHeight===${height} && document.getElementById('environment-select').getBoundingClientRect().height>0 && document.getElementById('environment-name').textContent==='本地模擬'`,
      ))
    )
      throw Error(
        "Environment overlay changed workspace or summary is missing",
      );
    if (
      await evaluate(
        "document.documentElement.scrollWidth>innerWidth || document.getElementById('environment-panel').scrollWidth>document.getElementById('environment-panel').clientWidth",
      )
    )
      throw Error("Environment panel overflow");
    await call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await wait("!document.getElementById('environment-panel').open");
    if (!(await evaluate("document.activeElement.id==='environment-open'")))
      throw Error("Environment panel did not restore header focus");
  }
  await call("Runtime.enable");
  await call("Page.enable");
  await call("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
  });
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url: base });
  await wait(
    `document.querySelectorAll('.scenario').length===${scenarioCount}`,
  );
  if (
    !(await evaluate(
      "document.querySelector('.scenario[aria-pressed=true]')!==null && !document.querySelector('.technical').open && !document.getElementById('execution-log').open && document.getElementById('environment-edit').hidden",
    ))
  )
    throw Error("Initial selection or secondary controls incorrect");
  await checkEnvironmentPanel();
  await checkCatalogScrolling();
  await evaluate(
    "document.getElementById('scenario-search').value='callback';document.getElementById('scenario-search').dispatchEvent(new Event('input'))",
  );
  if ((await evaluate("document.querySelectorAll('.scenario').length")) !== 2)
    throw Error("Scenario search failed");
  await evaluate(
    "document.getElementById('scenario-search').value='no-such-scenario';document.getElementById('scenario-search').dispatchEvent(new Event('input'))",
  );
  if (!(await evaluate("document.querySelector('.catalog-empty')!==null")))
    throw Error("Search empty state missing");
  await evaluate(
    "document.getElementById('scenario-search').value='';document.getElementById('scenario-search').dispatchEvent(new Event('input'))",
  );
  await evaluate(
    "document.getElementById('filter').value='JWT';document.getElementById('filter').dispatchEvent(new Event('change'))",
  );
  if (
    (await evaluate("document.querySelectorAll('.scenario').length")) !==
    catalog.filter((s) => s.category === "JWT").length
  )
    throw Error("Filter failed");
  if (
    !(await evaluate(
      "document.querySelector('.scenario[aria-pressed=true]')!==null && document.getElementById('detail').textContent.includes(document.querySelector('.scenario[aria-pressed=true] strong').textContent)",
    ))
  )
    throw Error("Filtered selection and detail disagree");
  await evaluate(
    "document.querySelector('.scenario').click();document.querySelector('#detail button').click()",
  );
  await wait(
    "document.getElementById('pass').textContent==='1' && !document.getElementById('run').disabled",
  );
  await evaluate(
    "document.getElementById('filter').value='all';document.getElementById('filter').dispatchEvent(new Event('change'));document.getElementById('run').click()",
  );
  await wait(
    `document.getElementById('total').textContent==='${scenarioCount}' && !document.getElementById('run').disabled`,
  );
  const stats = await evaluate(
    "({pass:document.getElementById('pass').textContent,fail:document.getElementById('fail').textContent,inconclusive:document.getElementById('inconclusive').textContent})",
  );
  if (
    stats.pass !== String(passCount) ||
    stats.fail !== "0" ||
    stats.inconclusive !== "1"
  )
    throw Error(JSON.stringify(stats));
  await evaluate(
    "document.querySelector('.export-menu').open=true;document.getElementById('export-json').click();document.querySelector('.export-menu').open=true;document.getElementById('export-md').click()",
  );
  for (let i = 0; i < 50; i++) {
    if (
      (await readdir(downloads)).filter((n) => /\.(json|md)$/.test(n))
        .length === 2
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (
    (await readdir(downloads)).filter((n) => /\.(json|md)$/.test(n)).length !==
    2
  )
    throw Error("Downloads failed");
  const report = JSON.parse(
    await readFile(join(downloads, "oauth-simulation-report.json"), "utf8"),
  );
  if (
    report.environment !== "SIMULATION" ||
    report.results.length !== scenarioCount ||
    report.results.filter((r) => r.status === "PASS").length !== passCount ||
    report.results.some((r) => r.cleanup !== "complete")
  )
    throw Error("Invalid exported report");
  for (const file of [
    "oauth-simulation-report.json",
    "oauth-simulation-report.md",
  ]) {
    const text = await readFile(join(downloads, file), "utf8");
    if (/__Host-rt=[a-f0-9-]{36}|fixture-[a-f0-9-]{36}/.test(text))
      throw Error("Unredacted credential in downloaded report");
    if (!text.includes("SIMULATION")) throw Error("Missing report environment");
  }
  await evaluate("document.querySelector('.scenario').click()");
  if (!(await evaluate("document.querySelector('.evidence-item')?.open")))
    throw Error("Evidence disclosure missing");
  await evaluate("document.querySelector('.evidence-item summary').click()");
  if (await evaluate("document.querySelector('.evidence-item').open"))
    throw Error("Evidence did not collapse");
  await evaluate("document.querySelector('.evidence-item summary').click()");
  await checkResponseScrolling();
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await checkEnvironmentPanel();
  await checkCatalogScrolling();
  await checkResponseScrolling();
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await writeFile(
    join(work, "desktop.png"),
    Buffer.from(
      (await call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  if (await evaluate("document.documentElement.scrollWidth > innerWidth"))
    throw Error("Mobile overflow");
  await checkEnvironmentPanel();
  await checkCatalogScrolling();
  await writeFile(
    join(work, "mobile.png"),
    Buffer.from(
      (await call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  await evaluate(
    "document.getElementById('run').click();setTimeout(()=>document.getElementById('cancel').click(),300)",
  );
  await wait("!document.getElementById('run').disabled");
  if (
    !(await evaluate(
      "document.getElementById('status').textContent.includes('已停止')",
    ))
  )
    throw Error("Cancel failed");
  await call("Page.reload");
  await wait(
    `document.querySelectorAll('.scenario').length===${scenarioCount}`,
  );
  if ((await evaluate("document.getElementById('total').textContent")) !== "0")
    throw Error("Unexpected persistence");
  // Save a local result, then verify custom environment results cannot replace it.
  await evaluate(
    "document.querySelector('.scenario').click();document.querySelector('#detail button').click()",
  );
  await wait(
    "document.getElementById('total').textContent==='1' && !document.getElementById('run').disabled",
  );
  await evaluate(
    "document.getElementById('environment-open').click();document.getElementById('environment-new').click()",
  );
  await evaluate(
    `document.getElementById('profile-name').value='My QA target';document.getElementById('profile-url').value=${JSON.stringify(httpTarget.url)};document.getElementById('environment-form').requestSubmit()`,
  );
  await wait(
    "!document.getElementById('environment-dialog').open && document.getElementById('environment-panel').open && document.getElementById('environment-mode').dataset.mode==='CUSTOM_HTTP'",
  );
  if ((await evaluate("document.getElementById('total').textContent")) !== "0")
    throw Error("Mixed environment results");
  const customId = await evaluate(
    "document.getElementById('environment-select').value",
  );
  if (
    !(await evaluate(
      `document.getElementById('environment-name').textContent==='My QA target' && document.getElementById('environment-summary').textContent===${JSON.stringify(httpTarget.url)}`,
    ))
  )
    throw Error("Header target summary not updated");
  await evaluate("document.getElementById('environment-panel-done').click()");
  await evaluate(
    "document.querySelector('.scenario').click();document.querySelector('#detail button').click()",
  );
  await wait(
    "document.getElementById('pass').textContent==='1' && !document.getElementById('run').disabled",
  );
  await evaluate(
    "document.getElementById('environment-open').click();document.getElementById('environment-select').value='local';document.getElementById('environment-select').dispatchEvent(new Event('change'))",
  );
  await wait(
    `document.querySelectorAll('.scenario').length===${scenarioCount} && !document.getElementById('environment-select').disabled`,
  );
  if ((await evaluate("document.getElementById('total').textContent")) !== "1")
    throw Error("Local result not retained");
  await evaluate(
    `document.getElementById('environment-select').value=${JSON.stringify(customId)};document.getElementById('environment-select').dispatchEvent(new Event('change'))`,
  );
  await wait(
    "document.getElementById('environment-mode').dataset.mode==='CUSTOM_HTTP' && !document.getElementById('environment-select').disabled",
  );
  if ((await evaluate("document.getElementById('pass').textContent")) !== "1")
    throw Error("Custom result not retained");
  await evaluate(
    "document.getElementById('environment-edit').click();document.getElementById('profile-name').value='Renamed QA';document.getElementById('environment-form').requestSubmit()",
  );
  await wait(
    "!document.getElementById('environment-dialog').open && document.getElementById('status').textContent.includes('Renamed QA')",
  );
  if ((await evaluate("document.getElementById('total').textContent")) !== "0")
    throw Error("Stale configuration results retained");
  await call("Page.reload");
  await wait(
    "document.getElementById('environment-mode').dataset.mode==='CUSTOM_HTTP' && !document.getElementById('environment-select').disabled",
  );
  if (
    (await evaluate("document.getElementById('environment-select').value")) !==
    customId
  )
    throw Error("Selection not restored");
  await evaluate(
    "document.querySelector('.scenario').click();document.querySelector('#detail button').click()",
  );
  await wait(
    "document.getElementById('pass').textContent==='1' && !document.getElementById('run').disabled",
  );
  await evaluate(
    "document.querySelector('.export-menu').open=true;document.getElementById('export-json').click()",
  );
  const customFile = join(downloads, `oauth-${customId}-report.json`);
  let customReport;
  for (let i = 0; i < 50; i++) {
    try {
      customReport = JSON.parse(await readFile(customFile, "utf8"));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (
    customReport?.environment !== "CUSTOM_HTTP" ||
    customReport.environmentId !== customId ||
    customReport.configuration.baseUrl !== httpTarget.url ||
    customReport.results[0].target !== httpTarget.url
  )
    throw Error("Incorrect custom export target");
  await evaluate(
    "document.getElementById('environment-open').click();document.getElementById('environment-edit').click()",
  );
  if (await evaluate("document.documentElement.scrollWidth > innerWidth"))
    throw Error("Mobile environment form overflow");
  await writeFile(
    join(work, "environment-manager.png"),
    Buffer.from(
      (await call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  await evaluate("document.getElementById('environment-delete').click()");
  await wait(
    "!document.getElementById('environment-dialog').open && document.getElementById('environment-select').value==='local'",
  );
  if (
    (await evaluate(
      "document.getElementById('environment-select').options.length",
    )) !== 1
  )
    throw Error("Profile not deleted");
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log(
    JSON.stringify({
      stats,
      checks: [
        "filter",
        "scenario search and empty state",
        "expandable HTTP evidence",
        "single run",
        "all scenarios",
        "JSON download",
        "Markdown download",
        "cancel",
        "reload clears state",
        "mobile overflow",
        "desktop/mobile catalog wheel scroll and boundary containment",
        "long response uses detail scroll without nested or page scrolling at desktop and laptop sizes",
        "no browser exceptions",
        "create/edit/delete environment",
        "compact environment header, modal focus and Escape, mobile overlay and target summary",
        "custom HTTP execution",
        "environment result isolation",
        "revision invalidates old results",
        "persisted profile and selection",
        "custom report target identity",
      ],
      artifactDirectory: work,
    }),
  );
} finally {
  ws?.close();
  const exited = new Promise((r) => chrome.once("exit", r));
  if (chrome.exitCode === null && chrome.pid) {
    chrome.kill();
    await exited;
  }
  await new Promise((r) => server.close(r));
  await httpTarget.close();
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
