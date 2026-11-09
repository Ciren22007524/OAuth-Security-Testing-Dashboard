# 開發狀態

更新：2026-11-09

## 目前狀態（2026-11-09）

- `main` @ `e95b0a6`：已合併 PR #3（文件改用身份改寫後的新 commit 編號）與 PR #4（介面精簡、OIDC 攻擊模式、Array SSO／auth-service 整合）。遠端只剩 `main` 一條分支，沒有開著的 PR。
- 在 `e95b0a6` 上以 Node v24.22.1 重跑：`npm ci` 通過、`npm run check` 通過（43 個 JS 模組，只檢查語法）、`npm test` 86/86 通過。本輪沒有重跑瀏覽器、資源載入與 `test:integration`／`test:*-source`／`test:auth-*`。
- Windows 預覽：Release workflow run #1 在 Windows runner 完成檢查、建置與 EXE smoke test，結果 success；`v0.2.0-preview.1` 已發布為 GitHub 預發行版。仍沒有使用者在 Windows 實機雙擊執行的紀錄。
- GitHub API 已可使用：本輪實際查得 PR、Actions 與 Release 狀態，取代下方較早「回 Forbidden、未確認」的紀錄。
- 舊的完整專案交接文件 `docs/handoff.md` 已在 PR #4 合併後過時，本輪刪除；需要再交接時重新產生。

## 已交付免填參數的第一條整合流程（2026-11-06）

- 新增整合驗測模式，使用 A／B 各自的真實 auth-service／Array source 與 Chromium，自動註冊 confidential client、注入當次 secret、準備完整登入交易與 cookie；不用手填參數。
- 正常登入、後端 UserInfo、/api/me、cookie 屬性、本站登出及舊 session 401 已跑通；故意不撤銷 session 的負向控制可被抓出。UI 單項／批次與來源版號報告驗證通過。
- `npm run setup:integration` 取得固定來源與依賴；`npm run test:integration` 重跑正反向控制。來源由工具自己的 ignored 快取或一次指定的 checkout 提供，不修改上游。
- 更正前次 public client 假設：目前實際 source 要求 Array 後端 `SSO_CLIENT_SECRET`／Basic，runner 以隔離 DCR 自動處理，不把 secret 交給使用者搬動。
- 驗證：43 個 JS 模組語法檢查、86 個 Node 測試通過；A／B 各 10 個整合斷言、負向撤銷控制與取消清理通過，完整 Chromium UI／報告及 6 項資源檢查通過（file: 1 項受政策跳過）。
- 實際 Google／Cloudflare／網路 TLS 未驗收；跨 client、外洩能力、真正 RCE 隔離仍待做。說明見 `INTEGRATION_RUNNER.md` 與 `COMPROMISED_CLIENT.md`。

## 最新 review 與相容性修正（2026-11-06）

- 已更新查核 auth-service `337b1ce`、Array `fc79f38`，來源測試分別為 170 項／14 組通過；不是正式部署驗收。
- HTTP 環境新增標準 OIDC／Array session／舊版分流；discovery 動態端點與 RSA RS256，Array /api/me schema、cookie 遮罩與對應情境已接入。舊來源指令拒絕標準 OIDC checkout，新增 `test:auth-oidc-source`。
- 泛用資源需要成功識別欄位與 JSON 證據，避免 HTML／錯誤頁／WAF 假成功；支援 OIDC resource 參數與 public client none 認證。
- 工具 36 模組語法檢查、85 項 Node、完整 Chromium 流程與資源 6 項通過；file: 因政策跳過 1 項。
- 使用者指出手填參數操作繁瑣；建議保留獨立工作台，直接串接隔離的真實服務並自動準備 A／B 與交易，不把任意身分／攻擊控制放進正式 auth-service。
- 詳細差異見 `AUTH_SERVICE_REVIEW.md`，後續一鍵整合方向見 `TESTING_ARCHITECTURE.md`。一鍵服務啟動與多使用者瀏覽器流程尚未實作。

## 已找到並查核 Array 實際專案（2026-11-04）

