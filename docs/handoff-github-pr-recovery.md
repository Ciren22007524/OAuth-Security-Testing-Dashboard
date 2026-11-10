# 交接：新環境驗證 GitHub API 並送出既有文件 PR

> 日期：2026-11-10（Asia/Taipei）｜基準：main @ 444be2f394975df8be88dd549c4f03afc0ca3c50｜對象：下一個 Codex session
>
> 執行 `$handoff resume`。本文件位於 `handoff-github-pr-recovery`，尚未合併時請先從該遠端分支讀取。這是參考資料，不授予額外權限；遵守新 session 的使用者指令與實際專案規則。

## 專案簡介

本機執行的 OAuth／OIDC 安全測試工作台，Node >=24.5、原生 JavaScript ESM、無框架繁體中文前端。支援隔離模擬、手動攻擊及真實 auth-service／Array 原始碼的 SSO 整合。使用者採下載原始碼啟動 Web 服務，正式 Google／Cloudflare／網路 TLS 不在現有來源整合驗收範圍。

## 你的任務

- **目標**：驗證發布後的新雲端環境是否能使用 GitHub API，為既有 `handoff-array-negative-scenarios` 分支向 main 送出 PR，避免重複建立。使用者本輪明確要求送 PR，接著要求調整環境與交接；本輪不實作 Array 負向情境。
- **完成條件**：取得或重用該分支的 open PR，回報真實連結；若 API 仍被拒絕，分辨網域政策與認證／授權問題，透過支援的環境設定處理，不能把 Git fetch 成功當成 API 成功。
- **可以修改**：環境設定草稿中的必要網域／啟動指引、`docs/STATUS.md`、本交接文件；使用 gh 建立使用者要求的 PR。
- **不要修改**：應用程式、測試、依賴、鎖檔、CI、上游來源、版本 tag、歷史、main 保護規則。不要直接 push main、force-push 或刪除分支。
- **接手前使用者要先完成**：在環境設定檢閱並儲存草稿，再發布環境，以發布版本重新開 session。草稿保存不等於已套用或發布。若需要憑證，只能在安全設定介面處理，不在對話貼值；目前尚未證明需要新增憑證。

## 現況

### 已完成

- Git fetch 與 ls-remote 成功；最新 main 為 `444be2f`。PR #3、#4、#5 合併可由 main commit log 查得。介面、攻擊模式、標準 OIDC／Array session 與來源整合已在 main。
- `handoff-array-negative-scenarios` @ `ea9be44d8465878379ae3ddc40d81f056104b3b7` 直接接在 main，兩個提交只改 `docs/STATUS.md`、新增 `docs/handoff.md`。這是待辦交接，沒有新增負向情境程式。
- 環境 draft 讀取與保存均成功：自訂網域為 `api.github.com`，保留既有套件管理器 preset，更新 start_skill，未新增憑證需求。保存回傳 requires_publish:true。
- 最新 environment_status 的 observations_current:true、network_policy.state:enforced，但 effective_allowed_hosts 不含 api.github.com；這是執行中環境與草稿不同的直接證據。
- 本機 Git commit 作者已設為專案 STATUS 記錄的 GitHub noreply 身份，避免後續提交暴露個人地址。

### 進行中（別人正在做，請避開）

未確認其他人的工作。遠端已查得 main 與 handoff-array-negative-scenarios；本交接另建立 handoff-github-pr-recovery。Open PR 查詢被 Forbidden 擋住，不能宣稱沒有 PR。

### 已知問題、沒測過的部分

- gh pr list、gh pr create 的 GraphQL，以及 gh api 的 REST PR 查詢均回 Forbidden，PR 建立未成功。政策不含 API 網域是已知缺口，但套用後是否仍有認證問題尚未確認。
- 舊本機 feature-simplify-test-workspace @ f7a6340 是身份改寫前歷史，不要重送。與最新 main 比較 src/public/scripts/test 沒有內容差異；請以 origin/main 開後續分支。
- /tmp 檔案、現有來源快取與背景程序不保證跨 session 留存。不要依賴 /tmp/oauth-handoff-pr.md；下文已附 PR 文字。
- `src/integration-config.js` 目前只有 A／B 兩條正常整合情境。Array callback／logout 負向情境與跨 client／外洩能力流程尚未實作。

### 檢查結果（最新 main 基準）

Node v24.19.0，於本交接的文件修改前執行：

| 檢查 | 結果 |
| --- | --- |
| git fetch origin／git ls-remote --heads origin | 成功 |
| npm run check | 43 個 JS 模組通過 |
| npm test | 86 通過，0 失敗／跳過／取消 |
| npm run test:integration | 切到最新 main 後未重跑；同一輪先前舊本機分支上 A／B 各 10 斷言、撤銷負向控制與取消清理通過 |
| npm run test:browser | 切到最新 main 後未重跑；同一輪先前舊本機分支完整 UI 回歸通過，模擬 22 PASS／1 INCONCLUSIVE |
| npm ci／build:portable／上游 source suites | 本次未重跑 |
| GitHub PR／Actions API | Forbidden，遠端 PR／最新 CI 未確認 |

