# array-line-demo 實際串接盤點

後續更新（2026-11-06）：最新查核 Array `fc79f38`／auth-service `337b1ce`；Array 新增後端 UserInfo 與 sub 比對，部署用 SSO_CLIENT_ID 不再固定在 vars，來源測試已為 14 組。以下 `7264cca`／9 組為前次紀錄；目前以 [新版 review](AUTH_SERVICE_REVIEW.md) 為準。

查核日期：2026-11-04。這份文件依最新取得的原始碼，不再沿用舊版 auth-service 的 JSON＋refresh cookie 假設。

| 專案 | 查核版本 | 入口 |
| --- | --- | --- |
| [array-line-demo](https://github.com/Ciren22007524/array-line-demo) | `7264cca1268beff5ce00abcab0b1cdc4c61fd352` | 根 package.json 的 dev／build／deploy 均指向 `cloudflare/sso-test` Worker。 |
| [auth-service](https://github.com/Ciren22007524/auth-service) | `4b5473b50fca58d0cd0eb5fc025bc476af35a510` | 已採標準 OIDC，靜態登記 `array` public client。 |

來源版本不代表正式部署版本。此輪沒有對正式網域發送驗測請求、登入 Google、讀取正式 cookie、修改 Cloudflare 或上游原始碼。

## 已確認的角色與契約

- 應用來源：`https://array.cirenjhong.com`。
- 身分服務：`https://auth.cirenjhong.com`。
- client ID：`array`，認證方式 `none`，不需要 client secret。
- callback：`https://array.cirenjhong.com/auth/callback`，精確匹配，不加尾斜線。
- 登入：Authorization Code＋PKCE S256、state、nonce；後端用 oauth4webapi 交換並驗證 RS256 ID token。
- 瀏覽器只持有 `__Host-array_sso_login`、`__Host-array_sso_session` 等不透明 cookie，均為 Secure／HttpOnly／SameSite=Lax、Path=/、無 Domain。
- Worker 不將 access／ID token 回傳瀏覽器，完成處理後不另保存。`/api/me` 看的是本站 session，沒有以 Authorization Bearer token 登入的分支。
- 登入交易保存在 Durable Object，原子消耗、5 分鐘到期；session 不超過 ID token exp 或一小時。
- Worker 未申請 offline_access／refresh，也沒有 MES、業務角色或其他帳號資料讀寫功能。

同 repo 另有 Python FDC＋Java MES 的完整監控模式，session 儲存、受保護 API 與服務 token 邊界不同。本輪依目前預設的 Cloudflare SSO 入口盤點，不混用兩套驗收結論。

## 路由驗收

| 路由 | 合法流程 | 重要負向情境 |
| --- | --- | --- |
| `GET /health` | 200，JSON `service:array-sso-test`、`status:up` | 只代表此健康檢查，不能代替登入驗收。 |
| `GET /` | 匿名顯示登入入口；有 session 顯示使用者 | 匿名也回 HTML 200，不得據此判定讀到受保護資料。 |
| `GET /auth/login` | 建立交易 cookie，303 到 issuer，含 state／nonce／S256 | 舊登入交易需失效；登入限流；callback origin 固定。 |
| `GET /auth/callback` | 驗交易 cookie／state、消耗交易、後端換碼、驗 ID token、建立新 session，303 回 `/` | 缺 cookie、state 不符、逾時、重播、跨瀏覽器；issuer／aud／nonce／exp／iat／簽章錯誤。 |
| `GET /api/me` | 200 JSON，`user.sub` 為非空字串、`expiresAt` 有效；不含 token | 無／偽造／到期／已登出 session 回 401 JSON `login_required`；只有 Bearer 不應建立 session。 |
| `POST /auth/logout` | 正確本站 session、Origin、form Content-Type 與 csrf；303，舊 session 立即失效 | 錯 Origin、缺／錯／重複 csrf、不正確格式；拒絕後合法 session 應保持有效。 |

Callback 的錯誤以 `303 /?error=login_failed` 表示，不能期待一定是 400／401，也不能把 303 或隨後首頁 200 當成攻擊成功。要核對是否建立新 session、是否進行不應發生的 token 交換，以及獨立 client 的 `/api/me` 是否能讀到正確資料。

「登出本站」刻意保留 auth-service／Google 的 SSO 登入。再次登入不一定再輸入 Google 帳密；這不是本站 session 撤銷失敗。Worker 也未設計集中帳號停用後即時撤銷本站 session，既有 session 可持續到效期；須依既定政策判讀。

## 第一個完整驗收切片

1. 核對實際部署版本／設定，再在隔離瀏覽器 A 讀 `/api/me`，確認 401 JSON 對照。
2. 從 Array 的 `/auth/login` 開始真實登入；使用測試帳號，經 issuer／Google 回到精確 callback。
3. 確認瀏覽器只收到本站 session，`/api/me` 回應符合 schema、身分與效期，沒有 access／ID token。
4. 用獨立、未登入的瀏覽器 B 重試 `/api/me`；依情境測試缺／偽造 session、callback cookie／state 不符。一次性交易不得靜默重用，失敗後提供重新準備入口。
5. 依正確 Origin＋CSRF 登出本站，再持舊 session 測 `/api/me` 必須回 401；SSO 保留另行標記。
6. 匯出來源／部署版本、測試角色、對照與結果，不含 cookie、code、token 或個人資料。

RS256 壞簽章、錯 issuer／aud／nonce 等應先在可控制 issuer 回應的本地來源整合驗證。不能在正式 callback query 填一個 `nonce=wrong` 就宣稱測過 ID token nonce；實際 nonce 在後端驗證的 ID token 裡。

## 限流與測試預算

原始碼設定為同一 IP 每 60 秒：全入口 120 次、登入 10 次、callback 30 次；先檢查 guard 再碰 session store／上游。缺 limiter 綁定或故障時回 503，不略過。

正式操作前須核對實際已部署門檻。Dashboard 不能用自身 500ms 間隔假設 Array 可以持續跑登入／callback；一般測試應保守計數、保留人工操作餘額，收到 429 即停止並提示等待。限流故障、WAF 或部署未完成不能顯示為 OIDC 攻擊已被正確阻擋。

## 這次實際執行的驗證

Dashboard 新增 `test:array-source`，使用指定 checkout 的既有測試，驗證真正的 `createApp`，而不是 Dashboard 自己複製的登入程式：

```sh
# 在 array-line-demo checkout 安裝鎖定依賴
npm ci

# 回到 OAuth-Security-Testing-Dashboard；填自己的實際路徑
ARRAY_DEMO_PATH=/path/to/array-line-demo npm run test:array-source
```

Windows PowerShell：

```powershell
$env:ARRAY_DEMO_PATH = 'C:\Projects\array-line-demo'
npm run test:array-source
```

本輪 checkout 位於 `/tmp/array-line-demo-review`（暫存路徑，不保證下次存在）。9 組來源測試全部通過，沒有失敗／跳過／取消：

- 正常登入、後端換碼、RS256 簽章、API 身分、HTML escaping、token 不外洩與本站登出。
- state、cookie 瀏覽器綁定、交易到期與 callback 重播。
- 錯誤 issuer／audience／nonce／exp／iat／sub／簽章／PKCE。
- session 到期、錯誤設定／來源與 provider 中斷。
- 登入／callback／全入口限流、cookie／query／XFF 不重置額度、故障時拒絕。

測試採隔離 OIDC fetch、真實 RSA 簽章、記憶體 store 與模擬 limiter。它不代表真實 Google、正式站部署、瀏覽器 SameSite／CORS，或本輪 workerd／Durable Object runtime 已驗證。Wrapper 只輸出含 Git revision 的 JSON 摘要，不轉印可能包含憑證的原始失敗輸出。

## Dashboard 接下來的實作順序

1. 加入 Array Worker 專用 profile／adapter，分清 app、issuer；以 session cookie 情境為主。沿用通用 token 情境時明確標為其他協定能力，不用它們代替 Array 驗收。
2. 先接上述正常登入到 `/api/me`／登出的一條流程，保留正確的跨 origin 瀏覽器狀態，避免把 issuer cookie 轉送給 Array。
3. 接入偽造 session、callback 缺 cookie／state 不符／重播、logout Origin／CSRF 與到期類情境，各自具有有效對照。
4. 將需可控制 issuer 的 claims／簽章場景列為來源整合模式，與正式 HTTP／瀏覽器結果分開。
5. 加上 Array 的限流預算與 `/api/me` schema 判讀，修正 2xx／HTML 假成功風險，再進行實際部署驗收。

以上 adapter 與瀏覽器流程尚未接入 Dashboard UI；目前完成的是 source 查核、可重跑的 9 組來源驗證與契約文件。
