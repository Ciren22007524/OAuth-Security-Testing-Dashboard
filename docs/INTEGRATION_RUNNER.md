# 免填憑證的來源整合驗測

更新：2026-11-06。已交付第一條完整流程：使用者 A／B 自動登入 → Array /api/me → 本站登出 → 舊 session 失效。不必填 client ID、secret、code、state、nonce、verifier 或 cookie。

## 第一次設定

從原始碼版執行，先安裝 Node.js 24.5 以上、Git，以及 Chrome／Edge／Chromium：

```sh
npm ci
npm run setup:integration
npm start
```

設定指令在 ignored `.local/integration-sources/` 取得固定、已測試的來源及鎖定依賴：

設定時會明確 fetch 指定 commit，再切換至該版本。若先前在 clone 後出現 `unable to read tree`，更新主專案後重跑 `npm run setup:integration` 即可接續只有 `.git`、尚未 checkout 的快取；已有檔案或版本變更的快取仍不會被覆寫。

- auth-service `337b1cec1b91cd0cf973ca5bc9ed520ee5e550ae`
- array-line-demo `fc79f38e064f57da7cdb37964f6366e376cf01ac`

不修改其他 checkout，也不部署服務。重跑不會覆寫被自行修改或換過版本的快取；安裝失敗會回報錯誤。已經有安裝依賴的 checkout 時，可在啟動工具前一次設定 `AUTH_SERVICE_PATH`、`ARRAY_DEMO_PATH`；找不到瀏覽器時設定 `CHROMIUM_PATH`。不需每次填情境參數。

## 日常操作

1. 開啟啟動訊息中的本機網址。
2. 「模式」選 **整合驗測（自動準備）**。
3. 選使用者 A 或 B，按「執行此情境」；或按「執行 A／B 完整流程」。
4. 看逐步斷言／角色與 HTTP 狀態，匯出 `oauth-integration-report.json` 或 Markdown。

本模式固定使用隔離來源，不使用原本選擇的 HTTP／正式站目標；環境切換暫時停用。尚未準備依賴時，介面提供設定提示並停用執行。舊防禦／手動攻擊模式仍保留，沒有移除原有情境。

## Runner 自動做的事

- 以兩個專案的真實 source 建立測試服務，註冊可拋棄的後端 client，當次 secret 直接注入 Array。
- 新版 Array 要求 `client_secret_basic` 與 PKCE；不能沿用前次文件對 public client 的假設。初始註冊採來源 fixture 的授權上下文，不宣稱已驗註冊管理頁的 Google 登入。
- 每項使用全新來源程序、記憶體 store、Chrome profile，以及使用者 A 或 B 的隔離身分。
- 真實 Chromium 從 Array 登入連結開始，經 auth-service Authorization Code＋S256、假 Google、callback、後端換碼與 UserInfo，建立本站 session。
- 驗證未登入 401、正確測試身分、資料效期、token 不下發、Secure／HttpOnly／SameSite=Lax，以及 JavaScript 不能讀 cookie。
- 透過原始頁面的 form 正常登出；保留 Array CSP，沒有開啟 CSP bypass。API 檢查用頁面導航，不在禁止 connect-src 的頁面注入 fetch 繞過限制。
- 驗證登出後瀏覽器 401，另向 app 重送先前 session，確認伺服器真正撤銷；issuer SSO cookie 刻意保留。
- 結束後關閉瀏覽器、來源 HTTP server／子程序並移除暫存檔。可停止，逾時有強制終止處理；強制終止與正常清理分開標記。

## 證據與驗證範圍

報告包含兩個 source Git revision、是否含未提交修改、測試身分代號、斷言、各角色 method／靜態 path／status；不記錄 query、cookie、code、token、secret、sub、email 或姓名。OIDC path 內交易 UID 也遮罩。後端 token／JWKS／UserInfo 的請求會列入紀錄與 40 次預算。

這是**真實應用原始碼＋真實 Chromium**，不是對兩套固定回應 API 自說自話。但 Google、資料 store、limiter 為測試替身，虛擬 HTTPS origin 由 CDP 導向來源 handler；不代表正式網路 TLS、Google、Cloudflare Durable Objects／D1、正式站部署或實際限流已驗收。只有 issuer 的 loopback 測試 server 會建立網路 listener，任意外部頁面請求會被中止。

## 重跑與負向控制

```sh
npm run test:integration
```

執行 A／B 完整流程，另刻意讓 Array 的 store 不撤銷舊 session，確認最後的重送檢查會回 FAIL；負向案例被偵測才算整套回歸通過；另檢查取消時會停止並清理來源。放寬開關只用於本地測試程式，不在 Dashboard API 暴露。

本輪兩個 persona 各 10 項斷言通過，負向撤銷控制能抓到失敗；完整 UI 可逐項／批次執行並匯出不含機密的來源報告。

## 作為「已被攻破的服務」

可將受測 client 包在同一專案，由控制台編排；詳見 [被攻破 client 的角色設計](COMPROMISED_CLIENT.md)。目前完成的是正常登入與對照；secret／token 外洩、跨 client、scope／輪替後繼續使用等後續自動化情境尚未加到這個 runner。
