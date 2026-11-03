# OAuth-Security-Testing-Dashboard

以可追溯的 HTTP 證據學習與測試 OAuth 協定的本機安全實驗台。介面採繁體中文，包含情境分類、斷言結果、遮罩後的請求／回應、取消執行與 JSON / Markdown 報告。

## 啟動

需要 Node.js 24 以上；目前無第三方相依套件，無須安裝套件或設定任何憑證。

```sh
npm start
```

服務只綁定 loopback，預設埠號 3000，可用 `PORT=3001 npm start` 調整。執行期間不連接外部目標。雲端 onboarding 不提供 localhost 預覽連結；可透過本機 HTTP 請求驗證服務。

```sh
npm run check
npm test
# 已安裝 Chromium 時，另可驗證完整介面流程
npm run test:browser
```

## 可驗證的範圍

14 個情境涵蓋 client / redirect / state 驗證、callback cookie 與重播、Origin、refresh session 過期、並行輪替、30 秒重用寬限與撤銷，以及本機 ES256 JWT verifier。每個 HTTP 情境啟動自己的隔離模擬器；時鐘可注入，不必等待 30 秒。結果為 PASS / FAIL / INCONCLUSIVE / ERROR。

**SIMULATION 通過不代表正式 auth-service 通過。** 模擬器是明確定義的協定 fixture，不是從私有服務複製的實作。Token endpoint 產生的是 opaque fixture 值；JWT 驗證情境另用 Node crypto 產生本機 ES256 簽章。JWT 驗證不是 `/token` 的職責。

真實瀏覽器 CORS 情境明確回報 INCONCLUSIVE。Google OAuth 登入、正式 D1、JWKS、discovery、logout 與實際 auth-service 的整合尚未驗證。現版本完全不開放 live target，不能透過 API 傳入外部 URL。

## 隔離與證據

- 單一情境最多 8 個 HTTP 請求，並行輪替最多 2 個請求；UI 每 250ms 最多開始一個情境。Runner 一次只執行一個情境。
- 每次執行建立全新 session 狀態，完成後關閉 fixture。撤銷測試只影響該 fixture。
- Cookie、Authorization、token 與身份欄位於回傳前遮罩；不保存私鑰、不使用 analytics 或 localStorage，報告只由使用者下載。
- HTTP 證據保留實際 status、headers、body 與各項斷言。不能只因收到 401 / 403 就宣稱安全。
- 綁定 loopback，API 限制 Host 與 same-origin JSON，無任意轉送與目標設定功能。

## 結構與後續工作

`src/fixture.js` 為協定模擬器，`src/runner.js` 為情境與報告，`src/server.js` 為控制 API，`public/` 為無框架介面，`test/` 為 Node 內建測試。

採用無相依套件的 JavaScript ES modules，而非交接文件建議的 React / TypeScript monorepo，以便目前環境可直接執行。語法檢查不是 TypeScript 型別檢查；現階段未提供獨立 lint / formatter。

詳見 [測試計畫](docs/TEST_PLAN.md) 與 [開發狀態](docs/STATUS.md)。Live 整合需先取得獨立測試 client、Origin 與隔離身份，重新核對 auth-service 原始碼，再實作明確目標白名單與授權機制；不能將模擬結果改標為 LIVE。