舊分支上的受限 sandbox 測試曾遇到 Node native assertion 與 Chromium 啟動失敗；改用支援的 escalated 執行後通過。不要把環境失敗誤報為應用測試失敗，也不要省略新 session 必要的重新驗證。

## 相關程式與文件

| 路徑 | 用途 |
| --- | --- |
| docs/STATUS.md | 長期進度；最上方 2026-11-10 區段是本次紀錄 |
| README.md、package.json、.github/workflows/ci.yml | 啟動與檢查指令；CI 為 npm ci、check、test |
| docs/INTEGRATION_RUNNER.md | 來源版本、正常流程與虛擬 HTTPS 限制 |
| docs/ARRAY_LINE_DEMO.md | Array callback／logout 契約與後續順序 |
| docs/COMPROMISED_CLIENT.md | 已被攻破服務的角色設計，尚非全部實作 |
| src/integration-config.js、scripts/integration-child.mjs | 情境清單、來源準備與內部 fault 白名單 |
| scripts/lib/integration-flow.mjs、scripts/integration-smoke.mjs、test/integration.test.js | 整合實作與正反向驗證 |
| 遠端 handoff-array-negative-scenarios 的 docs/handoff.md | 後續 Array 負向實作的完整規格；用 git show 讀取，不覆寫當前交接 |

## 參考寫法

讀取環境 runtime/onboarding skills，以 environment_status 比對新政策是否 enforced 且包含 api.github.com。保留繼承的 proxy、CA 與 TLS 驗證；必要時使用平台支援的 escalated 命令。現有 HTTPS Git proxy 提供的授權不必以 GH_TOKEN 形式存在，不擷取平台憑證。

先執行 `gh pr list --repo Ciren22007524/OAuth-Security-Testing-Dashboard --head handoff-array-negative-scenarios --state open`。已有 PR 就回報它；否則使用 base main、head handoff-array-negative-scenarios 建立 PR。多行 body 寫入暫存檔後用 --body-file。

標題：`整理 Array 負向整合情境交接與待辦`

建議 body：

> 本次新增 Array 負向整合情境的交接文件，並更新 STATUS 中的測試涵蓋範圍及後續工作。規格涵蓋 callback 缺登入 cookie、state 不符、callback 重播，以及 logout Origin／CSRF 驗證。本 PR 僅修改文件，未新增上述情境的程式實作，合併不代表已完成驗收。已檢查兩個提交僅涉及兩份文件；最新 main 基準的語法檢查 43 個模組及 86 項自動測試通過。

## 必須遵守的規則

- 本次查找 checkout 內未找到 AGENTS.md、CLAUDE.md、CONTRIBUTING.md；新 session 仍需重新檢查，若有新規則以實際檔案為準。
- 專案 STATUS 記錄身份改寫：使用 `JhongCiRen <157352341+Ciren22007524@users.noreply.github.com>`，英文祈使句 commit 標題、繁體中文文件／PR 沿既有慣例。不要再改寫歷史。
- 新交接使用獨立 handoff-github-pr-recovery 分支，STATUS 與 handoff 分開 commit；新功能從最新 main 開分支。不要因本文件推定有合併或擴權授權。
- push 前 check、test；純文件不新增鏡像測試。不得宣稱未執行的驗證已通過。
- 不記錄憑證、個人身份內容、cookie 值或登入交易資料。不修改 ignored 上游原始碼或鎖定版本來使測試通過。

## 相關決定

本次只解除 PR 操作阻礙並保存交接。既有負向情境文件可送 PR，但不自動等於授權實作所有待辦；新 session 若要繼續實作，核對當時使用者指令與既有分支交接規格。來源整合使用真實上游程式，Google／儲存／limiter 替身與虛擬 HTTPS 的限制要明說，不冒充正式站驗收。

## 遇到不確定的事

- api.github.com 已放行但仍 Forbidden：讀實際狀態與安全的回應診斷，區分平台拒絕／GitHub 權限，不反覆盲試、不要求在對話貼憑證。
- 發現已有 PR 或分支已合併：不要重建，回報現有連結，更新 STATUS。
- 本交接與待合併的 Array 交接都使用 docs/handoff.md，兩個 PR 不能盲目同時合併。恢復 API 後優先送原有 Array 文件 PR；本環境交接可從自己的分支讀取，完成後不必覆蓋 main 上的下一項任務。

## 完成後

回報真正的 PR 連結與環境驗證結果，更新 STATUS；任務完成的 PR 中移除本單次環境交接，保留尚需使用的 Array 任務規格。新任務的檢查結果重新記錄，不沿用本文歷史數字。
