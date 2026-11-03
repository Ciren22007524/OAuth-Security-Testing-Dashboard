# 開發狀態

更新：2026-11-03

## 已實作

- 無第三方相依套件的 Node.js 24 本機模擬儀表板與隔離 HTTP runner。
- 14 個情境；13 個可測量 fixture 行為，瀏覽器 CORS 回報 INCONCLUSIVE。
- 斷言、HTTP 證據、敏感欄位遮罩、清理、取消及記憶體內結果。
- 繁體中文暗色介面、分類、單一／全部執行、JSON / Markdown 匯出。
- Node 內建測試與 GitHub Actions 工作流程。
- 語法檢查、20 項自動測試、實際啟動 API 及 Chromium 介面操作驗證通過；情境測量為 13 PASS / 1 INCONCLUSIVE。完整證據範圍見 `TEST_PLAN.md`。

## 限制與下一步

- 已唯讀核對 auth-service `37ea8ca82b120a6fadfc9d81082aa920f5cf4e13` 的規則、設計、authorize、callback、token、logout、cookie、session、D1 store 與相關測試；未修改該儲存庫，未對正式服務執行測試。
- 儀表板的 Chromium 操作已驗證；auth-service 的瀏覽器 CORS、Google 登入、遠端 D1 仍待驗證。
- 補上每項控制的獨立 vulnerable fixtures、logout、JWKS、discovery 與 rate-limit 情境。
- Live 模式尚未實作。先取得隔離測試身份與已登記的 client / Origin，再實作白名單、明確授權、流量限制與整合測試。
- 交接提出的 React / TypeScript 架構並非現有技術；目前使用 ES modules 及語法檢查，尚無 TypeScript 型別檢查或獨立 lint。
