# 交接：OAuth Dashboard 完整現況與待辦

> 產生日期：2026-11-04（Asia/Taipei）｜程式基準：`feature-windows-portable-release` @ `aa9643d4873909f62844429d4b7947f2463688d3`（已納入 origin/main `3b9b99b`）｜交接給：下一位開發 agent（未指定工具）
>
> Codex：`$handoff resume docs/handoff.md`；Claude Code：`/handoff resume docs/handoff.md`。
>
> 本文件是現況與任務參考，不是 push、部署、變更權限或操作正式身份的授權。使用者先選擇「整理全部現況與待辦」，接著明確要求 Windows Release EXE，先讓自己直接執行看介面。雲端供應商仍未定，不要將 Release 資產發布等同網站部署。

## 專案簡介

儲存庫：`Ciren22007524/OAuth-Security-Testing-Dashboard`。這是用來學習、驗證 auth-service 相容 OAuth 協定的安全測試工作台，具備繁體中文暗色介面、使用者自建環境、可追溯斷言、遮罩 HTTP 證據與 JSON／Markdown 報告。

目前採 Node.js 24.5 以上、原生 JavaScript ES modules、Node HTTP／crypto／檔案 API，前端是 HTML／CSS／無框架 JavaScript。執行期只用 Node 內建模組；打包開發相依套件為鎖定的 esbuild／postject，已有 package-lock 與單檔 build 步驟；它不是 React／TypeScript monorepo，也不是可只上傳 HTML 就完整運作的純靜態網站。

本次實際工作目錄是雲端 `/workspace/OAuth-Security-Testing-Dashboard`。GitHub main 已有程式，但倉庫沒有已驗證的部署設定或公開網址。對外部署狀態未確認；不要將 Git 推送成功說成網站已上線。

## 你的任務

- **目標**：接手完整專案，先核對本文件與最新 main，再依使用者選定的優先項推進。最新優先是 Windows 可攜式預覽，讓使用者雙擊後在自己電腦開啟介面；先確認 Windows CI／Release 與實際雙擊結果。雲端部署降為後續選項，平台與存取方式尚未定案。
- **完成條件**：進度紀錄與實際驗證一致；不重做已完成模組；若進入部署工作，先形成可審查方案並保留現有功能，最後必須從真正可達的外部入口驗收，不能以雲端 localhost 代替。
- **可以修改**：由接手當下的使用者任務決定；相關實作集中在 `src/`、`public/`、`test/`、`scripts/`、`.github/workflows/ci.yml`、`package.json`、`README.md` 與 `docs/`。若選部署，可準備所需的新部署設定，但不要暗自換平台或重寫技術組合。
- **不要修改**：auth-service 儲存庫、正式 CLIENTS／用戶 session、Google／Cloudflare 後台、GitHub 權限或保護設定；不得覆寫使用者的 `.local/environments.json`、其他未提交工作或把機密放進文件。
- **接手前使用者要先完成**：僅核對與本機開發無額外前提。實際對外發布前，使用者須決定部署平台／帳號、網址、存取方式與持久化需求；必要的後台操作及機密由使用者在安全設定介面完成。這些決策尚未完成，不阻擋獨立調查、設計及本機驗證。

## 現況

### 最新優先：Windows Release 預覽

