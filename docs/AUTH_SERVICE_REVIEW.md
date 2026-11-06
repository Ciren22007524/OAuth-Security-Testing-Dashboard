# auth-service 階段完成後的工具調整

更新：2026-11-06。查核 auth-service `337b1ce`、array-line-demo `fc79f38`；這是原始碼版本，不等同正式部署或 D1 migration 已驗證。

## 本輪發現與已修正項目

| 問題 | 已完成調整 |
| --- | --- |
| 舊 HTTP 模式固定 /authorize、/token、/jwks 與 ES256，會誤報新版服務 | 環境新增服務協定：auth-service 標準 OIDC／Array session／舊版相容。新版沿 discovery 的實際端點驗 RSA RS256、S256，不把舊路由套上去。 |
| 所有 HTTP 服務都顯示相同攻擊情境 | 新版 auth-service 顯示 7 個標準 token／code／PKCE 情境，不提供未支援的 client_credentials；Array 提供 3 個 session 情境。模擬與舊版保持既有 10 項。 |
| Array 不接受前端 Bearer 登入，但工具把 token 當主要憑證 | Array 以 /api/me 的 JSON user.sub、有效 expiresAt 與 login_required 判讀。支援未登入、偽造 cookie、持有指定本站 session 的有限 GET 操作；cookie 不傳 issuer。 |
| 泛用資源只憑 2xx 判成功 | 改為 JSON 格式＋明確的資料識別欄位；HTML、錯誤 JSON、WAF、欄位缺少與過期 Array session 不算操作成功。 |
| 舊來源測試仍呼叫過時 JSON／cookie API | 新增 `test:auth-oidc-source` 跑最新來源完整測試；舊三項來源整合指令遇到標準 OIDC checkout 會明確停止並指引新指令。 |
| 新版有 api resource、public client none 認證 | 授權碼／refresh 情境提供選填 resource origin；公開 client 無 secret 時可依 metadata 選 none。resource 是請求參數，不是自動跨 origin 轉送憑證的目的地。 |
| 金鑰或資料錯誤可能洩漏到證據 | RSA 私鑰欄位（含 oth）、session cookie、token 遮罩；Array 身分只記錄結構布林值，不輸出個人資料。 |

現有 HTTP 環境沒有 protocol 時仍按舊版處理，不偷偷改變原有結果；要測新版，請編輯服務協定。新建 HTTP 預設為新版 auth-service，Array 要明確選 Array session。切換協定會更新環境 revision，舊結果不當成目前結論。

## 最新 auth-service 還有哪些必測邊界

來源已新增 client 建立者管理、scope 設定、secret 輪替與 login_events。完整 170 項來源回歸已涵蓋相關規則；Dashboard 尚未提供這些管理操作的正式站自動攻擊流程。

- 擁有者 A／B：不能列出、查看或修改對方 client；非擁有者與不存在 ID 都回 404。需先建立 A／B 的合法對照，不能拿無效登入當成隔離證據。
- scope：openid 固定，email／profile／offline_access／api 由註冊選擇；沒有 api 不能拿 API resource JWT，沒有 offline_access 不開 refresh grant。
- scope 變更撤銷舊 Grant、Code、RefreshToken 與不透明 AccessToken；已簽發 JWT 仍可能有效至 exp，不能誤報為撤銷失效。
- secret 輪替：舊 secret 無法用於新驗證，新值只顯示一次；不自動撤銷已簽發 token。應以可拋棄 client 測試，不對使用者既有正式 client 自動輪替。
- 註冊／管理頁：有效登入、Origin、owner、版本與 active user；舊表單／並行修改 409，不能被工具當網路錯誤自動重送。
- migration 0005／0006、舊 client 歸屬、正式部署與真實 Google 登入須另行核對。來源測試不能證明遠端資料已遷移。

## Array 的最新差異

Array `fc79f38` 在後端呼叫 UserInfo，核對其 sub 與 ID token 一致，再取 email／name。metadata 必須包含可信的同 origin userinfo_endpoint；token 仍不交給瀏覽器。

SSO_CLIENT_ID 已不再固定在 wrangler vars；應採用實際部署的註冊 client ID，不能再硬編碼 `array` 當作正式識別碼。來源測試中的 `array` 是隔離 fixture，不代表部署設定。原始碼來源回歸已由先前 9 組增為 14 組。

## 重跑指令與本輪證據

```sh
# auth-service checkout 先依 lockfile 安裝依賴
# pnpm install --frozen-lockfile
AUTH_SERVICE_PATH=/path/to/auth-service npm run test:auth-oidc-source

# array-line-demo checkout 先 npm ci
ARRAY_DEMO_PATH=/path/to/array-line-demo npm run test:array-source

# 工具本身
npm run check
npm test
npm run test:browser
npm run test:resources
```

本輪：工具語法檢查 36 模組、85 項 Node 測試、桌面／筆電／手機 Chromium 流程通過；資源 6 項通過，file: 渲染因管理政策跳過 1 項。auth-service 170 項來源測試、Array 14 組來源測試通過。

來源驗證採隔離 provider／資料，不讀寫正式服務、不登入 Google、不輪替正式 secret、不執行遠端 migration。

## 下一階段的操作方向

[獨立整合工作台設計](TESTING_ARCHITECTURE.md)：日常只選環境、使用者 A／B 與情境，runner 自動準備 fresh state／nonce／verifier／code／cookie；各 repo 保留原生測試。手填 token 等欄位收為進階覆寫。

本輪完成的協定適配與來源回歸，是這條路的基礎；一鍵多服務／多身分瀏覽器整合尚未交付，不把目前手動 session GET 或 CLI 測試聲稱為完整整合工具。