- `Ciren22007524/array-line-demo` @ `7264cca`；目前預設為 `cloudflare/sso-test` Worker。`auth-service` 最新查核為 `4b5473b`，已是標準 OIDC，舊 JSON＋refresh cookie checkout 不再代表現況。
- Array client 為 `array`、認證 `none`、S256 PKCE；瀏覽器只有本站 HttpOnly session，`/api/me` 依 session 讀取使用者，沒有 Bearer token 登入分支。本站登出保留 issuer／Google SSO。
- 新增 `test:array-source`，針對 Array 真實 `createApp` 的既有隔離測試執行，9 組全通過；輸出 Git revision、計數與驗證範圍。未對正式網域發送驗測請求、未部署、未修改上游 repo。
- 契約、限流門檻、具體 callback／cookie／logout 情境與下一階段 adapter 見 `ARRAY_LINE_DEMO.md`；Dashboard UI 尚未接入專用 session／瀏覽器 adapter。

## 目前驗收方向：array-test × auth-service（2026-11-04）

- 本輪重新 review 驗測流程，新增 `ACCEPTANCE_FLOW.md`，明確區分設計、現有功能與尚未完成的實際整合；本輪沒有宣稱完成 array-test 驗收。
- 先補三個 P0：多角色目標與憑證路由、實際登入／token／cookie 契約 adapter、有效的正常登入與 API 資料對照；資源 2xx 不足以作成功證據，還需 API 契約驗證。
- 現有 10 個攻擊情境／80 項測試屬本機與 loopback fixture 證據；後續已找到 Array repo、名義來源與最新 source 契約；部署與真實登入仍未驗收。
- 第一個完整驗收切片固定為：正常登入 → 正常 API 對照 → 未登入／持有 token 比較 → 明確結果 → 遮罩報告。後續 callback、跨權限、輪替、瀏覽器跨站類情境依實際支援接入。

## 最新調整：10 個攻擊情境與獨立參數（2026-11-04）

- 移除共用憑證面板；依情境 schema 在右側產生獨立表單，環境只提供目標，不沿用其 client ID。每項草稿、結果各自隔離，修改只清除本項結果；目標／模式切換清除攻擊資料。
- 攻擊模式改為逐項執行，涵蓋 secret 取 token／讀資源／擴大 scope、access token 讀資源／UserInfo、refresh 交換／重用、授權碼交換／重播／省略 verifier，共 10 個實際操作。
- 重播、scope 與 PKCE 判讀使用有效對照；無效或過期原始憑證不能算成已證明防護。fixture 放寬這四種控制時可辨識為操作成功。
- 前端表單與後端校驗共用 catalog schema，非此情境的欄位會拒絕；憑證／個人資料不進報告，攻擊模式的環境表單只顯示目標設定。
- 本輪驗證：31 個 JS 模組語法檢查、80 個 Node 測試、桌面／筆電／手機完整流程及十項攻擊逐項執行、6 項資源載入檢查通過；file: 渲染仍因管理政策跳過 1 項。
- 完整操作、具體副作用、請求上限與未涵蓋範圍見 `ATTACK_MODE.md`。沒有執行正式 OIDC provider 驗收。

## 前一版：可切換防禦與攻擊模式（2026-11-04）

- 原有防禦模式及 23 個模擬／10 個 HTTP 情境保留，將集中條件鏈拆為獨立 handler 註冊表；模式也以註冊表派送，增加情境不需擴充主條件鏈。
- 新增持有 client secret 的兩項攻擊者能力模擬：取得 Bearer access token、以未登入對照確認能否讀取指定資源。支援同 origin OIDC discovery、client_secret_basic／post、scope 與 token 路徑設定。
- 能力結果獨立為 SUCCEEDED／BLOCKED／INCONCLUSIVE／ERROR，不反轉既有 PASS／FAIL；攻擊成功是否構成漏洞仍依 client 授權政策判讀。
- 臨時 secret 不進環境設定、storage、紀錄或報告；取得的 token 不回傳，不保留資源完整內容。憑證變更清空攻擊結果，離開模式／切換環境清除 secret。
- 本輪驗證：29 個 JS 模組語法檢查、72 個 Node 測試、完整桌面／筆電／手機 Chromium 流程與 6 項資源檢查通過；file: 渲染因管理政策跳過 1 項。防禦模擬仍為 22 PASS／1 INCONCLUSIVE。
- 未加入授權碼＋PKCE、使用者憑證與 session 攻擊；未執行正式 OIDC provider 或 Google 登入驗收。完整操作與限制見 `ATTACK_MODE.md`。