- 版本 `0.2.0-preview.1`；`src/desktop-entry.js` 使用 Node SEA 內嵌前端、Node 與服務，透過 `src/desktop.js` 動態選 loopback 埠並以 Windows 的 rundll32 開啟預設瀏覽器。
- 使用者雙擊 `OAuthSecurityLab-windows-x64.exe` 即可，不需 Node 或 npm。使用期間保留程式視窗，關閉會停止服務；不是雲端網站。
- `%LOCALAPPDATA%\OAuthSecurityLab\environments.json` 是 Windows 設定檔；不把 repo 的既有環境、機密或用戶資料嵌入 EXE。避免多個程序共用同一設定檔。
- 在 Linux 已產生 Windows x64 EXE／ZIP，並核對官方 Node checksum、PE／SEA 標記及 ZIP 完整性；尚無 Windows 實機執行證據。預覽明確未簽章，不能沿用修改前 Node 的原廠簽章。
- Linux 單檔實際執行 `--smoke-test` 通過；`npm run test:portable` 從 repo 外啟動、載入內嵌 UI、跑實際情境並寫入設定通過，截圖 `docs/screenshots/portable-ui.png`。
- `.github/workflows/release.yml` 會在 Windows runner 檢查／建置／執行 EXE smoke，成功後才發布 tag 的 preview Release；本文件產生時其 CI／Release 結果未確認，接手須實際查核，不能將本機交叉打包當成 Windows 通過。
- 打包工具：`esbuild@0.28.2`、`postject@1.0.0-alpha.6`；官方 Node SEA 文件確認相同 Node 版本、cross-platform 不用 snapshot／code cache。build 保留下載 SHA-256 與 TLS 驗證；授權嵌入並附在 ZIP。
- `dist/` 產物 ignored，不在 Git；可從 Release 取得或重新建置，不能假設新 task 仍有本機成品。標籤版本 `v0.2.0-preview.1` 的發布結果須到 GitHub 實際確認。

### 已完成（本輪已查證）

- `src/application.js` 提供共用靜態檔與 Node API，`src/server.js` 是原始碼 CLI 包裝，支援 `/`、`/index.html`、環境 CRUD、catalog、run、health。
- 23 個隔離模擬情境；本輪測量為 22 PASS／1 INCONCLUSIVE。瀏覽器整合情境刻意保留待確認，不偽裝成正式服務結果。
- 使用者能新增、修改、刪除、切換任意命名環境，不限「本地／測試機」。內建 local 模擬環境唯讀，自訂環境最多 100 個。
- `CUSTOM_HTTP` 有 10 個公開／無 session 情境：health、JWKS、discovery、未知授權 client、redirect、state、token client、token Origin、缺少 session、錯誤回應標頭。
- 環境設定有 revision，預設保存於 ignored `.local/environments.json`，原子寫入、權限 0600；同一實例共用，不支援帳號權限隔離或多行程共用檔案。
- 結果依環境 ID／設定版本分開保存在記憶體，刷新清除結果；sessionStorage 只記錄選擇的環境 ID。修改後不沿用舊版結果。
- HTTP 模組固定 origin／端點、手動 redirect、不轉送 cookie／token；每情境最多 4 個請求、至少間隔 500ms、5 秒逾時、64 KiB 回應上限。429 會停止批次並進入等待期。
- redirect／state 先檢查合法設定，不能因 client 未登記回 400 就誤報通過。合法對照可能建立短期 OAuth 交易，未跟隨 provider，記錄 `cleanup: server-expiry`。
- 介面已有側欄、環境卡片、統計、實測進度、搜尋、逐筆可展開證據、手機排版與長表單固定操作列。
- CSS／JS／API 已改用相對路徑；直接預覽或靜態主機缺少 API 時會顯示啟動／OFFLINE 提示。根路徑與代理子路徑均已驗證。

### 目前操作流程

1. 優先讓使用者下載 Windows ZIP、解壓雙擊 EXE：程式自動開啟自己電腦上的服務與瀏覽器。從原始碼執行才需要 Node；若選雲端網站，則另需真正可達的部署／轉送入口。
2. 選模擬環境，或建立 HTTP 環境並填入目標網址；部分檢查需目標已登記的 client ID、Origin、redirect URI。
3. 執行單項或全部情境，核對 PASS／FAIL／INCONCLUSIVE／ERROR、具體斷言與遮罩後的請求／回應。
4. 匯出目前環境的 JSON／Markdown；模擬通過不代表 HTTP 目標通過，HTTP 無 session 檢查不代表真正登入／D1／撤銷通過。

### 進行中（別人正在做，請避開）

本輪開始時工作樹乾淨，未發現 repo 內登記的他人進行中事項。但 open PR 未確認，不能宣稱沒有人在做。

`git ls-remote --heads origin` 查到 main 及 5 條 feature 分支：`feature-oauth-security-lab`、`feature-complete-simulation-suite`、`feature-environment-manager`、`feature-dashboard-polish`、`feature-fix-resource-loading`。main 歷史包含相應 merge commits；保留分支不代表尚未合併，也不能推斷仍有人負責。接手時重查，不自行刪除。

