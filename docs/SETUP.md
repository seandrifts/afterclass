# Supabase 建置逐步操作

從零開始建好資料庫。全程約 15 分鐘。

三個 migration 檔已在真實 Postgres 上驗證過，照著做不會有語法錯誤。

---

## 步驟 1：註冊並建立專案

1. 開 <https://supabase.com>，右上角 **Start your project**
2. 用 GitHub 帳號登入（最快，不用另外記密碼）
3. 進到 Dashboard 後按 **New project**

填三個欄位：

| 欄位 | 填什麼 |
|---|---|
| **Name** | `lucky-draw` |
| **Database Password** | 按 Generate a password，然後**複製起來存好** |
| **Region** | `Northeast Asia (Tokyo)` |

Region 選東京。台灣連東京的延遲大約 30ms，選美國會變 150ms 以上，
店員在櫃檯按折抵時那個差別是感覺得出來的。

資料庫密碼現在用不到（我們用 service_role key 連線），但之後要直連
資料庫時會需要，弄丟只能重設。存到密碼管理器裡。

4. 按 **Create new project**，等約 2 分鐘

### 如果你想沿用既有的專案

**先確認那個專案是空的。**我們的表用了 `users`、`settings`、`staff`
這類常見名稱，如果專案裡已經有別的應用在跑，建表會撞名而中斷。

在 SQL Editor 跑這段：

```sql
select tablename from pg_tables where schemaname = 'public' order by tablename;
```

回傳 0 列才可以繼續。有其他表的話，另外開一個新專案給抽獎系統用，
免費方案可以開兩個。

---

## 步驟 2：執行三個 SQL 檔

左側選單找到 **SQL Editor**（圖示是一張紙加上 `>_`）。

**一次跑一個檔案，不要三個一起貼。**這樣哪個出錯你會馬上知道是哪一步。

### 2-1　建表

1. 按 **New query**
2. 用文字編輯器打開 `~/Downloads/lucky-draw/supabase/migrations/0001_init.sql`
3. 全選複製，貼到 SQL Editor
4. 按右下角 **Run**（或 `Cmd + Enter`）

成功會顯示 `Success. No rows returned`。

這一步建立 10 張表、20 個索引，並開啟 RLS。

### 2-2　建立函式

同樣流程，換成 `supabase/migrations/0002_functions.sql`。

這一步建立 9 個函式，餘額的加減、抽獎的狀態轉換、每日到期歸零
全部在這裡。折抵的條件寫在 SQL 的 `WHERE` 裡而不是應用程式的
`if` 裡，這是防止併發重複扣款的關鍵。

### 2-3　灌初始資料

同樣流程，換成 `supabase/seed.sql`。

**這個檔案只能跑一次。**再跑一次會多出一整組重複的獎項，機率表就亂了。
如果不小心跑了兩次，回頭看本文件最後的「出錯了怎麼辦」。

---

## 步驟 3：確認資料進去了

在 SQL Editor 開新的 query 貼這段，按 Run：

```sql
select name, type, weight,
       round(weight * 100.0 / sum(weight) over (), 2) as 機率百分比,
       cost as 成本
  from prizes
 where is_active and weight > 0
 order by sort_order;
```

應該看到 8 列，權重加起來 1000：

| name | weight | 機率 |
|---|---|---|
| 免單（下次消費全免） | 3 | 0.30% |
| 回饋金 50 元 | 5 | 0.50% |
| 回饋金 20 元 | 15 | 1.50% |
| 回饋金 10 元 | 57 | 5.70% |
| 回饋金 5 元 | 120 | 12.00% |
| 回饋金 3 元 | 250 | 25.00% |
| 回饋金 2 元 | 300 | 30.00% |
| 回饋金 1 元 | 250 | 25.00% |

如果只看到 8 列以外的數量，代表 seed 跑了不只一次。

再確認一下設定有進去：

```sql
select shop_name, campaign_active, credit_expire_days,
       max_redeem_per_visit, monthly_cost_cap
  from settings;
```

`campaign_active` 應該是 `false`。這是刻意的，等你把店名、獎項、
序號都準備好才手動打開。

---

## 步驟 4：拿到連線資訊

### Project URL

最快的方法是看瀏覽器網址列。Dashboard 的網址長這樣：

```
supabase.com/dashboard/project/【一串英數】/...
```

那串英數就是 project ref，Project URL 就是：

```
https://【那串英數】.supabase.co
```

也可以從左側 **Settings** → **Data API** 那頁確認。

### Secret key

左側 **Settings** → **API Keys**。

畫面分成兩區，**只需要下面那區**：

| 區塊 | 用途 | 我們要嗎 |
|---|---|---|
| Publishable key（`sb_publishable_…`） | 前端用，受 RLS 限制 | 不需要 |
| **Secret key（`sb_secret_…`）** | **伺服器端用，繞過 RLS** | **要這個** |

Secret key 預設是遮住的，按右邊的**眼睛圖示**顯示，再按複製圖示。

> **舊版介面的使用者**：Supabase 新版把 `service_role` 改名為
> **Secret key**、`anon` 改名為 **Publishable key**。如果你的專案還是
> 舊介面，就複製 `service_role` 那把，作用完全相同。
>
> `@supabase/supabase-js` 2.110 以上兩種格式都支援，不用改程式。

