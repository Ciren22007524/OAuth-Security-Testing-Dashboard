# 測試計畫

## 自動驗證

使用 `npm test` 執行 Node test runner。情境逐一執行並驗證非空斷言、實際請求預算、清理與遮罩。另以刻意允許錯誤 redirect 的 fixture 驗證測試能產生 FAIL，而非固定顯示成功。

測試涵蓋有效授權與 callback 正向流程、錯誤 client、四種 redirect 變體、state 空值／長度、callback cookie 不符／缺少／重播／到期、token Origin、session 缺少／錯誤／到期、並行 rotation、30,000ms 寬限與 30,001ms 撤銷、ES256 payload／signature／issuer／audience／expiration。亦驗證取消、未知情境、報告遮罩與控制 API 的跨 Origin／外部 target 拒絕。

HTTP 端對端測試啟動真實 loopback dashboard 與 fixture，取得 assets、catalog 並透過 API 執行情境；不僅檢查 port 或 PID。

## 手動介面驗證

已安裝 Chromium 時執行 `npm run test:browser`（預設 `/usr/bin/chromium`，可用 `CHROMIUM_PATH` 覆寫）。此測試使用 Chromium DevTools Protocol，不安裝外部套件；在一次性 profile 中檢查分類、單次／全部執行、兩種報告下載、取消、刷新清除結果、手機無水平溢出及瀏覽器例外。執行後輸出的暫存目錄保留畫面與下載報告。容器中使用 `--no-sandbox`，僅瀏覽這次測試的 loopback 儀表板；不能將此測試用於任意外部頁面。

啟動 `npm start`，檢查分類、單一／全部執行、停止、選擇歷史結果、統計與 JSON / Markdown 下載。下載內容應有環境、時間、情境版本、請求證據、斷言、清理與限制。刷新頁面應清除結果，不應在 browser storage 保存 token。未安裝瀏覽器自動化時，不得宣稱已驗證互動或畫面呈現。

## 不在目前驗證範圍

已唯讀核對 auth-service commit `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13`：client state 上限 512、provider state 由伺服器產生、`__Host-oauth_state` 的 10 分鐘交易、callback 到期導回 `login_expired`，以及寬限期內不再次換 cookie。模擬器沿用這些邊界，但以 JSON 正規化錯誤（正式 authorize / callback 使用 HTML），省略清除 cookie、真實 provider、D1、PKCE 與身份 allowlist。它仍不能當成 production 測試結果。

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
