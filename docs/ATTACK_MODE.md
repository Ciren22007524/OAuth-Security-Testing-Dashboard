# 攻擊情境與各自的參數

模式分為防禦驗證與攻擊模擬。防禦模式保留既有 23 個模擬／10 個 HTTP 情境；攻擊模式提供下面 10 個可執行 use case。

**環境只選目標；攻擊參數填在右側的個別情境表單。** 不再使用共用憑證面板，也不沿用環境中防禦驗證用的 client ID、Origin 或 redirect URI。

## 操作流程

1. 在 header 選擇模擬或 HTTP 目標，再切到「攻擊模擬」。
2. 選一個情境，在右側填入該情境需要的憑證、路徑與對照參數；端點與認證方式可展開設定。
3. 按「執行此情境」。攻擊模式不提供共用參數的「執行全部」，避免把不同憑證誤用在其他情境。
4. 切換情境時各自保留目前分頁的草稿與結果；改參數只清除此情境的舊結果。切換目標或離開攻擊模式會清除全部攻擊草稿與結果。
5. 檢視能力觀察、對照與已遮罩的 HTTP 證據，依需要匯出報告。

HTTP 模式中 `*` 是該情境的必填欄位。公開 client 的授權碼／refresh 情境可在進階設定明確選擇 `none`，不附 secret；預設依 discovery 選擇 Basic 或 POST 認證。

## 10 個 use case

| 情境 | 個別輸入 | 實際操作與判讀 |
| --- | --- | --- |
| Secret 取得 token | client ID、secret、選填 scope | 以 client_credentials 換取 Bearer token。 |
| Secret 讀取受保護資源 | client ID、secret、scope、資源路徑 | 未附憑證對照回 401／403 後，再取得 token 讀取同一路徑。 |
| Secret 擴大 scope | client ID、secret、已知 scope、欲擴大 scope | 對照 token 先成功，再確認第二次實際宣告新增 scope；是否超出授權須對照 client 政策。 |
| Access token 讀資源 | access token、資源路徑 | 比較未附憑證與附 Bearer 的 GET 結果。 |
| Access token 取得 UserInfo | access token、選填 UserInfo 路徑 | 對照後檢查回應是否為含 sub 的 JSON，不保存個人資料。 |
| Refresh token 換發 | client ID、refresh token、選填 secret／scope | 以 refresh_token grant 嘗試換取新 token，可能輪替原 refresh token。 |
| 舊 refresh token 重用 | 同上 | 首次兌換成功後重送同一枚舊 token，觀察是否仍可用。 |
| 授權碼交換 | client ID、code、對應 redirect URI、選填 verifier／secret | 以 authorization_code grant 兌換；成功會消耗授權碼。 |
| 授權碼重播 | 同上 | 首次兌換成功後，原樣重送同一授權碼。 |
| 省略 PKCE verifier | client ID、PKCE code、對應 redirect URI、原始 verifier、選填 secret | 先省略 verifier；被拒後再補正確 verifier，確認授權碼本身可用。 |

每項最多 2～4 個請求；需要 token 或 UserInfo discovery 時使用 `/.well-known/openid-configuration`。同一情境的 discovery 會共用一次，不會為重播重讀 metadata。HTTP 請求至少間隔 500ms、逾時 5 秒、回應上限 64KiB。遇到 429 停止並等待，不跟隨重新導向。

## 有效對照與結果語意

- `SUCCEEDED`：攻擊者完成了該項操作。
- `BLOCKED`：本次操作被標準錯誤或拒絕回應阻擋；重播類情境須有首次成功兌換的對照。
- `INCONCLUSIVE`：缺參數、回應不明或對照不成立。過期 code、無效 refresh token、公開資源不會被誤報為已證明安全。
- `ERROR`：連線、回應大小、取消或執行錯誤。

操作成功不自動等於漏洞。例如 client 原本可能允許 admin scope，refresh 重用也可能符合寬限設計；必須依實際政策判讀。省略 verifier 仍成功時，報告會提醒確認該 code 原始授權確實綁定 PKCE。這裡不會從 client secret 推定使用者登入，也不驗證 ID token 簽章。

## 本地模擬

每個情境使用自己的隔離 fixture，參數可留白使用該情境的示範資料：`demo-client`／`demo-secret`、`demo-access-token`、`demo-refresh-token`、`demo-code`，redirect 為 `https://app.example.test/callback`。PKCE verifier 是 `demo-verifier-` 後補 `v` 至 43 字元。模擬 scope 為 `read`，資源為 `/resource`，UserInfo 為 `/userinfo`；scope 擴大預設嘗試 `admin`。

預設模擬會阻擋 scope 擴大、授權碼重播、refresh 重用及省略 verifier，其餘六項可操作成功。測試另以獨立、刻意放寬控制的 fixture 確認這四種攻擊也能被識別為成功，不是固定顯示「被阻擋」。fixture 的放寬開關不開放給 dashboard API。

## 憑證、資料與副作用

所有情境的 secret、access／refresh token、code、verifier 只留在目前分頁草稿與當次請求；不進環境 JSON、browser storage、紀錄或報告。後端不回傳原始 token、Cookie 或使用者資料，證據只含已遮罩的請求與回應摘要。報告以 `-attack-report` 命名。

兌換可能消耗 code、輪替 refresh token，重播也可能導致 provider 撤銷整個 token family；各情境表單會顯示這些具體影響。工具不保存新憑證，也未自動撤銷已簽發 token，其效期由目標管理。

## 支援界線與程式架構

所有端點限於所選目標同 origin。多租戶 provider 可在個別情境直接指定 token 路徑，例如 `/realms/example/protocol/openid-connect/token`，並指定認證方式。不同 origin 的 resource server、mTLS、private_key_jwt、session cookie、真正瀏覽器 CSRF／CORS、nonce 與完整 OIDC conformance 尚未加入；沒有對正式 Google 或其他 provider 執行驗收。

欄位與必填條件在 `src/attack-catalog.js`；個別操作在 `src/attack-scenarios.js` 的 handler 註冊表；傳輸、節流、取消與遮罩在 `src/attack-runner.js`；fixture 在 `src/attack-fixture.js`。前端根據 catalog schema 生成每個情境的表單，後端也依同一 schema 拒絕不屬於該情境的欄位。