**這把 key 等於資料庫的完整權限。**它可以繞過所有 RLS 讀寫任何資料。
絕對不要貼到聊天室、截圖、或任何前端程式碼裡。只放在 `.env.local`
和 Vercel 的環境變數設定裡。

真的不小心外流了，回這個頁面按該列右邊的 `⋮` 可以撤銷並重新產生。

---

## 步驟 5：寫進 .env.local

在專案資料夾執行：

```bash
cd ~/Downloads/lucky-draw
cp .env.example .env.local
```

用編輯器打開 `.env.local`，填入：

```
NEXT_PUBLIC_SUPABASE_URL=（步驟 4 的 Project URL）
SUPABASE_SERVICE_ROLE_KEY=（步驟 4 的 service_role key）
```

另外兩把自己產生的金鑰，在終端機跑這兩行，各自貼進去：

```bash
openssl rand -base64 32   # 貼到 SESSION_SECRET
openssl rand -base64 32   # 貼到 CRON_SECRET
```

`SESSION_SECRET` 是用來簽登入憑證的。換掉它會讓所有已登入的客人
和店員被登出，所以定案後就不要再動。

LINE 的兩個變數先留空，那是下一步的事。

---

## 步驟 6：每日排程（可以晚點再做）

系統需要每天跑一次到期歸零。有兩個做法，擇一即可。

### 做法 A：用 Supabase 的 pg_cron

1. 左側 **Database** → **Extensions**
2. 搜尋 `pg_cron`，把開關打開
3. 回到 SQL Editor，執行 `supabase/migrations/0003_cron.sql`

### 做法 B：用 Vercel Cron

部署到 Vercel 之後，在專案根目錄建立 `vercel.json`：

```json
{
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 20 * * *" }]
}
```

Vercel Cron 用 UTC 時間，`0 20` 是台灣時間凌晨 4 點。

做法 B 需要 Vercel 在呼叫時帶上 `CRON_SECRET`，設定方式見 Vercel 文件。

**兩個做法做的事完全一樣，重複執行也是安全的**（函式只會挑到期的資料，
跑第二次是 0 列）。還沒上線之前這步可以先跳過。

---

## 步驟 7：建立老闆帳號

`seed.sql` 插入的 PIN 是佔位字串，用它登不進去。產生真正的：

```bash
cd ~/Downloads/lucky-draw
node -e "console.log(require('bcryptjs').hashSync('1234', 10))"
```

把 `1234` 換成你要的 PIN（4 到 6 位數字）。會印出一長串
`$2b$10$...` 開頭的字。

回到 SQL Editor 執行，把 `$2b$10$...` 換成剛才印出來的：

```sql
update staff set pin_hash = '$2b$10$...' where role = 'owner';
```

之後從 `/staff/login` 用「老闆」加上這組 PIN 登入。

連續打錯 5 次會鎖 15 分鐘。真的鎖住了可以用這行解開：

```sql
update staff set failed_count = 0, locked_until = null;
```

---

## 步驟 8：本機跑起來看看

```bash
cd ~/Downloads/lucky-draw
npm run dev
```

打開 <http://localhost:3000/staff/login>，用剛設的 PIN 登入。

登入後右上角有「後台」連結，點進去應該看得到儀表板。
再到「獎項」頁確認機率表跟成本試算有正常顯示。

抽獎頁需要序號才進得去，這時候可以在後台「序號」頁產生一批
測試用的，啟用幾組，然後開 `http://localhost:3000/d/序號` 試抽。

LINE 登入這時候還不能用（環境變數還沒填），抽完會卡在
「用 LINE 登入領取」那一步。這是正常的，下一步申請完 LINE Login
就會通。

---

## 出錯了怎麼辦

### seed.sql 不小心跑了兩次

獎項會變成 16 個。全部清掉重來：

```sql
delete from prizes;
```

然後只重跑 `seed.sql` 裡 `insert into prizes` 那一段。

`settings` 那段是 `update` 不是 `insert`，跑幾次都不會有問題。
`staff` 那段會多一個「老闆」，用這行清掉多的：

```sql
delete from staff
 where id not in (select min(id::text)::uuid from staff group by name);
```

### 想整個砍掉重來

```sql
drop table if exists
  audit_logs, prize_change_log, coupons, balance_transactions,
  draw_tokens, users, token_batches, prizes, staff, settings
  cascade;
```

然後從步驟 2-1 重新開始。

### 免費方案會自動暫停

Supabase 免費方案的專案**連續 7 天沒有任何連線就會被暫停**，
要手動去 Dashboard 按 Restore 才會回來。

開發期間沒差，但**正式上線後絕對不能用免費方案**。客人在店裡掃碼
卻發現系統掛掉，那個信任一次就沒了。上線前升級到 Pro（每月 25 美元）。

---

## 完成後的下一步

1. 申請 LINE Login Channel，填 `LINE_CHANNEL_ID` 與 `LINE_CHANNEL_SECRET`
2. 部署到 Vercel
3. 後台填店名、確認機率、產生第一批序號
4. 印卡片
5. 打開活動開關

上線前的完整檢查清單見 [`PLAN.md`](PLAN.md) 第 11 節。
