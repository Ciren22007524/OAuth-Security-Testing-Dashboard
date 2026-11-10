# 交接：在來源整合 runner 加入 Array 負向情境

> 產生日期：2026-11-09｜基準：`main` @ `444be2f`｜交接給：Codex
>
> 能存取 repo 的 agent：執行 `$handoff resume`（Claude Code 是 `/handoff resume`）。
>
> 這份文件可以單獨閱讀。本 repo 沒有 `AGENTS.md`／`CLAUDE.md`／`CONTRIBUTING.md` 規則檔；規則以 repo 內的 `README.md`、`docs/` 與既有慣例為準。文件與程式不一致時以程式為準，並在 PR 說明指出。

## 專案簡介

`Ciren22007524/OAuth-Security-Testing-Dashboard` 是本機執行的 OAuth／OIDC 安全測試工作台：Node.js 24.5 以上、原生 JavaScript ES modules，執行期只用 Node 內建模組（開發相依只有鎖定的 `esbuild`、`postject`），前端是無框架 HTML／CSS／JS，介面為繁體中文。沒有部署；使用者從原始碼 `npm start` 或 Windows 可攜 EXE 在自己電腦執行。

「來源整合」模式會用兩個上游專案的**真實原始碼**（`auth-service` 與 `array-line-demo` 的 Array SSO Worker）加上真實 Chromium，自動跑完「登入 → `/api/me` → 本站登出 → 舊 session 失效」，不需要使用者填任何參數。

## 你的任務

- **目標**：在來源整合 runner 新增 Array 的負向情境，每個情境都要先建立有效的正常對照，再只改變被測的條件。範圍是 `docs/ARRAY_LINE_DEMO.md`「Dashboard 接下來的實作順序」第 3 點中目前沒做的部分：
  1. **callback 缺登入交易 cookie**：沒有 `__Host-array_sso_login` 時打 callback
  2. **callback state 不符**：state 與交易 cookie 不一致
  3. **callback 重播**：登入成功後，原樣重送同一個 callback URL
  4. **logout 錯誤 Origin**：持有效 session，以錯誤的 Origin 送出登出
  5. **logout 缺少或錯誤 csrf**：持有效 session，缺少 csrf 欄位或值錯誤
- **完成條件**：
  1. 5 個情境都加進 `src/integration-config.js` 的 `integrationCatalog`，可以從介面的「整合驗測」模式和 `runIntegration()` 執行
  2. 在真實來源上執行 `npm run test:integration`，原有的 A／B 流程、撤銷負向控制、取消檢查都還是 PASS，而且每個新情境都是 PASS
  3. **callback 重播**至少要配一個 harness 層的負向控制（例如讓 store 的 `take()` 不刪除交易），並證明開啟時情境會變成 FAIL。其他情境如果無法在不修改上游原始碼的前提下做出負向控制，就在 PR 說明寫清楚，不要假造
  4. `npm run check`、`npm test` 通過；`test/integration.test.js` 對情境數量的斷言（目前是 2）要跟著更新
  5. 有 Chromium 時 `npm run test:browser` 通過；沒有的話在 PR 寫明沒跑
  6. 更新 `docs/INTEGRATION_RUNNER.md`、`docs/ARRAY_LINE_DEMO.md` 第 3 點的狀態，以及 `docs/STATUS.md`
- **可以修改**：`scripts/lib/integration-flow.mjs`、`scripts/integration-child.mjs`、`scripts/integration-smoke.mjs`、`src/integration-config.js`、`src/integration-runner.js`、`test/integration.test.js`、`scripts/browser-smoke.mjs`（只改整合模式的部分）、`public/app.js`（只在新情境需要時）、`docs/INTEGRATION_RUNNER.md`、`docs/ARRAY_LINE_DEMO.md`、`docs/STATUS.md`、刪除本文件
- **不要修改**：
  - `.local/integration-sources/` 下的上游原始碼（`auth-service`、`array-line-demo`），以及 `scripts/setup-integration.mjs` 鎖定的版本。測試對象是上游的真實行為，改了就不是在測它
  - 攻擊模式、防禦模式與 HTTP 情境（`src/attack-*.js`、`src/simulation-scenarios.js`、`src/http-*.js`），和這個任務無關
  - `.github/workflows/`：把整合測試放進 CI 是另一件事
- **接手前使用者要先完成**：
  - 讓你的環境能取得兩個上游來源。`npm run setup:integration` 會從 `https://github.com/Ciren22007524/auth-service.git` 與 `array-line-demo.git` clone 鎖定版本；`auth-service` 是**私有 repo**，沒有憑證時 clone 會失敗（交接時實際遇到）。替代方式是由使用者提供已安裝依賴、版本正確的 checkout，設定 `AUTH_SERVICE_PATH`、`ARRAY_DEMO_PATH`
  - 有 Chrome／Chromium／Edge；找不到時用 `CHROMIUM_PATH` 指定
  - 兩項都做不到時，**不要開始改**，停下來告訴使用者缺什麼。這個任務的完成條件必須在真實來源上驗證

