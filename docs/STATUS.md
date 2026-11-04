# 開發狀態

更新：2026-11-04

## 已實作

- 修正直接開啟 HTML 時的根路徑資源錯誤；CSS／JS／API 改用相對路徑，新增啟動失敗提示及 `/index.html` 入口。Node CLI 明確顯示應開啟的位址。
- 已驗證靜態主機缺少 API 時的 OFFLINE 提示，以及反向代理子路徑的樣式、JS、API 與 rotation 執行；雲端 Chromium 禁止 file:，直接開檔渲染測試明確跳過，另確認檔案相對引用均可解析。

- 介面改版：側欄導覽、環境卡片、狀態統計與實測進度；支援關鍵字搜尋及逐筆展開 HTTP 證據。手機版與長表單固定操作區已調整。

- 無第三方相依套件的 Node.js 24 儀表板與隔離模擬／自訂 HTTP runner。
- 使用者可新增、編輯、刪除及切換多個環境；設定保存於 ignored `.local/environments.json`，每個環境有獨立版本與結果。
- 自訂 HTTP 環境提供 10 個實際目標檢查，通過真實 Hono 本機 HTTP bridge 的全部 10 個情境。
- 瀏覽器驗證環境 CRUD、實際 HTTP 執行、結果隔離、設定持久化、版本變更與報告目標標記通過。
- 23 個情境；22 個可測量 fixture 行為，瀏覽器 CORS 回報 INCONCLUSIVE。
- 斷言、HTTP 證據、敏感欄位遮罩、清理、取消及記憶體內結果。
- 繁體中文暗色介面、分類、單一／全部執行、JSON / Markdown 匯出。
- Node 內建測試與 GitHub Actions 工作流程。
- 授權碼與 state / access_token / refresh_token URL 參數遮罩；API 拒絕注入測試用 fault 設定。
- 語法檢查、58 項自動測試、實際啟動 API 及 Chromium 介面操作驗證通過；情境測量為 22 PASS / 1 INCONCLUSIVE。完整證據範圍見 `TEST_PLAN.md`。
- 符合 `package.json` 宣告的 Node >=24.5 需求：新增 `.nvmrc`（24.5.0），並修正 jwks 控制退化在 Node 24 的相容性問題——注入私鑰材料的 fault 使 `createPublicKey` 在 Node 24 拋例外，現已將解析／驗證例外視為該斷言失敗，情境正確回報 FAIL 並附證據，不再變成 ERROR。Node 22 與 Node 24 皆 58/58 通過。

## 限制與下一步

- 已唯讀核對 auth-service `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13` 的規則、設計、authorize、callback、token、logout、cookie、session、D1 store 與相關測試；未修改該儲存庫，未對正式服務執行測試。
- 儀表板 Chromium 操作已驗證；另以真實 Hono 原始碼驗證 11 組本機整合情境及 10 個 Chromium CORS／preflight／HttpOnly 斷言，全部通過。auth-service 原有 51 項測試也通過。
- 本機 Chromium 使用 same-site localhost 與 Secure-cookie 例外，不能代表正式 HTTPS 或跨站 cookie 行為。正式 Google 登入與遠端 D1 仍待驗證。
- 已完成 20 種獨立控制退化驗證，以及 logout、JWKS、discovery、rate-limit、錯誤處理與快取標頭情境；缺少一般安全標頭列為建議。
- 本機來源整合與瀏覽器測試可重跑，分別標示 LOCAL_SOURCE 與 LOCAL_SOURCE_BROWSER；詳見 `LOCAL_INTEGRATION.md`。
- 已實作 CUSTOM_HTTP 目標設定、固定 origin／端點、500ms 間隔、有限預算、逾時、回應大小與 Retry-After 等待期；尚無帶 session 的遠端輪替／撤銷測試。
- 交接提出的 React / TypeScript 架構並非現有技術；目前使用 ES modules 及語法檢查，尚無 TypeScript 型別檢查或獨立 lint。

## 後續需要實際設定的部分

使用者可以直接在介面建立自己的 HTTP 環境，填入目標與已登記的 client／Origin／redirect URI，無須先固定只有本地或測試機兩種環境。操作與限制見 `ENVIRONMENTS.md`。

若要測試真實登入、正式 Google／D1 或帶 session 的撤銷，需要先決定隔離測試身份與 session 注入方式。這不阻擋目前的環境管理與無 session 檢查；不會自動變更正式 CLIENTS。機密不能貼到對話或寫入設定／報告。

GitHub API 網域仍被代理封鎖，無法建立 PR 或確認遠端 CI；Git 推送可用，先前已依使用者合併指示使用一般 merge commit 推送 main。
