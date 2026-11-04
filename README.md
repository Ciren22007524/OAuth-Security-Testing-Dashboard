# OAuth-Security-Testing-Dashboard

以可追溯的 HTTP 證據學習與測試 OAuth 協定的本機安全實驗台。介面採繁體中文，包含情境分類、斷言結果、遮罩後的請求／回應、取消執行與 JSON / Markdown 報告。

## 啟動

需要 Node.js 24.5 以上；目前無第三方相依套件，無須安裝套件或設定任何憑證。

```sh
npm start
```

請在瀏覽器輸入啟動訊息中的本機位址（預設 `http://localhost:3000`）。**不要直接雙擊 `public/index.html` 來執行測試**：HTML 只是前端入口，測試與環境設定需要 Node API。直接開檔僅可預覽樣式，會顯示尚未連接執行器；靜態主機也不會提供測試 API。

CSS、JavaScript 與 API 使用相對路徑；若部署在子路徑，反向代理需將該前綴下的資源與 API 一起轉送 Node 服務，並保留對外 Host／Origin 的一致性。

服務只綁定 loopback，預設埠號 3000，可用 `PORT=3001 npm start` 調整。預設使用本機模擬器；使用者可自行新增、管理及切換多個 HTTP 或模擬環境，詳見 [環境管理](docs/ENVIRONMENTS.md)。儲存 HTTP 環境不會立即連線，執行時才測試所選目標。雲端 onboarding 不提供 localhost 預覽連結；可透過本機 HTTP 請求驗證服務。

```sh
npm run check
npm test
# 已安裝 Chromium 時，另可驗證完整介面流程
npm run test:browser
```

## 可驗證的範圍

23 個情境涵蓋 client / redirect / state 驗證、callback cookie 與重播、Origin、refresh session 過期、並行輪替、30 秒重用寬限與撤銷、單裝置／全裝置登出、JWKS／discovery、限流、錯誤處理及安全標頭盤點。每個 HTTP 情境啟動自己的隔離模擬器；時鐘可注入，不必等待 30 秒。結果為 PASS / FAIL / INCONCLUSIVE / ERROR。缺少一般安全標頭僅列建議，不直接宣稱可利用漏洞。

**SIMULATION 通過不代表正式 auth-service 通過。** 模擬器是明確定義的協定 fixture，不是從私有服務複製的實作。Token endpoint 產生的是 opaque fixture 值；JWT 驗證情境另用 Node crypto 產生本機 ES256 簽章。JWT 驗證不是 `/token` 的職責。

儀表板內的瀏覽器 CORS 情境仍回報 INCONCLUSIVE，不會自動把其他環境的結果混入模擬結果。另提供可選的真實 auth-service 原始碼整合與 Chromium CORS 指令，詳見 [本機整合驗證](docs/LOCAL_INTEGRATION.md)。已驗證真實路由的 JWKS、discovery、logout、限流、並行輪替等行為；使用假 Google 與記憶體資料，不是正式 Google 登入或 D1 驗收。HTTP 環境提供 10 個公開／無 session 情境，結果標示 CUSTOM_HTTP，與模擬結果分開。執行 API 只接受已儲存的環境 ID，不接受臨時外部 URL。

## 隔離與證據

- 模擬情境最多 8 個請求，並行輪替最多 2 個；HTTP 情境最多 4 個請求且每目標至少間隔 500ms。Runner 一次只執行一個情境。
- 模擬情境使用獨立 session 狀態，完成後關閉 fixture。HTTP 檢查不帶 session，不執行登出／撤銷；redirect／state 合法對照交易由目標期限清理。
- Cookie、Authorization、token 與身份欄位於回傳前遮罩；不保存私鑰、不使用 analytics 或 localStorage，報告只由使用者下載。
- HTTP 證據保留實際 status、headers、body 與各項斷言。不能只因收到 401 / 403 就宣稱安全。
- 綁定 loopback，API 限制 Host 與 same-origin JSON，只測試已儲存環境的固定端點，不跟隨重新導向。

## 結構與後續工作

`src/fixture.js` 為協定模擬器，`src/runner.js` 為情境與報告，`src/server.js` 為控制 API，`public/` 為無框架介面，`test/` 為 Node 內建測試。

採用無相依套件的 JavaScript ES modules，而非交接文件建議的 React / TypeScript monorepo，以便目前環境可直接執行。語法檢查不是 TypeScript 型別檢查；現階段未提供獨立 lint / formatter。

詳見 [測試計畫](docs/TEST_PLAN.md) 與 [開發狀態](docs/STATUS.md)。已可建立自己的 HTTP 環境執行有界檢查；帶登入 session 的整合仍需隔離測試身份及額外設計，不能將模擬結果改標為實際目標結果。
