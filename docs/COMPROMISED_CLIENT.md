# 把測試模組當作已被攻破的 SSO client

方向：工具可以同時提供測試控制台與一個真正串接 SSO 的受測 client，但這是不同角色。受測 client 被攻破後，控制台仍須能操作與保存結果。

## 角色

- 控制台：啟動環境、選使用者與攻擊前提、執行情境、比較證據。
- 受測 client A：正常登記、登入、建立自己的 session，再模擬其資料外洩。
- 對照 client B：驗證影響是否超出 A 的合法能力。
- auth-service：沿正式的授權、scope、PKCE 與撤銷規則處理，沒有任意假身分／測試 bypass 入口。

可以同一 repo，控制台與受測程式分開執行；正式站連線時受測 client 要有專用登記及測試設定。本地模式使用自動建立、可拋棄的註冊與假 Google 身分，不動正式 client。

## 每個攻破條件能取得什麼

| 前提 | 只提供給攻擊 handler 的能力 | 不能偷偷假設 |
| --- | --- | --- |
| 前端腳本受控 | 頁面可讀的資料與前端 token（若 app 有下發） | HttpOnly cookie、後端 secret、issuer 的 cookie／私鑰。 |
| 後端 client secret 外洩 | client A 的 secret 與公開設定 | 使用者已登入、有效 code／verifier、client B 的 secret。 |
| 使用者 access token 外洩 | 此 client／使用者的那枚 token | 可登入任意 BFF session，或可讀其他 client 的 API。 |
| 本站 session 外洩 | client A 的一枚 session | issuer SSO cookie 或其他服務的 session。 |
| 受測 client 後端受控 | 受測 client 自己持有的登入交易、secret、token／session | auth-service 的儲存、簽章私鑰或任意使用者身分。 |

後端受控的第一階段以明確的外洩能力集合模擬，不接受任意 JavaScript／shell 輸入。若要宣稱測到真正 RCE 的程序／記憶體隔離，client 與 issuer 必須另建獨立程序／容器邊界；現有正常流程 harness 在同一測試 child 內承載兩份 source，不冒充這種隔離驗證。

## 應判讀的結果

先建立正常能力，再施加一項外洩前提，測能否跨 client、擴大 scope、冒用其他身分，或在撤銷／secret 輪替後繼續使用。能使用 client A 原本已授權的能力，表示外洩影響，不自動等於 SSO 邊界被突破。

日常介面應是「環境 → 受測 client → 使用者 → 外洩前提 → 執行」，由 runner 注入當次憑證，不再要求使用者搬動 secret／code／cookie。手動注入只保留為進階情境。

已交付的 [自動整合 runner](INTEGRATION_RUNNER.md) 完成前置的正常登入與撤銷對照；跨 client 與外洩能力情境仍待實作，不標記為已驗收。
