# 測試計畫

## 自動驗證

使用 `npm test` 執行 Node test runner。防禦情境逐一執行並驗證非空斷言、實際請求預算、清理與遮罩。另以刻意允許錯誤 redirect 的 fixture 驗證測試能產生 FAIL，而非固定顯示成功。

測試涵蓋有效授權與 callback 正向流程、錯誤 client、四種 redirect 變體、state 空值／長度、callback cookie 不符／缺少／重播／到期、token Origin、session 缺少／錯誤／到期、並行 rotation、30,000ms 寬限與 30,001ms 撤銷、ES256 payload／signature／issuer／audience／expiration。亦驗證取消、未知情境、報告遮罩與控制 API 的跨 Origin／外部 target 拒絕。

HTTP 端對端測試啟動真實 loopback dashboard 與 fixture，取得 assets、catalog 並透過 API 執行情境；不僅檢查 port 或 PID。

## Array 真實來源驗證

執行 `ARRAY_DEMO_PATH=/path/to/array-line-demo npm run test:array-source`。最新查核 Array `fc79f38`，14 組既有來源測試通過，涵蓋真實 Worker 的登入、session、callback、claims、簽章、CSRF、登出及入口限流。OIDC fetch／store／limiter 為隔離替身，不代表正式 Google、瀏覽器 cookie 或 Cloudflare runtime 已驗收。契約與完整流程見 [Array 串接盤點](ARRAY_LINE_DEMO.md)。

## 攻擊模式驗證

`test/attack.test.js` 驗證本地與真實 loopback HTTP target 的 discovery、Basic／POST client 認證、token 交換及資源讀取。包括公開資源對照、OAuth 拒絕與不明回應分類、跨 origin endpoint 與重新導向不轉送憑證、反射 secret／token／Cookie 不出現在證據、請求上限、限流、取消與環境檔不保存憑證。另檢查防禦 catalog 的每項情境均有明確註冊 handler。

Chromium 流程逐項執行全部 10 個攻擊情境，檢查 schema 對應表單、草稿互不混用、修改只清除本項結果、必填校驗、環境 client ID 不繼承、攻擊報告遮罩、離開模式清除草稿，以及原有防禦結果隔離。

Node 測試也逐項對獨立 HTTP provider 執行所有情境，並以可重播 code、可重用 refresh、可省略 verifier、可新增 scope 的刻意弱化 fixture 驗證成功路徑；無效對照必須回 INCONCLUSIVE。正式 OIDC provider、Google 登入與完整 OIDC conformance 尚未驗證。

## 手動介面驗證

執行 `npm run test:resources` 補驗根路徑之外的載入方式：相對 CSS／JS 檔案引用、只有靜態檔而無 API 的明確 OFFLINE 提示、`/lab/index.html` 反向代理子路徑的資源與實際 rotation 執行，以及 Node `/index.html` 入口。這 6 個檢查通過；受管理 Chromium 禁止 file: 網址，因此直接開檔渲染列為 1 個跳過，不聲稱已在此瀏覽器完整驗證。

已安裝 Chromium 時執行 `npm run test:browser`（預設 `/usr/bin/chromium`，可用 `CHROMIUM_PATH` 覆寫）。此測試使用 Chromium DevTools Protocol，不安裝外部套件；在一次性 profile 中檢查關鍵字搜尋與空結果、分類、證據展開／收合、單次／全部執行、兩種報告下載、取消、刷新清除結果、手機無水平溢出及瀏覽器例外。執行後輸出的暫存目錄保留畫面與下載報告。容器中使用 `--no-sandbox`，僅瀏覽這次測試的 loopback 儀表板；不能將此測試用於任意外部頁面。

啟動 `npm start`，檢查分類、單一／全部執行、停止、選擇歷史結果、統計與 JSON / Markdown 下載。下載內容應有環境、時間、情境版本、請求證據、斷言、清理與限制。刷新頁面應清除結果，不應在 browser storage 保存 token。未安裝瀏覽器自動化時，不得宣稱已驗證互動或畫面呈現。

## 不在目前驗證範圍

已唯讀核對 auth-service commit `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13`：client state 上限 512、provider state 由伺服器產生、`__Host-oauth_state` 的 10 分鐘交易、callback 到期導回 `login_expired`，以及寬限期內不再次換 cookie。原有防禦模擬器沿用這些邊界，但以 JSON 正規化錯誤（正式 authorize / callback 使用 HTML），省略清除 cookie、真實 provider、D1、PKCE 與身份 allowlist。它仍不能當成 production 測試結果。

沒有連接正式 auth-service 或真實 Google、Cloudflare D1。沒有瀏覽器 CORS / SameSite / Secure cookie 的實證。模擬器已提供 logout、JWKS、discovery 與固定窗口限流；另有真實 Hono 原始碼與 Chromium 的隔離本機整合驗證，見 `LOCAL_INTEGRATION.md`。

