# 自訂環境管理

更新：2026-11-04

使用者可以自行建立多個環境，不限「本地／測試機」兩個選項。可以命名為開發機、QA、個人沙盒等，並在頂端選單切換。

## 操作

1. 啟動 `npm start`，點「＋ 新增環境」。
2. 填入名稱，選擇「HTTP 服務」或「隔離模擬器」。
3. HTTP 環境填入服務基底網址，例如 `http://localhost:8787` 或自己的測試站。網址只能是 HTTP(S) origin，不含帳密、路徑、query 或 fragment。
4. 視需要填入目標已登記的 client ID、Origin 與 redirect URI。這些不是 secret；填入不會替目標註冊 client。
5. 點「儲存並切換」，再選擇情境或執行全部。儲存本身不會發出目標請求。
6. 已建立的環境可點「管理」修改或刪除。刪除只移除設定，不會變更目標服務。內建「本地模擬」保留為唯讀預設環境。

## 兩種類型

| 類型       | 執行內容                                             | 結果標示    |
| ---------- | ---------------------------------------------------- | ----------- |
| 隔離模擬器 | 23 個本機 fixture 情境，含輪替、登出、撤銷與注入時鐘 | SIMULATION  |
| HTTP 服務  | 10 個針對所選目標的公開及無 session 檢查             | CUSTOM_HTTP |

防禦驗證模式的 HTTP 情境適用於 auth-service 相容端點：`/health`、`/jwks`、`/.well-known/openid-configuration`、`/authorize` 與 `/token`。測試健康、公開金鑰、discovery、未知 client、redirect／state、Origin、缺少 session 與錯誤回應標頭。它不攜帶 cookie／token，不執行真實登入、logout 或 session 撤銷。

redirect／state 檢查先用已登記的合法設定建立短期 OAuth 交易，再做負向對照；不跟隨供應商重新導向，也不保留 cookie。該交易由目標既有期限機制清理，報告記錄 `cleanup: server-expiry`。合法設定無法建立交易時為 INCONCLUSIVE，不會因未知 client 回 400 就誤判控制通過。

缺少設定或已登記資料不符會回報待確認。JWKS 公鑰結構通過不代表已驗證實際簽發 JWT；無 session 錯誤標頭不代表成功 token 回應的快取策略。這些限制保留在報告中。

## 設定與結果保存

- 最多 100 個自訂環境，預設存於 `.local/environments.json`，已加入 `.gitignore`。原子替換寫入，檔案權限 0600。
- 上述路徑是原始碼 CLI 的預設。可攜式 Windows EXE 改存 `%LOCALAPPDATA%\OAuthSecurityLab\environments.json`；POSIX 系統以 0600 寫入，Windows 使用使用者 AppData 的繼承 ACL，不宣稱 POSIX mode 等同 Windows 權限。
- 可用 `DASHBOARD_ENVIRONMENTS_FILE` 指定其他設定檔。重啟讀取同一檔案即可保留環境；請自行備份此非機密檔案。
- 同一個 Dashboard 實例共用設定，目前不提供帳號權限隔離；不要讓多個行程共用同一檔案。
- 設定有版本號；過期的修改、刪除或執行請求回 409，避免測到與畫面不同的目標。
- 結果依環境 ID 與設定版本分開保留在記憶體。切換不混用結果，修改後不沿用舊版本結果；重新整理會清除結果。
- sessionStorage 只記錄本分頁選擇的環境 ID。設定不接受 secret、cookie 或 token 欄位。
- JSON／Markdown 報告記錄環境名稱、ID、設定版本、目標及遮罩證據，只匯出目前環境結果。

## 網路行為

只向已儲存的 origin 發出固定端點請求，不接受執行 API 臨時傳入其他 URL，不跟隨重新導向。單一情境最多 4 個請求，單一目標間隔至少 500ms；每個請求逾時 5 秒、最多讀取 64 KiB。實例一次只執行一個情境。HTML／非物件 JSON 不原文寫入報告。

429 標為待確認並停止批次，runner 依 Retry-After 保留等待期；等待期間不發送新請求。缺少一般安全標頭只列建議，不自動宣稱可利用漏洞。

啟動需要 Node.js 24.5 以上。`npm start` 使用 Node 的 `--use-env-proxy`，沿用平台代理與 CA，不關閉 TLS 驗證。在雲端仍須由網路政策允許該目標；建立 app 環境不會變更平台白名單。連線、TLS 或政策錯誤為 ERROR，不能當成防護通過。雲端的 localhost 並不會連到使用者自己的電腦。

## API

| 方法與路徑                           | 用途                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| GET `/api/environments`              | 列出環境                                                |
| POST `/api/environments`             | 建立 name／type／baseUrl／clientId／origin／redirectUri |
| PUT `/api/environments/:id`          | 更新設定，需目前 revision                               |
| DELETE `/api/environments/:id`       | 移除設定，body 為 `{ "revision": 1 }`                   |
| GET `/api/catalog?environmentId=:id` | 該環境支援的情境與設定快照                              |
| POST `/api/run`                      | body 包含 id、environmentId、environmentRevision        |

寫入／執行 API 要求與 Dashboard 同來源的 Origin 及 JSON Content-Type。服務仍只綁定 loopback，並檢查 Host。

## 測試模式

環境類型（模擬／HTTP）與測試模式（防禦／攻擊）分開選擇。攻擊模式的參數在各情境右側表單獨立填寫，環境只選目標，不沿用環境的防禦用 client ID／Origin／redirect URI；環境設定本身仍不接受 secret。OIDC discovery、標準 token 認證與資源對照請求的支援範圍見 [攻擊模式](ATTACK_MODE.md)。

## HTTP 服務協定（2026-11-06）

新建環境選擇 auth-service OIDC／Array session／舊版相容；已保存而未指定 protocol 的環境保留舊版，測新版時需明確編輯選擇。修改會更新 revision 並隔離舊結果。協定只決定 adapter 與情境，不保存憑證。

auth-service 使用 discovery、RSA RS256 與 S256；Array 使用本站 cookie 和 /api/me，不將 issuer 的 access token 當作 Array 登入 session。新協定的 client ID／code／token 仍在情境內填寫，日後由整合 runner 自動準備；目前的一鍵整合尚未交付。
