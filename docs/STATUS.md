# 開發狀態

更新：2026-11-04

## 最新交付優先：Windows 可攜式預覽（2026-11-04）

使用者在要求完整交接後，新增優先需求：提供可雙擊的 Windows Release EXE，先在自己電腦看介面，不先處理雲端網站部署。

- 已完成 Node SEA 打包：內嵌 runtime、CSS／JS／HTML、測試服務及授權；動態 loopback 埠、自動開瀏覽器，不需使用者安裝 Node 或操作 npm。
- Windows 環境設定保存到 `%LOCALAPPDATA%\OAuthSecurityLab\environments.json`；Linux 可攜式使用使用者 config 目錄，原始碼 CLI 仍用 `.local/`。
- 本輪新增共用 `src/application.js` 與 desktop 入口；原有 Node CLI／API 行為保留。已納入另一位 agent 的 main `3b9b99b`／PR #1 Node 24 JWKS 相容性修正，未覆蓋其 `.nvmrc` 與進度紀錄。
- 版本為 `0.2.0-preview.1`。Windows x64 EXE／ZIP 已在 Linux 交叉產生，驗證 PE／SEA 嵌入、官方 Node SHA-256、無失效的原廠簽章及 ZIP 完整性；這不是 Windows 執行驗證。
- Linux 單檔實際執行 smoke 通過；專案外啟動、內嵌樣式／JS、23 情境、實際單項測試與設定保存的 Chromium 驗證通過，截圖在 `docs/screenshots/portable-ui.png`。
- 最新語法檢查 24 模組、61 個測試通過；原根／子路徑、環境 CRUD 等瀏覽器流程也通過，file: 渲染仍為政策跳過。
- Windows Release 工作流程新增：在 Windows runner 執行檢查、建置及 EXE smoke，成功後才發布 tag 的 preview Release。本文件產生時 Windows CI／Release 結果未確認；不能宣稱已在 Windows 實機通過。
- 預覽版未程式碼簽章。正式簽章、安裝程式、自動更新、ARM64、單一實例協調均非已完成需求。請勿同時執行多個程式共用同一設定檔。
- 執行期仍只用 Node 內建模組；建置新增鎖定 esbuild／postject 開發相依套件與 package-lock，維護者用 `npm ci`，最終使用者直接執行 EXE。

## 本輪交接盤點（2026-11-04）

- 基準：`main` @ `702dad4d8a19d0902ee61916d4172aeac0d83dd9`。本輪開始時 HEAD 與 origin/main 一致，工作樹乾淨；本輪只整理文件。
- 實際工作目錄為雲端 `/workspace/OAuth-Security-Testing-Dashboard`。入口只監聽 `127.0.0.1`，Host 僅接受 localhost／127.0.0.1，寫入 Origin 以 HTTP Host 比對。
- 使用者自己電腦的 localhost 不是此雲端工作區。倉庫未提供已驗證的雲端部署設定或公開網址；不能把檔案預覽、Git 推送或本機測試稱為對外部署完成。
- 本輪重跑：語法檢查通過（17 個 JS 模組）；58 個測試通過，0 失敗／跳過／取消；完整 Chromium 操作流程通過（模擬測量 22 PASS／1 INCONCLUSIVE）；資源檢查 6 項通過、file: 渲染 1 項受政策限制跳過。
- `test:auth-service`、`test:auth-browser`、`test:auth-environments` 本輪未重跑；下方相關通過紀錄屬先前整合驗證，不是本輪新增的正式服務證據。
- Git HTTPS fetch／ls-remote 本輪成功；GitHub API 的 open PR 查詢回 Forbidden，因此目前 open PR 與遠端 CI 狀態未確認。origin fetch 只追蹤 main；ls-remote 另外查到 5 條 feature 分支，不能把它們當作尚未合併或有人正在開發的證據。

## 目前測試操作流程

1. 先有可連線的 Node 服務：本機執行須把 repo 放在使用者電腦；雲端執行則需真正可存取的部署／轉送入口。直接開 HTML 只預覽，不提供測試 API。
2. 選擇內建或自建模擬環境（23 個情境），或建立 HTTP 環境（10 個無 session 檢查）。後者部分情境需要目標已登記的 client ID／Origin／redirect URI。
3. 執行單一或全部情境，檢視 PASS／FAIL／INCONCLUSIVE／ERROR、斷言與遮罩後的逐筆 HTTP 證據。HTTP 合法授權對照可能建立短期 OAuth 交易，記錄 server-expiry，不跟隨 provider redirect。
4. 依環境與設定版本隔離結果，匯出 JSON／Markdown。模擬與來源 fixture 結果不等於正式 Google／D1／登入 session 驗收。

## 待辦優先序

目前 P0 先確認 Windows CI／預覽 Release 與使用者雙擊操作結果；下表的雲端部署是後續選項，不再阻擋先看介面。