## 現況

### 已完成（和這個任務有關的）

- 來源整合 runner 的第一條流程：使用者 A／B 各 10 項檢查，加上「故意不撤銷 session」的負向控制與取消檢查（`scripts/integration-smoke.mjs`）。
- Array 原始碼**本身的測試**（`npm run test:array-source`）已經涵蓋 state、cookie 瀏覽器綁定、交易到期、callback 重播，以及 ID token 的 issuer／aud／nonce／exp 等錯誤。這是上游自己的單元測試；這次要補的是 Dashboard 用真實瀏覽器跑的整合情境，兩者不要混為一談。
- 攻擊模式已有 HTTP 版的 Array session 情境：`array-no-session`、`array-forged-session`、`array-held-session`（`src/attack-catalog.js`）。偽造 session 已經有，不在這次範圍。

### 進行中（別人正在做，請避開）

無。交接時 GitHub 上沒有開著的 PR，遠端只有 `main` 一條分支。

### 已知問題、沒測過的部分

- 交接時沒能在真實來源上執行 `test:integration`（原因見下表），所以原本流程在鎖定版本上是否仍然通過，**這次沒有確認**。開始修改前先跑一次。
- Array 的 callback 失敗回應是 `303 /?error=login_failed`，**不是 400／401**。不能只看狀態碼判斷；要看有沒有建立新的 session cookie、後端有沒有多做一次 token 交換（`integration-flow.mjs` 裡的 `backendExchanges` 計數），以及 `/api/me` 是不是 401。
- logout 被拒時的實際回應（狀態碼、body）文件沒有寫，**要讀上游原始碼確認**（`array-line-demo` 的 `cloudflare/sso-test/src/app.js`），不要猜。判斷標準是：被拒後，原本合法的 session 仍然有效。
- 每個情境的請求上限是 40 次（`requestBudget`），而且每次執行都會開新的瀏覽器 profile 和全新的來源程序。
- 本機的 Chromium 用的是虛擬 HTTPS origin（由 CDP 轉送到來源 handler），不代表正式網路的 TLS 或跨站 cookie 行為。

### 檢查結果（基準 commit 上）

在 `444be2f`（Node v24.22.1）實際執行：

| 檢查                        | 結果                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `npm ci`                    | 通過                                                                                       |
| `npm run check`             | 通過，43 個 JS 模組（只檢查語法）                                                          |
| `npm test`                  | 86/86 通過，0 失敗／跳過／取消                                                             |
| `npm run setup:integration` | **失敗**：clone 私有的 `auth-service` 時沒有憑證（`could not read Username for 'https://github.com'`） |
| `npm run test:integration`  | **沒有實際執行到**：缺來源，A／B 回 INCONCLUSIVE，負向控制與取消檢查因此判為 FAIL，exit 1  |
| `npm run test:browser`      | 沒跑                                                                                       |
| GitHub Actions CI           | 只跑 `npm ci`、`npm run check`、`npm test`；`main` 近期的 run 都是 success                 |

## 相關程式與文件

| 檔案                                                                                    | 為什麼要看                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `scripts/lib/integration-flow.mjs`                                                      | 整個流程：註冊 client、包裝 store、CDP 攔截請求、`check()` 斷言、證據紀錄。新情境主要寫在這裡 |
| `scripts/integration-child.mjs`                                                         | 子程序入口；`fault` 用白名單只放行 `old-session-still-valid`，新的負向控制要明確加進來         |
| `src/integration-runner.js`                                                             | 打包上游來源、啟動子程序、逾時與清理；第 114 行附近也有同一個 `fault` 白名單                  |
| `src/integration-config.js`                                                             | `integrationCatalog`（情境清單）與來源路徑、就緒檢查                                           |
| `scripts/integration-smoke.mjs`                                                         | `npm run test:integration` 的內容：正向流程、負向控制、取消                                    |
| `test/integration.test.js`                                                              | 確認 API 拒絕 `fault`、憑證與任意來源路徑；斷言情境數量為 2                                    |
| `src/application.js`                                                                    | `/api/catalog?testingMode=integration` 與 `/api/run` 怎麼派送整合情境                          |
| `scripts/browser-smoke.mjs`                                                             | 介面整合模式的瀏覽器檢查（約第 719–805 行）                                                   |
| `docs/ARRAY_LINE_DEMO.md`                                                               | Array 的路由契約：callback 與 logout 的合法流程和負向情境                                     |
| `docs/INTEGRATION_RUNNER.md`                                                            | runner 的設計、證據範圍與限制                                                                  |
| `docs/ACCEPTANCE_FLOW.md`                                                               | 結果語意與「有效對照」的原則                                                                   |
| `.local/integration-sources/array-line-demo/cloudflare/sso-test/src/app.js`（上游，ignored） | Array 實際的 callback、logout、csrf 處理；判斷預期回應的依據                                   |