已加入獨立控制退化矩陣：redirect、authorize client、state 長度、callback cookie、callback replay、token client、Origin、session、重複輪替 cookie、提前拒絕寬限，以及未撤銷後繼 session；另加入登出撤銷、全裝置登出、登出 client／Origin、JWKS 私密欄位、discovery 路徑、限流、stack 洩漏與敏感回應快取。各自停用單一控制後，情境必須產生 FAIL、保留 HTTP 證據並完成清理。fault 僅供本機測試注入，控制 API 拒絕此欄位。JWT 情境另以有效簽章對照竄改簽章／claims；尚未涵蓋所有可能的 verifier mutation。

## 本次驗證結果（2026-11-04）

- `npm run check` 通過語法檢查；非 TypeScript 型別或 lint 檢查。
- `npm test`：58 個測試通過，0 個失敗、跳過或取消；其中驗證 browser-cors 情境必須回報 INCONCLUSIVE。
- Chromium 操作驗證：22 個 PASS、1 個 INCONCLUSIVE、0 個 FAIL / ERROR；分類、單次執行、全部執行、停止、JSON / Markdown 下載、刷新清除結果、手機無水平溢出均通過，無瀏覽器例外。
- `npm start` 實際啟動，`/api/health` 回傳正常，透過 `/api/run` 執行 rotation 得到 PASS、3 筆 HTTP 證據與完整清理。
- 一般執行沙箱限制 socket 連線；本次 Git 與 loopback 驗證使用環境核准的執行方式，未關閉 TLS 驗證或更換憑證。

- auth-service `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13` 原有 51 個測試通過；追蹤檔案未修改。
- `test:auth-service`：11 組真實路由整合通過，包含真正的並行 token 請求；環境為 LOCAL_SOURCE。
- `test:auth-browser`：10 個實際 Chromium 斷言通過；環境為 LOCAL_SOURCE_BROWSER，仍不代表正式 Google／D1／HTTPS／跨站驗收。

## 環境模組驗證

- 設定持久化、100 個上限、同程序寫入佇列、版本衝突、唯讀預設環境、損壞設定拒絕覆寫、URL／機密欄位拒絕；已實際建立 100 個環境驗證第 101 個遭拒絕。
- HTTP runner 的有效設定對照、缺少／未登記設定的 INCONCLUSIVE、指定目標、遮罩、手動 redirect、429／等待期、取消及回應大小界限。
- Chromium：環境新增／修改／刪除、HTTP health 實際執行、切換保留各環境結果、修改後不沿用舊版本結果、重整保留環境與選擇、正確匯出目標與手機表單皆通過。
- `AUTH_SERVICE_PATH=/tmp/oauth-auth-service-review npm run test:auth-environments`：真實 Hono HTTP bridge 全部 10 個情境 PASS；假 provider／記憶體 store，不是正式服務驗收。
- `--use-env-proxy` 啟動方式下，本機模擬 rotation 與自訂 loopback health 均實際通過，未移除代理或停用 TLS。

## 可攜式預覽（2026-11-04 新增）

- 新增 desktop launcher、設定路徑、PE 未簽章處理測試後，最新 `npm test` 為 61 通過、0 失敗／跳過／取消；語法檢查為 24 個 JS 模組。
- `npm ci` 與 native SEA build 通過；Linux 單檔 `--smoke-test` 實際載入 HTML／CSS／JS、環境 API 與 rotation 並通過。
- `npm run test:portable` 在專案目錄外啟動真實單檔程式，驗證內嵌介面、23 個情境、實際 runner 與設定保存通過。
- 已將 main PR #1 的 Node 24 JWKS 修正納入並重新跑 61 個測試／重建；沒有覆蓋他人的修改。
- Windows x64 成品已交叉產生、核對 PE／SEA 與官方 Node checksum；未在本機執行 Windows EXE。Windows 工作流程通過才會發布 preview Release，狀態需查 GitHub，不能將本機 build 當作 Windows CI 通過。
- 原有根／子路徑與完整瀏覽器流程在共用服務拆分後已通過；新增 Node 24 相容性修正後再通過 portable smoke／browser，未改動前端外觀。

## 新版 auth-service 與協定分流

`AUTH_SERVICE_PATH=/path/to/auth-service npm run test:auth-oidc-source` 執行最新標準 OIDC 全套來源回歸；本輪 `337b1ce` 170 項通過。舊 JSON／ES256 三項來源指令遇到新版會停止並提供新指令。

`service-profiles.test.js` 檢查動態 RS256 JWKS、私鑰遮罩、跨 origin 拒絕、Array session cookie 與資料最小化，以及 HTML／錯誤 JSON／欄位不符不算 2xx 成功。瀏覽器測試包含協定保存、OIDC 排除 client_credentials、Array 切換為 session 專屬表單。
