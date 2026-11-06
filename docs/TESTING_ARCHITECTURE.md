# 操作方向：獨立的整合驗測工作台

日期：2026-11-06。這份文件區分建議方向與已交付功能；第一條 A／B 自動登入至登出流程已實作，操作見 [整合 runner](INTEGRATION_RUNNER.md)；後續外洩／跨 client 情境未完成。

## 建議與分工

採用「獨立工作台直接串接隔離的 auth-service 與 Array」；auth-service 保留自身單元／協定／資料隔離測試。工具自動完成正常登入、憑證準備、攻擊變體、對照、清理與報告，手填欄位降為進階覆寫。

| 選擇 | 判斷 |
| --- | --- |
| 維持大量手填參數 | 不作日常操作方式；code／verifier／session 的正確準備應由 runner 負責。 |
| 把攻擊工具做進正式 auth-service | 不採用；容易混淆正式管理權限、假身分與測試操作，也無法代替 Array 自己的 session／callback 邊界。 |
| 獨立整合工作台＋各 repo 的來源測試 | 採用；可直接使用真實服務程式，同時涵蓋 provider、client、瀏覽器的不同邊界。 |

「直接串接」不是只讀 discovery 或把 grant 逐個 POST；應跑過真實應用的完整登入與 API 流程。也不是把 mock API 回固定成功當作整合測試。

## 日常介面

一次設定：auth-service、Array 的位置與啟動／部署方式、協定 adapter；情境配方從實際契約取得。之後日常只選：

1. 測試環境：本機隔離整合／測試站。
2. 測試身分：未登入、使用者 A、使用者 B，或不同 client／擁有者。
3. 情境：正常登入、跨 session／client、callback 重播、登出 CSRF、scope／secret 變更等實際適用項目。

按「執行情境」後，runner 自動建立 state、nonce、S256 verifier、一次性 code、cookie jar 與必要對照。API 成功的識別條件由 adapter 提供，例如 Array `/api/me` 的 `user.sub`、有效 `expiresAt` 與 JSON 格式，無須每次由使用者重填。

進階模式才允許貼既有 token／session、指定路徑、改單項參數。各情境仍保留獨立執行期參數；不能用共用的一枚 code 或已輪替 refresh token 跑全部案例。

## 模擬多使用者

本機模式使用真實 auth-service／Array 邏輯，搭配隔離資料、測試 A／B 身分與假 Google provider。每個情境準備自己的 browser context／交易，避免前一次登入污染下一次結果。provider 替身要明確標記，不能聲稱驗過真正 Google。

測試站／正式站使用真實測試帳號及其正常登入程序。工具不能替任意使用者簽發合法 session，不能靠修改 token claims 假裝已登入，也不在正式服務增加 `?user=A`、任意帳號切換或可偽造身分的測試入口。

owner／scope／secret 變更情境需可拋棄 client 與獨立擁有者 A／B；使用者既有正式 client 不作預設操作對象。secret 輪替、授權撤銷、refresh 旋轉的效果不能只靠換幾個字串猜測。

## 可交付的第一條流程

啟動隔離 auth-service＋Array → 準備使用者 A → 真實 app 發起 OIDC 登入 → Array 建立本站 session → 驗 `/api/me` → 獨立未登入 context 對照 → 以錯誤／另一情境 session 比較 → 本站登出 → 舊 session 401 → 遮罩報告。

第一條跑順再增加 A／B 擁有者隔離、nonce／claims、scope／secret 變更。callback 憑證的消耗與限流預算由 runner 控制；不能把大量一定失敗的請求交給使用者自行排錯。

## 目前進度

已完成：舊／新協定分流、OIDC RSA discovery 檢查、Array 基本 session HTTP 情境、2xx 假成功防護、每情境隔離的進階欄位，以及可重跑的 auth-service／Array 最新來源測試。

已另完成：Dashboard 來源整合模式，自動準備 A／B、註冊 client 與 secret，使用 Chromium 跑登入至撤銷對照。未完成：owner／scope／secret 管理的跨服務情境與正式環境瀏覽器驗收。CLI 來源測試與手動 HTTP 情境不冒充這些尚未交付的整合功能。