本輪中途 fetch 發現 main 已合併 PR #1（`3b9b99b`，另一位 agent 的 Node 24 JWKS 相容性修正），已 merge 進程式基準，保留其變更與 `.nvmrc`（24.5.0）。open PR 仍無法確認。

上述分支清單為本輪初始觀測；其後新增本輪 Windows feature 分支，接手應再查最新遠端 heads。

本地 origin fetch refspec 僅追蹤 main，因此只看 `git branch -r` 會漏掉其他遠端 head。

### 已知問題、沒測過的部分

1. **雲端 localhost 與使用者 localhost 是不同位置。** 原始碼 CLI 只監聽 `127.0.0.1`，預設 PORT 為 3000。請勿再把雲端本機位址當成使用者電腦可直接開啟的網站。
2. Host 只接受 localhost／127.0.0.1 加 port；寫入 Origin 必須等於由 HTTP Host 組成的來源。公開 HTTPS／容器綁定／代理尚未相容，不能只改 listen 或移除檢查。
3. 現在無登入／帳號隔離。對外開放前須決定受限入口或網站存取控制；Host／Origin 檢查不是使用者驗證。
4. 環境設定是單實例檔案，結果／等待期在記憶體。雲端須考慮持久化磁碟、重啟、備份及多實例限制；不能將 ephemeral 檔案當成永久資料庫。
5. 模擬器會建立 Node loopback HTTP server，不能把目前程式原封不動放到純靜態主機，亦不能假設與 Workers 執行模型相容。
6. GitHub API open PR 查詢回 Forbidden；本輪無法確認 PR／遠端 CI。Git HTTPS fetch／ls-remote 成功。不要因此要求使用者提供 GitHub token，也不要假稱已建立 PR。
7. 真實 Google 登入、遠端 D1、正式 HTTPS／跨站 cookie、帶 session 的遠端輪替／撤銷均未在本輪驗證。
8. `src/http-runner.js` 將 Retry-After 最長設為 3600 秒；超過一小時的等待行為尚未有對應測試，不能宣稱所有長等待皆完全遵守。
9. 沒有 TypeScript typecheck 或獨立 lint／formatter 腳本；`npm run check` 是 JS 語法檢查。不要把它回報成型別／lint 通過。

### 檢查結果（盤點與新增可攜式後的實跑結果）

環境版本：Node `v24.19.0`、npm `11.9.0`。目前程式基準的 `package.json` 要求 Node >=24.5.0，啟動使用 `--use-env-proxy`；建置先 `npm ci`。Windows CI 固定 Node 24.19.0；最終使用者不需 Node。