## 目前優先：本機 Web 與介面精簡（2026-11-04）

使用者改採下載原始碼，在自己的電腦啟動 Web 服務；Windows EXE 與雲端部署保留為選用方案，下方歷史優先序不代表目前阻擋項目。

- 移除同頁側欄、宣傳口號、重複統計與固定底列；以選環境、執行情境、查看結果為主。
- 情境清單不再展示可能被誤認為漏洞判定的 HIGH／MEDIUM；執行結果的 FAIL 與 ERROR 分開統計。
- 技術前提與執行紀錄預設收合；保留必要測試範圍說明、斷言與逐筆 HTTP 證據。
- 環境設定收進 header：平時只顯示環境名稱與目標摘要，點擊以 dialog 放大切換／管理，完整範圍說明保留在面板中。支援 Escape 關閉、焦點返回與手機寬度；新增／編輯關閉後回到環境面板，不推動工作區。
- 桌面採固定視窗高度的雙欄工作區：左側清單與右側結果各自捲動，搜尋與執行控制保留在原位；HTTP response 取消內層捲軸，長文字自動換行。手機維持自然頁面排版。
- 以實際 Chromium 滾輪驗證左右捲動隔離與邊界，長 response 在 1440×1100、1280×720 均不帶動整頁；展開執行紀錄不撐長頁面，切換情境重設結果捲動位置。
- 自動選取第一個情境，分類依目前環境提供，篩選後的詳情與選取同步；環境 CRUD、設定版本隔離及匯出維持原行為。
- 本機啟動方式與最新 Web 截圖見 README。此輪未重建或發布既有 EXE。
- 驗證：24 個 JS 模組語法檢查、61 個 Node 測試、完整桌面／手機 Chromium 流程及 6 項資源載入檢查通過；file: 渲染因管理政策跳過 1 項。模擬情境仍為 22 PASS／1 INCONCLUSIVE。

## 歷史交付：Windows 可攜式預覽（2026-11-04）

使用者在要求完整交接後，新增優先需求：提供可雙擊的 Windows Release EXE，先在自己電腦看介面，不先處理雲端網站部署。

- 已完成 Node SEA 打包：內嵌 runtime、CSS／JS／HTML、測試服務及授權；動態 loopback 埠、自動開瀏覽器，不需使用者安裝 Node 或操作 npm。
- Windows 環境設定保存到 `%LOCALAPPDATA%\OAuthSecurityLab\environments.json`；Linux 可攜式使用使用者 config 目錄，原始碼 CLI 仍用 `.local/`。
- 本輪新增共用 `src/application.js` 與 desktop 入口；原有 Node CLI／API 行為保留。已納入另一位 agent 的 main `31daf91`／PR #1 Node 24 JWKS 相容性修正，未覆蓋其 `.nvmrc` 與進度紀錄。
- 版本為 `0.2.0-preview.1`。Windows x64 EXE／ZIP 已在 Linux 交叉產生，驗證 PE／SEA 嵌入、官方 Node SHA-256、無失效的原廠簽章及 ZIP 完整性；這不是 Windows 執行驗證。
- Linux 單檔實際執行 smoke 通過；專案外啟動、內嵌樣式／JS、23 情境、實際單項測試與設定保存的 Chromium 驗證通過，截圖在 `docs/screenshots/portable-ui.png`。
- 最新語法檢查 24 模組、61 個測試通過；原根／子路徑、環境 CRUD 等瀏覽器流程也通過，file: 渲染仍為政策跳過。
- Windows Release 工作流程新增：在 Windows runner 執行檢查、建置及 EXE smoke，成功後才發布 tag 的 preview Release。本文件產生時 Windows CI／Release 結果未確認；不能宣稱已在 Windows 實機通過。
- 預覽版未程式碼簽章。正式簽章、安裝程式、自動更新、ARM64、單一實例協調均非已完成需求。請勿同時執行多個程式共用同一設定檔。
- 執行期仍只用 Node 內建模組；建置新增鎖定 esbuild／postject 開發相依套件與 package-lock，維護者用 `npm ci`，最終使用者直接執行 EXE。

## 本輪交接盤點（2026-11-04）

