# 小吃店消費抽獎系統

來店消費一次，抽獎一次，100% 中獎。抽到的金額累積進 LINE 帳號，下次來店折抵。

- 規劃文件：[`docs/PLAN.md`](docs/PLAN.md)
- 後台規格：[`docs/ADMIN.md`](docs/ADMIN.md)

## 目前狀態

Phase 1 完成，尚未上線。缺的是外部服務憑證（Supabase、LINE Login），以及第 3 節的部署步驟。

## 技術

Next.js 16（App Router、Turbopack）+ TypeScript + Tailwind 4 + Supabase（Postgres）+ Vercel。

## 1. 設定環境變數

```bash
cp .env.example .env.local
```

需要自己去申請的：

| 變數 | 從哪來 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | [Supabase Dashboard](https://supabase.com/dashboard) 專案的 Settings › API |
| `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` | [LINE Developers](https://developers.line.biz) 建立 LINE Login Channel，Callback URL 設為 `{SITE_URL}/auth/line/callback` |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -base64 32` |

`SUPABASE_SERVICE_ROLE_KEY` 有完整資料庫權限，絕不可外洩，也不可放進任何 client 端程式碼。

## 2. 建立資料庫

在 Supabase 的 SQL Editor 依序執行：

```
supabase/migrations/0001_init.sql       建表、索引、RLS
supabase/migrations/0002_functions.sql  餘額與抽獎的原子函式
supabase/migrations/0003_cron.sql       每日到期排程（需要 pg_cron）
supabase/seed.sql                       初始設定與獎項
```

如果專案沒有啟用 `pg_cron`，跳過 `0003`，改用 Vercel Cron 每日呼叫：

```
GET /api/cron/daily
Authorization: Bearer {CRON_SECRET}
```

兩者做的事完全一樣，重複執行是安全的。

## 3. 建立第一位老闆帳號

`seed.sql` 插入的 `pin_hash` 是佔位值，登入不會過。產生真正的 hash：

```bash
node -e "console.log(require('bcryptjs').hashSync('你要的PIN', 10))"
```

把結果更新到 `staff` 表：

```sql
update staff set pin_hash = '$2b$10$...' where role = 'owner';
```

然後從 `/staff/login` 登入，右上角會出現「後台」入口。

## 4. 開跑前

活動預設是**關閉**的（`settings.campaign_active = false`）。要在後台 › 設定確認以下事項後才手動開啟：

1. 設定 › 品牌：填店名
2. 獎項：確認機率表與成本試算，特別看「最壞情況」那個數字
3. 序號：產生第一批（建議 200 組），啟用 100 組
4. 序號：下載列印清單拿去印
5. 設定 › 成本煞車：設月上限
6. 設定：打開活動開關

上線前的完整檢查清單見 [`docs/PLAN.md`](docs/PLAN.md) 第 11 節，特別是餘額相關的那幾項，那是唯一會直接損失金錢的部分。

## 開發

```bash
npm run dev          # 開發伺服器
npx tsc --noEmit     # 型別檢查
npx eslint src       # lint
npm run build        # 正式建置
```

## 幾個不能改的設計

這些在文件裡有完整說明，改動前請先讀過理由：

- **餘額只能透過 Postgres function 異動**。直接 `update users set balance` 會繞過流水帳，那筆錢就查不出去向。後台的人工調整也走同一套函式
- **抽獎機率計算完全在後端**。前端只播動畫
- **券要快照中獎當下的獎項內容**。只存 `prize_id` 的話，後台改獎項名稱會追溯性竄改已發出的券
- **獎項只能停用不能刪除**
- **縮短餘額到期天數不追溯既有餘額**

## 對外文案

程式內部沿用「儲值金」一詞，但**對客人一律稱「回饋點數」**。

理由是台灣禮券法規管的是預付型商品，本活動的點數是消費回饋而非預先付款購買，因此可以設使用期限。但用詞若出現「儲值」「預付」，可能讓主管機關或客人誤認性質。詳見 [`docs/PLAN.md`](docs/PLAN.md) §9.2。