| 指令／檢查                                                                           | 本輪結果                                                                                                                                |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`、HEAD 與 origin/main                                              | 初始均為 702dad4；中途納入 main 的 3b9b99b，再驗證可攜式程式基準                                                                        |
| `git status -s`（開始時）                                                            | 乾淨                                                                                                                                    |
| `git log --oneline -15 origin/main`、`git branch -r`、`git ls-remote --heads origin` | 已執行；分支限制見上文                                                                                                                  |
| `gh pr list --state open`（指定本 repo）                                             | Forbidden；PR 與遠端 CI 未確認                                                                                                          |
| `npm run check`                                                                      | 最新通過，24 個 JS 模組；只是語法檢查                                                                                                   |
| `npm test`                                                                           | 最新 61 通過，0 失敗／跳過／取消                                                                                                        |
| `npm run test:browser`                                                               | 完整流程通過：搜尋／空結果、證據展開、分類、單次／全部、取消、報告、手機、環境 CRUD／持久化／結果隔離；模擬結果 22 PASS／1 INCONCLUSIVE |
| `npm run test:resources`                                                             | 6 項通過；1 項 file: 渲染因管理政策跳過。包含靜態主機 OFFLINE、相對檔案引用、代理子路徑及實際 rotation                                  |
| `npm ci`                                                                             | 鎖定安裝通過                                                                                                                            |
| `npm run build:portable`、Linux 單檔 `--smoke-test`                                  | 建置與實際執行通過                                                                                                                      |
| `npm run test:portable`                                                              | repo 外啟動、內嵌 CSS／JS、23 情境、實際 runner 及設定保存通過                                                                          |
| `npm run build:portable -- --windows`                                                | 已產生 Windows x64 檔；格式／SEA／checksum 檢查通過，Windows 執行未確認                                                                 |
| `test:auth-service`／`test:auth-browser`／`test:auth-environments`                   | 本輪未重跑；需要另外可用的 auth-service checkout／相依套件，參閱 `docs/LOCAL_INTEGRATION.md`                                            |

現有文件記錄歷史 auth-service `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13` 的 51 個原有測試、11 組來源整合、10 個來源瀏覽器斷言及 10 個 HTTP adapter 情境通過。這些使用假 Google／記憶體 store，是歷史本機紀錄，不是本輪或正式環境驗收。不要假設先前 `/tmp` checkout、瀏覽器 profile 或行程仍存在。

## 相關程式與文件

| 檔案                                                                      | 為什麼要看                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `README.md`                                                               | 目前架構、Node 啟動與直接開 HTML 的限制                                 |
| `docs/STATUS.md`                                                          | 本輪進度、使用流程與完整待辦優先序                                      |
| `docs/ENVIRONMENTS.md`                                                    | 環境欄位、保存、revision、API 與網路限制                                |
| `docs/TEST_PLAN.md`                                                       | 測試範圍及明確未驗證事項                                                |
| `docs/LOCAL_INTEGRATION.md`                                               | 可選來源 fixture 整合與結果標示                                         |
| `package.json`、`package-lock.json`、`.nvmrc`                             | 引擎、鎖定 build 工具、腳本；不要把建置依賴當成使用者必須安裝的 runtime |
| `.github/workflows/ci.yml`、`.github/workflows/release.yml`               | 一般 CI 與 Windows 建置／EXE smoke／preview Release；發布結果仍須查證   |
| `src/server.js`、`src/application.js`                                     | CLI 與共用服務；Host／Origin／API／資源載入                             |
| `src/desktop.js`、`src/desktop-entry.js`                                  | 使用者設定目錄、可用埠、自動開瀏覽器與 SEA assets                       |
| `scripts/build-portable.mjs`、`scripts/lib/pe-signature.mjs`              | checksum、SEA／PE 打包與明確未簽章處理                                  |
| `scripts/portable-smoke.mjs`、`test/desktop.test.js`                      | 實際單檔介面與桌面 launcher 回歸                                        |
| `docs/WINDOWS-QUICKSTART.txt`、`docs/screenshots/portable-ui.png`         | 使用者一鍵執行方式與真實 Linux 單檔介面截圖                             |
| `src/environments.js`                                                     | 設定驗證、原子保存、100 個上限與版本衝突                                |
| `src/http-runner.js`                                                      | 真實目標 probe、請求邊界、等待期與前置條件                              |
| `src/runner.js`、`src/fixture.js`                                         | 模擬／斷言／遮罩；不是正式 auth-service                                 |
| `public/index.html`、`public/app.js`、`public/style.css`                  | 完整介面、相對路徑、啟動提示與結果隔離                                  |
| `test/server.test.js`、`test/environments.test.js`、`test/runner.test.js` | 目前安全與功能回歸，修改時保留斷言                                      |
| `scripts/browser-smoke.mjs`、`scripts/resource-loading-smoke.mjs`         | Chromium 操作與代理／資源載入驗證                                       |
| `.gitignore`                                                              | 本機設定、產物與機密檔案不可提交                                        |

## 參考寫法

- Node API 測試照 `test/server.test.js`；環境寫入競爭、錯誤 URL、取消／限流照 `test/environments.test.js`。
- 修改部署 Host／Origin 時，補合法 HTTPS 對照及未知 Host／外站 Origin 拒絕的測試，不只讓請求變成 200。
- 代理子路徑沿用 `scripts/resource-loading-smoke.mjs` 的完整資源與 API 驗證；不要只驗首頁 HTML。
- 介面證據使用 `public/app.js` 的 DOM／textContent 寫法；保留逐筆遮罩，不把目標回傳內容當 HTML 插入。

## 必須遵守的規則

本輪完整檔案搜尋未找到 Dashboard 的 `AGENTS.md`、`CLAUDE.md`、`CONTRIBUTING.md`、設計或決策規則檔。不要把另一個 auth-service repo 的規則冒充本 repo 規則；若接手時新增規則檔，先讀。

- 分支與合併：repo 未定義額外規則。依當下使用者授權；通常用獨立分支與 PR，不 force push、不繞過保護或必要 CI。本文件不轉授歷史會話的合併／部署權限。
- push 前驗證：現有一般 CI 是 `npm ci`、`npm run check`、`npm test`；Windows Release CI 另建置／執行 EXE smoke。介面或資源路徑變更另跑對應 Chromium 腳本；記錄通過、失敗、跳過與未跑，不用零測試／PID 代替驗收。
- 程式慣例：沿用原生 ESM、現有模組分工與雙引號格式；不為了部署準備自行遷移框架。專案目前沒有 formatter 設定或格式腳本。
- Commit／PR：repo 沒有指定格式；歷史使用英文祈使句標題。建議描述具體行為、驗證及限制，文件跟同一項變更一起更新；不要捏造 PR 或部署連結。
- 機密與安全：保留 proxy、CA 與 TLS 驗證；只記錄設定名稱，不放 credential 值，不要求把 secret、cookie、token 或私鑰貼到對話。不修改正式身份／allowlist 來讓測試過關。
- 保留既有工作；不 reset／clean／覆寫未提交檔案，不為「環境準備」另建 worktree，除非使用者要求。

## 相關決定

已確認的實作選擇是：Node + 原生 ESM、前後端同服務、單實例檔案保存、預設隔離模擬器、可自建多個 HTTP 環境、結果依環境與 revision 隔離、固定端點／有界請求、未滿足前提為 INCONCLUSIVE。

雲端供應商、域名、付費方案、TLS／代理、網站登入控制、多使用者資料隔離與永久儲存尚未定案；不要從 auth-service 使用 Cloudflare 推導 Dashboard 必須部署 Cloudflare。靜態 Pages 不會自動提供目前 Node 後端。

## 待辦與遇到不確定的事

| 優先序 | 下一步                | 可先做的獨立工作／需要定案的部分                                                                                   |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P0     | Windows 預覽交付      | 確認 v0.2.0-preview.1 的 Windows CI、Release 資產、使用者實際雙擊／自動開頁；本機 Windows 交叉成品不等於已實機測試 |
| P2     | 可對外使用的部署方案  | 盤點 Node、loopback、Host／HTTPS Origin、代理與磁碟需求，提出可審查方案；供應商／網址／存取方式由使用者定案        |
| P2     | 部署相容性與外部驗收  | 保留拒絕錯誤來源與既有 61 測試；準備程序／重啟／持久化流程。真正發布需當下授權與實際外部網址驗收                   |
| P2     | 網站存取及資料隔離    | 現在設定共用、無帳號模型；先釐清私人工具或多使用者服務，不直接公開一個無權限模型的 runner                          |
| P1     | 帶登入 session 的整合 | 先決定隔離身份及 session 注入／清理，再測 Google／D1／輪替／撤銷；不要偽造正式憑證或動到真實用戶                   |
| P1     | 長 Retry-After        | 檢查 3600 秒截斷是否提早重試，補真正較長等待的控制／時鐘測試                                                       |
| P1     | Windows 發行品質      | 正式程式碼簽章／憑證、安裝或自動更新、單一實例、ARM64 皆未實作；先依使用者需求決定，不能聲稱已完成                 |
| P2     | 維護與技術選型        | TypeScript／框架／資料庫遷移尚非已決定需求，只有確認實際需要後才做                                                 |

需要使用者後台操作、付款或機密時，說明所需設定與用途，完成其他獨立工作後再請對方處理；不能靠沉默取得授權。無法確認的公開網址、PR、CI、Google、D1 一律標記未確認。

## 完成後

- 依接手當下任務與授權提交可審查的變更，列出實際測試與外部驗收結果；沒部署就明確說沒部署，不給使用者雲端 localhost 當公開入口。
- 同步更新 `docs/STATUS.md`，將所做的待辦移到已完成，保留尚未定案／未驗證事項。
- 這份是單次交接文件，完成這次接手任務後刪除 `docs/handoff.md`；要再次交接時重新產生，不把舊文件當長期進度來源。