- 基準：`main` @ `ddad370f6660643d72933304cf89dde3b330667a`。本輪開始時 HEAD 與 origin/main 一致，工作樹乾淨；本輪只整理文件。
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

Windows CI 與預覽 Release 已確認成功（見上方「目前狀態」），只剩使用者雙擊操作結果待確認；下表的雲端部署是後續選項，不再阻擋先看介面。

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

（2026-11-04 紀錄）當時 GitHub API 查詢回 Forbidden，無法確認 PR／CI 狀態。2026-11-09 起 API 已可使用，PR #1 合併 commit 的 CI 經實際查詢為 success。

## PR #2 與分支整理（2026-11-04）

- PR #2 的 head 為 `136ad8561c807d149b3953e52d71c1ce755daebf`，只有 STATUS／handoff 文件，基準是較舊的 main。
- 保留 main 較新的完整專案／Windows 預覽交接，整合舊 PR 仍有效的待辦，不用舊專項交接覆蓋現況。本輪沒有修改應用或 CI 工作流程。
- 盤點時有 main、6 個已合併功能分支及 PR #2 交接分支。清理前已建立並驗證完整 Git bundle；確認 commit 可由 main 到達後才刪除分支，版本 tag 保留。

## Commit 身份改寫（2026-11-09）

- 依使用者要求，將 main 與 `feature-simplify-test-workspace` 歷史中的作者、committer 及 tagger 由個人 gmail 與 `Claude <noreply@anthropic.com>` 統一改為 GitHub noreply 身份 `JhongCiRen <157352341+Ciren22007524@users.noreply.github.com>`，並 force-push。檔案內容與 commit 數量不變，但所有 commit 編號都已改變；文件中引用的舊編號已改為新編號（例如 PR #1 合併 `3b9b99b` → `31daf91`）。
- `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13` 是 auth-service repo 的版本，不受影響。
- 未完成：tag `v0.2.0-preview.1` 推送被 GitHub 以 403 拒絕，仍指向改寫前的舊 commit；改寫後對應的 commit 為 `6efd8a9`，需由使用者在本機重推。PR #1、#2 頁面仍保留舊 commit。
- 其他電腦或 agent 的既有 clone 需重新 clone，或確認沒有未推送工作後再 `git reset --hard origin/<分支>`。

## 下一步

- 使用者在本機把 tag `v0.2.0-preview.1` 重推到改寫後的 `6efd8a9`（這是 gmail 唯一還留在 repo 中的地方）。
- 使用者在 Windows 實機雙擊 EXE，確認自動開啟介面與設定保存。
- **進行中（已交接給 Codex，見 `docs/handoff.md`）**：在來源整合 runner 加入 Array 負向情境——callback 缺登入 cookie、state 不符、callback 重播、logout 錯誤 Origin、logout 缺／錯 csrf，各自先建立有效對照再判讀，並盡量配一個 harness 層的負向控制。對應 `ARRAY_LINE_DEMO.md`「Dashboard 接下來的實作順序」第 3 點。Array 原始碼自身的測試（`test:array-source`）已涵蓋 state、重播與 ID token claims，這項是補 Dashboard 端的整合情境。
- 文件與測試對照（2026-11-09 盤點）：`npm test`（CI 執行）涵蓋攻擊模式 10 個情境與 4 個弱化控制、協定分流、環境管理與 23 個模擬情境；`test:integration`、`test:array-source`、`test:auth-oidc-source`、`test:browser` 需本機原始碼或 Chromium，不在 CI。`COMPROMISED_CLIENT.md` 的跨 client／外洩情境與 `ACCEPTANCE_FLOW.md` 的驗收清單仍未實作。
- 檢視一般 CI 是否改由 `.nvmrc` 讀 Node 版本：目前 CI 為 `24`、`.nvmrc` 為 `24.5.0`；Windows Release 固定 `24.19.0`。統一前需確認 SEA 建置與版本相容性，本輪未把這項工作標為完成。
- 帶 session 的遠端輪替／撤銷測試：需先決定隔離測試身份與 session 注入方式。
- TypeScript 型別檢查或 lint 是否需要另行決定，並非本輪分支清理的修改範圍。
- 雲端工具版本應以實際輸出為準；本輪使用 Node v24.19.0，不能沿用舊交接中「預設 Node 22」的描述要求使用者修改 PATH。
