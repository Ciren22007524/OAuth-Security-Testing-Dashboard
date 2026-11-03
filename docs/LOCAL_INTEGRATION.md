# 真實 auth-service 的本機整合驗證

這兩個指令執行使用者指定 checkout 的真實 Hono 路由。使用上游既有 `src/test-helpers.ts`、假 Google provider、記憶體 store 與注入時鐘，不呼叫 Google 或遠端 D1，不修改 auth-service 的原始碼、client allowlist 或部署設定。

## 準備

需要 Node.js 24、auth-service 本機 checkout 及其鎖定相依套件；瀏覽器驗證另需 Chromium。使用既有 checkout，無須建立 worktree。

在 auth-service 根目錄安裝：

```sh
pnpm install --frozen-lockfile
pnpm test
```

本次參考副本位於 `/tmp/oauth-auth-service-review`，checkout 為 `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13`；其 51 個原有測試通過。這是暫存路徑，不保證新機器存在。新的工作階段請使用自己的 checkout 路徑；不應依賴先前的暫存檔或行程。

## 路由與簽章整合

在 Dashboard 根目錄執行：

```sh
AUTH_SERVICE_PATH=/tmp/oauth-auth-service-review npm run test:auth-service
```

11 組情境驗證：授權參數、callback state／重播、token client／Origin、30 秒輪替邊界與撤銷、真實並行輪替、單裝置／全裝置登出、拒絕跨 Origin 登出、metadata／JWKS／JWT 簽章、限流恢復與 malformed JSON。每組最多 12 個請求，狀態互相隔離；這些是 Hono in-process 請求，不是遠端部署或真實 D1 測試。

輸出標為 `LOCAL_SOURCE`，記錄實際 source commit、情境版本、時間、斷言、遮罩後的請求／回應與清理。若需要完整 JSON，額外指定 `REPORT_PATH` 為尚不存在的檔案；檔案以 0600 權限建立，不覆蓋既有檔案。

```sh
AUTH_SERVICE_PATH=/tmp/oauth-auth-service-review \
  REPORT_PATH=/tmp/auth-source-new-report.json npm run test:auth-service
```

## 真實瀏覽器 CORS

```sh
AUTH_SERVICE_PATH=/tmp/oauth-auth-service-review npm run test:auth-browser
```

可用 `CHROMIUM_PATH` 指定 Chromium 執行檔，`REPORT_PATH` 匯出只含安全觀測資料的 JSON。腳本在 loopback 建立三個一次性 server：授權網頁、未授權網頁與真實 Hono HTTP bridge；只把一次性記憶體測試 session 放入獨立 Chromium profile，完成後刪除 profile 並關閉所有行程。

10 個斷言驗證 cookie 是否被接受、授權 Origin 可讀 token、preflight、瀏覽器確實送出 cookie、HttpOnly、未授權 Origin 無法讀取、被拒 preflight 不發出 POST、session 保留與到期後可讀取 login_required。報告標為 `LOCAL_SOURCE_BROWSER`，不匯出 cookie 或 token。

此測試在容器中使用 `--no-sandbox`，僅瀏覽本次 loopback 網頁。localhost 不同 port 是不同 Origin，但仍是 same-site；Chromium 對 loopback 的 Secure cookie 例外不能證明正式 HTTPS、跨站 SameSite 或實際 Google 登入正確。這些限制保留在每份報告中。

## 需要外部設定的部分

Live 模式目前尚未開放。要連 staging，先決定獨立測試 URL、已登記的 client_id／Origin 與隔離身份，再加上明確的主機白名單及流量限制。正式 Google、遠端 D1 與現有用戶 session 不在這兩個指令的操作範圍。
