# 交接：CI 改用 `.nvmrc` 作為 Node 版本來源

> 產生日期：2026-11-04｜基準：`main` @ `3b9b99b`｜交接給：Codex
>
> 能存取 repo 的 agent：執行 `$handoff resume`（Claude Code 是 `/handoff resume`）。
>
> 這份文件可以單獨閱讀。本專案沒有 `AGENTS.md`／`CLAUDE.md`／`CONTRIBUTING.md` 規則檔；規則以 `README.md`、`docs/STATUS.md` 與既有慣例為準，兩者不一致時以 repo 內容為準。

## 專案簡介

OAuth-Security-Testing-Dashboard 是一個在本機執行的 OAuth 協定安全測試台：Node.js ES modules、沒有任何第三方相依套件，介面為繁體中文。用隔離模擬器跑 23 個情境，也可以對使用者自建的 HTTP 環境做有範圍限制的檢查。目前只在本機開發，沒有部署。

## 你的任務

- **目標**：讓 GitHub Actions 改從 `.nvmrc` 讀 Node 版本，取代 `.github/workflows/ci.yml` 裡寫死的 `node-version: "24"`，使 Node 版本只在一處定義。
- **完成條件**：
  1. `ci.yml` 的 `actions/setup-node@v4` 改用 `node-version-file: .nvmrc`，且不再有 `node-version`
  2. 該 PR 的 GitHub Actions CI 結果為 success，log 中 setup-node 解析出的版本 >= 24.5
  3. 本機用 Node >= 24.5 跑 `npm run check` 與 `npm test` 都通過（58/58）
- **可以修改**：`.github/workflows/ci.yml`、`docs/STATUS.md`（只改「下一步」中這一項）、刪除本文件
- **不要修改**：
  - `src/`、`test/`、`public/`、`scripts/`：與本任務無關
  - `package.json` 的 `engines`（`>=24.5.0`）與 `.nvmrc`（`24.5.0`）：這是剛確立的版本需求，要改先在 PR 說明提出
- **接手前使用者要先完成**：無

## 現況

### 已完成（和這個任務有關的）

- PR #1 已合併（merge commit `3b9b99b`）：新增 `.nvmrc`（`24.5.0`），並修正 Node 24 下 `control regression is detected: jwks` 從 FAIL 變 ERROR 的問題。
- `ci.yml` 已在 Node `"24"` 上跑 `npm run check` 與 `npm test`；`3b9b99b` 的 CI run #14 成功。

### 進行中（別人正在做，請避開）

無。沒有 open 的 PR。遠端另有 `feature-*` 與 `claude/auth-service-testing-progress-tjwmmt` 等舊分支，都已合併，不要在上面繼續開發。

### 已知問題、沒測過的部分

- `.nvmrc` 寫的是 `24.5.0`，`setup-node` 會**完全照這個值**安裝 24.5.0，不會取最新的 24.x。這仍然滿足 `engines >=24.5.0`，但和目前 CI 用的最新 24.x（本機驗證是 v24.22.1）不同。合併前要確認 CI 在 24.5.0 上也通過；如果失敗，把失敗訊息寫進 PR 說明，交給使用者決定是否把 `.nvmrc` 改成 `24`，不要自己改。
- CI 沒有跑 `npm run test:browser` 與 `test:auth-*`：這些需要 Chromium 或 `AUTH_SERVICE_PATH`（指向本機 auth-service 原始碼），不在本任務範圍。

### 檢查結果（基準 commit 上）

| 檢查                                        | 結果                                  |
| ------------------------------------------- | ------------------------------------- |
| `npm run check`（Node v24.22.1）            | 通過，Syntax checked 17 JavaScript modules |
| `npm test`（Node v24.22.1）                 | 通過，58 tests / 58 pass / 0 fail     |
| GitHub Actions CI run #14 @ `3b9b99b`       | success                               |

## 相關程式與文件

| 檔案                         | 為什麼要看                                   |
| ---------------------------- | -------------------------------------------- |
| `.github/workflows/ci.yml`   | 要修改的檔案（目前全文見下方）               |
| `.nvmrc`                     | Node 版本唯一來源，內容 `24.5.0`             |
| `package.json`               | `engines.node` 為 `>=24.5.0`；`check`、`test` 指令 |
| `docs/STATUS.md`             | 完成後要更新「下一步」                       |

目前的 `.github/workflows/ci.yml`：

```yaml
name: CI
on: [push, pull_request]
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: npm run check
      - run: npm test
```

## 參考寫法

只改 `with:` 區塊，其他行（`permissions: contents: read`、兩個 `run` 步驟）保持原樣：

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
```

## 必須遵守的規則

- **分支**：從最新的 `main` 開新分支，不直接 push 到 `main`。分支命名沿用 repo 慣例 `feature-<描述>`，例如 `feature-ci-nvmrc`。
- **合併**：發 PR，由使用者合併；repo 歷史一律用一般 merge commit（不 squash、不 rebase）。
- **push 前檢查**：用 Node >= 24.5 跑 `npm run check` 與 `npm test`，都要通過。
- **程式慣例**：不新增任何第三方相依套件。
- **文件語言**：`docs/` 內文件用繁體中文。
- **Commit 訊息**：英文、祈使句開頭的單行標題（例如 `Read CI Node version from .nvmrc`），需要時加說明內文。
- **機密**：不在設定、報告或文件中寫入任何機密；`.local/`、`.env` 已在 `.gitignore`。

## 相關決定

- Node 版本需求是 `>=24.5`：`npm start` 使用只有 Node 24 才有的 `--use-env-proxy` 旗標，所以**不能**把 `engines` 或 `.nvmrc` 降到 22 來配合環境。
- 架構採用無相依的 JavaScript ES modules，不採交接文件曾建議的 React／TypeScript monorepo（見 `README.md`「結構與後續工作」）。

想推翻上面任何一項時，先停下來在 PR 說明提出，不要直接改。

## 遇到不確定的事

- CI 在 24.5.0 上失敗，或需要調整 `.nvmrc`：停下來在 PR 說明寫出失敗的 log 摘要，由使用者決定。
- 需要設定值、GitHub 後台操作或機密：停下來，列出需要使用者提供什麼，不要猜或填假值。

## 完成後

- PR 說明列出：改了什麼、實際跑過的檢查與結果（本機 Node 版本、`npm run check`、`npm test` 的通過數、CI run 結果與解析出的 Node 版本）。
- 更新 `docs/STATUS.md`：從「下一步」移除 CI 改用 `.nvmrc` 這一項，並在「已實作」記錄完成。
- 在同一個 PR 刪除本文件 `docs/handoff.md`。
