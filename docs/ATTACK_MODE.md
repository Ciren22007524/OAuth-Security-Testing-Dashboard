# 模式與攻擊者能力模擬

環境與模式是兩個獨立選項：環境決定請求送到本地模擬或自訂 HTTP 服務；模式決定要驗證防禦控制，還是觀察攻擊者持有特定資料後的能力。

| 模式 | 操作與結果 |
| --- | --- |
| 防禦驗證（預設） | 原有 23 個隔離模擬／10 個 HTTP 情境；PASS、FAIL、INCONCLUSIVE、ERROR 的語意不變。 |
| 攻擊模擬 | 第一版模擬持有 client secret，記錄 SUCCEEDED（操作成功）、BLOCKED（本次請求被拒絕）、INCONCLUSIVE（證據不足／不適用）、ERROR（執行錯誤）。 |

攻擊成功表示完成了該操作，應依實際授權政策判讀影響。Client credentials 本來就可能允許 client 取得自己的 token；這本身不是使用者冒用或越權證據。

## 操作

1. 在 header 選擇環境。第一次可用「本地模擬」，不會連線到外部服務。
2. 把「模式」切成「攻擊模擬」，點「持有的憑證」。
3. 本地模擬可留白，會使用公開的 `demo-client`／`demo-secret`，允許 `read` scope，資源路徑預設 `/resource`。輸入錯誤 secret 或 `admin` scope 可觀察被阻擋的結果。
4. HTTP 環境填入測試用 client ID 與 client secret；ID 可沿用環境已登記的設定。選填 scope 與要讀取的資源路徑。
5. 執行單項或全部情境，檢視能力觀察、HTTP 狀態與已遮罩的證據，依需要匯出報告。

## 第一版情境

- **取得 access token**：讀取目前目標的 `/.well-known/openid-configuration`，使用宣告的 token endpoint，以 `client_credentials` 嘗試取得 Bearer access token。預設先選 `client_secret_basic`，其次 `client_secret_post`。Discovery 不支援這兩種認證時，不送出 secret。
- **讀取指定資源**：先送出未附憑證的 GET 對照，確認回 401／403，再取得 token 並帶 Bearer 重試一次 GET。公開資源或 404／5xx 等不明對照會標為待確認，避免把公開存取算成 secret 帶來的能力。

Token 情境最多 2 個請求；資源情境最多 4 個。只有 token 交換使用 POST；資源存取只做 GET。HTTP 請求間隔至少 500ms、每次逾時 5 秒、回應上限 64KiB，遇到 429 停止並依 Retry-After 等待。重新導向不跟隨。

## OIDC 的界線

OIDC 不保證支援 `client_credentials`，client secret 也不代表使用者 session。`unsupported_grant_type` 等標準拒絕會顯示本次操作被阻擋；不因此宣稱 provider 有漏洞或所有路徑安全。收到 `id_token` 只記錄是否存在，不驗證其簽章，也不宣稱已完成使用者登入。

目前 token 與資源端點須與所選環境同 origin，不會將憑證轉送到 discovery 指向的其他主機。若 issuer 使用 realm／租戶路徑，可直接指定 `/realms/example/protocol/openid-connect/token` 之類的 token 路徑，並指定認證方式；不填 token 路徑才讀取根目錄 discovery。外部 resource server、不同 origin 的 issuer、JSON 自訂 token API、mTLS、private_key_jwt 尚未支援。

尚未加入持有 authorization code、PKCE verifier、使用者 access／refresh token、session cookie 的操作，也沒有真正竊取憑證、瀏覽器 CSRF／CORS 或完整 OIDC conformance 驗證。

## 憑證與結果

- 憑證只在目前分頁輸入欄位與當次請求中使用；不寫入環境 JSON、sessionStorage、執行紀錄或匯出報告。後端不保存拿到的 token，也不回傳完整資源內容。
- 切換環境、離開攻擊模式或手動清除會清除 secret；重新整理回到預設防禦模式，不恢復憑證。
- 修改憑證、scope、認證方式或路徑會清空舊攻擊結果；防禦結果依環境與設定版本保留，不混入攻擊結果。
- 攻擊報告以 `-attack-report` 區分；包含模式、結果與已遮罩的能力證據。成功簽發的 token 未自動撤銷，會依目標自身的有效期與管理機制處理。

## 擴充程式

模式註冊在 `src/application.js`；防禦情境分別由 `src/simulation-scenarios.js` 與 `src/http-scenarios.js` 的 handler 註冊表派送，保留原有請求、斷言與 fixture。攻擊情境在 `src/attack-runner.js`，獨立使用 `src/attack-fixture.js`；不以改寫防禦結果或反轉 PASS／FAIL 模擬攻擊。
