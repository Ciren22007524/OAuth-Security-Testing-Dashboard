# 開發狀態

更新：2026-11-03

## 已實作

- 無第三方相依套件的 Node.js 24 本機模擬儀表板與隔離 HTTP runner。
- 23 個情境；22 個可測量 fixture 行為，瀏覽器 CORS 回報 INCONCLUSIVE。
- 斷言、HTTP 證據、敏感欄位遮罩、清理、取消及記憶體內結果。
- 繁體中文暗色介面、分類、單一／全部執行、JSON / Markdown 匯出。
- Node 內建測試與 GitHub Actions 工作流程。
- 授權碼與 state / access_token / refresh_token URL 參數遮罩；API 拒絕注入測試用 fault 設定。
- 語法檢查、48 項自動測試、實際啟動 API 及 Chromium 介面操作驗證通過；情境測量為 22 PASS / 1 INCONCLUSIVE。完整證據範圍見 `TEST_PLAN.md`。

## 限制與下一步

- 已唯讀核對 auth-service `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13` 的規則、設計、authorize、callback、token、logout、cookie、session、D1 store 與相關測試；未修改該儲存庫，未對正式服務執行測試。
- 儀表板 Chromium 操作已驗證；另以真實 Hono 原始碼驗證 11 組本機整合情境及 10 個 Chromium CORS／preflight／HttpOnly 斷言，全部通過。auth-service 原有 51 項測試也通過。
- 本機 Chromium 使用 same-site localhost 與 Secure-cookie 例外，不能代表正式 HTTPS 或跨站 cookie 行為。正式 Google 登入與遠端 D1 仍待驗證。
- 已完成 20 種獨立控制退化驗證，以及 logout、JWKS、discovery、rate-limit、錯誤處理與快取標頭情境；缺少一般安全標頭列為建議。
- 本機來源整合與瀏覽器測試可重跑，分別標示 LOCAL_SOURCE 與 LOCAL_SOURCE_BROWSER；詳見 `LOCAL_INTEGRATION.md`。
- Live 模式尚未實作。先取得隔離測試身份與已登記的 client / Origin，再實作白名單、明確授權、流量限制與整合測試。
- 交接提出的 React / TypeScript 架構並非現有技術；目前使用 ES modules 及語法檢查，尚無 TypeScript 型別檢查或獨立 lint。

## 下一步需要使用者定案

選擇維持本機驗證，或提供獨立 staging URL、已登記的測試 client_id／Origin 與隔離身份。確定環境後才實作 live 目標白名單、流量限制與整合流程；不會自動連到正式服務或變更正式 CLIENTS。機密只能在環境設定安全輸入，不能貼到對話或寫入報告。

GitHub API 網域仍被代理封鎖，無法建立 PR 或確認遠端 CI；Git 推送可用，先前已依使用者合併指示使用一般 merge commit 推送 main。