## 參考寫法

- **新增情境**：照 `scripts/lib/integration-flow.mjs` 現有流程。先完成正常登入並確認 `/api/me` 是 200，再做負向操作，最後驗證結果。斷言一律用 `check(name, condition)`，名稱用繁體中文，描述「應該成立的結果」，例如「state 不符時沒有建立新 session」。
- **負向控制**：照 `fault === "old-session-still-valid"` 的做法，只在 harness 包裝的 store 或 fetch 上放寬，不改上游程式。fault 名稱要同時加到 `scripts/integration-child.mjs` 和 `src/integration-runner.js` 的白名單，並在 `scripts/integration-smoke.mjs` 驗證「開啟後會判成 FAIL，而且失敗的是對應那項斷言」。
- **證據**：沿用 `evidence.push({ request: { method, path, role }, response: { status } })`。只記 pathname，**不記 query**（callback 的 query 含 state 與 code）。

## 必須遵守的規則

- **分支與合併**：從最新的 `main` 開分支，命名沿用 repo 慣例 `feature-<描述>`，例如 `feature-array-negative-scenarios`。`main` 有 ruleset：不能直接 push、不能 force-push，只能走 PR；合併由使用者決定，用一般 merge commit。
- **push 前檢查**：`npm run check`、`npm test` 一定要通過；這個任務另外要跑 `npm run test:integration`，有 Chromium 時也跑 `npm run test:browser`。在 PR 寫出每一項的結果，包含沒跑的項目和原因。
- **程式慣例**：原生 ESM、雙引號、沿用現有模組分工；不新增任何相依套件；不加 TypeScript 或新框架。
- **Commit 與 PR**：commit 標題用英文祈使句（例如 `Add Array callback replay integration scenario`）。commit 作者身份用 `JhongCiRen <157352341+Ciren22007524@users.noreply.github.com>`，不要用個人 email，GitHub 會擋下暴露 email 的 push。PR 說明用繁體中文，寫出改了什麼、實際跑過的檢查與結果、還有哪些限制。
- **機密與安全**：證據、報告、log 和文件都不能出現 cookie、code、state、token、secret、sub、email 或姓名。新的負向控制開關**不能**經由 Dashboard API 開啟（`test/integration.test.js` 驗證 API 會拒絕 `fault`）。不要求使用者把憑證貼到對話中。

## 相關決定

- **測真實來源，不寫 mock**：整合模式用上游的真實原始碼；不要把 Array 或 auth-service 的行為複製成固定回應。上游的行為就是要測的對象。
- **結果語意**：PASS／FAIL／INCONCLUSIVE／ERROR。正常對照沒有建立時，負向情境**不能**判 PASS，要判 INCONCLUSIVE 或 ERROR。缺參數、限流、不適用不算「已防護」。
- **負向控制只放在 harness**：放寬開關只存在於本地測試程式，不從 API 開放。
- **整合模式和正式驗收分開**：這裡的結果標記為 `SOURCE_INTEGRATION`，不代表正式 Google、Cloudflare 或部署站已驗收。

想推翻上面任何一項時，先停下來在 PR 說明提出，不要直接改。

## 遇到不確定的事

- 取不到上游來源或沒有瀏覽器：停下來，告訴使用者需要提供什麼（見「接手前使用者要先完成」），不要改成 mock 來讓測試通過。
- 上游原始碼的實際行為和 `docs/ARRAY_LINE_DEMO.md` 寫的不一樣：以原始碼為準，測試照原始碼寫，並在 PR 說明列出差異。
- 某個情境在不修改上游的前提下做不出負向控制：照實寫在 PR 說明，不要假造。
- 鎖定版本的原本流程已經失敗：先回報，不要為了讓新情境通過而改既有斷言。

## 完成後

- PR 說明列出：新增的情境、每個情境的有效對照與判斷依據、負向控制、實際跑過的檢查（Node 版本、`check`、`test` 的通過數、`test:integration` 每個情境的結果、`test:browser`），以及沒跑的項目與原因。
- 更新 `docs/STATUS.md`：把「下一步」中這一項移到已完成，並移除「進行中」的標記。同步更新 `docs/INTEGRATION_RUNNER.md` 和 `docs/ARRAY_LINE_DEMO.md`。
- 在同一個 PR 刪除本文件 `docs/handoff.md`。