| 優先序 | 工作                       | 前提與完成判準                                                                                                      |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| P0     | 決定對外使用方案與部署平台 | 使用者選擇私有遠端入口或受控公開網站、主機與網址；未確認前不擅自發布                                                |
| P0     | 準備 Node 雲端部署相容性   | 檢查可設定綁定位置、嚴格 public Host／HTTPS Origin、代理信任、持久化磁碟與單實例限制；不能只改成 0.0.0.0 或移除驗證 |
| P0     | 驗證真正外部入口           | 從使用者可達的 HTTPS 網址驗證樣式、API、環境保存、重啟及單一情境；本機 PID／health 不代表外部驗收                   |
| P1     | 決定網站存取與使用者隔離   | 現有環境設定同實例共用且無帳號隔離；Host／Origin 檢查不是登入機制                                                   |
| P1     | 設計登入後 session 測試    | 需隔離身份、已登記 client 與 session 提供／清理方式，不自動操作正式用戶                                             |
| P1     | 檢視長 Retry-After 等待    | 程式目前最多等待 3600 秒，尚未覆蓋更長值的行為，不能宣稱所有長等待皆完整遵守                                        |
| P2     | 後續維護選項               | JS 現在可運作；TypeScript／框架遷移並非已決定需求，不為交接自行重寫                                                 |

## 已實作

- 修正直接開啟 HTML 時的根路徑資源錯誤；CSS／JS／API 改用相對路徑，新增啟動失敗提示及 `/index.html` 入口。Node CLI 明確顯示應開啟的位址。
- 已驗證靜態主機缺少 API 時的 OFFLINE 提示，以及反向代理子路徑的樣式、JS、API 與 rotation 執行；雲端 Chromium 禁止 file:，直接開檔渲染測試明確跳過，另確認檔案相對引用均可解析。

- 介面改版：側欄導覽、環境卡片、狀態統計與實測進度；支援關鍵字搜尋及逐筆展開 HTTP 證據。手機版與長表單固定操作區已調整。

- 無第三方相依套件的 Node.js 24 儀表板與隔離模擬／自訂 HTTP runner。
- 使用者可新增、編輯、刪除及切換多個環境；設定保存於 ignored `.local/environments.json`，每個環境有獨立版本與結果。
- 自訂 HTTP 環境提供 10 個實際目標檢查，通過真實 Hono 本機 HTTP bridge 的全部 10 個情境。
- 瀏覽器驗證環境 CRUD、實際 HTTP 執行、結果隔離、設定持久化、版本變更與報告目標標記通過。
- 23 個情境；22 個可測量 fixture 行為，瀏覽器 CORS 回報 INCONCLUSIVE。
- 斷言、HTTP 證據、敏感欄位遮罩、清理、取消及記憶體內結果。
- 繁體中文暗色介面、分類、單一／全部執行、JSON / Markdown 匯出。
- Node 內建測試與 GitHub Actions 工作流程。
- 授權碼與 state / access_token / refresh_token URL 參數遮罩；API 拒絕注入測試用 fault 設定。
- 語法檢查、61 項自動測試、實際啟動 API 及 Chromium 介面操作驗證通過；情境測量為 22 PASS / 1 INCONCLUSIVE。完整證據範圍見 `TEST_PLAN.md`。
- 符合 `package.json` 宣告的 Node >=24.5 需求：新增 `.nvmrc`（24.5.0），並修正 jwks 控制退化在 Node 24 的相容性問題——注入私鑰材料的 fault 使 `createPublicKey` 在 Node 24 拋例外，現已將解析／驗證例外視為該斷言失敗，情境正確回報 FAIL 並附證據，不再變成 ERROR。Node 22 與 Node 24 皆 58/58 通過。

## 限制與下一步

- 已唯讀核對 auth-service `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13` 的規則、設計、authorize、callback、token、logout、cookie、session、D1 store 與相關測試；未修改該儲存庫，未對正式服務執行測試。
- 儀表板 Chromium 操作已驗證；另以真實 Hono 原始碼驗證 11 組本機整合情境及 10 個 Chromium CORS／preflight／HttpOnly 斷言，全部通過。auth-service 原有 51 項測試也通過。
- 本機 Chromium 使用 same-site localhost 與 Secure-cookie 例外，不能代表正式 HTTPS 或跨站 cookie 行為。正式 Google 登入與遠端 D1 仍待驗證。
- 已完成 20 種獨立控制退化驗證，以及 logout、JWKS、discovery、rate-limit、錯誤處理與快取標頭情境；缺少一般安全標頭列為建議。
- 本機來源整合與瀏覽器測試可重跑，分別標示 LOCAL_SOURCE 與 LOCAL_SOURCE_BROWSER；詳見 `LOCAL_INTEGRATION.md`。
- 已實作 CUSTOM_HTTP 目標設定、固定 origin／端點、500ms 間隔、有限預算、逾時、回應大小與 Retry-After 等待期；尚無帶 session 的遠端輪替／撤銷測試。
- 交接提出的 React / TypeScript 架構並非現有技術；目前使用 ES modules 及語法檢查，尚無 TypeScript 型別檢查或獨立 lint。

## 後續需要實際設定的部分

使用者可以直接在介面建立自己的 HTTP 環境，填入目標與已登記的 client／Origin／redirect URI，無須先固定只有本地或測試機兩種環境。操作與限制見 `ENVIRONMENTS.md`。

若要測試真實登入、正式 Google／D1 或帶 session 的撤銷，需要先決定隔離測試身份與 session 注入方式。這不阻擋目前的環境管理與無 session 檢查；不會自動變更正式 CLIENTS。機密不能貼到對話或寫入設定／報告。

GitHub API 網域仍被代理封鎖，無法建立 PR 或確認遠端 CI；Git 推送可用，先前已依使用者合併指示使用一般 merge commit 推送 main。
