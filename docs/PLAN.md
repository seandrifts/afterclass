# 小吃店消費抽獎系統 規劃文件

版本 v1.0 / 2026-07-28

---

## 0. 參數全部由後台控制

**設計原則：任何數字都不寫死在程式碼裡。**獎項名稱、成本、機率、券有效期、使用門檻、活動開關、成本上限，全部存資料庫，由後台隨時修改，改完立即生效，不用重新部署。

下表是**初始值**（開工時先填進資料庫），之後都在後台改：

| 項目 | 初始假設 | 後台位置 |
|---|---|---|
| 店名 | （待填） | 設定 › 品牌 |
| 平均客單價 | 120 元 | 設定 › 成本試算 |
| 平均毛利率 | 55% | 設定 › 成本試算 |
| 每日來客數 | 80 人 | 設定 › 成本試算 |
| 每月成本上限 | 10,000 元 | 設定 › 成本煞車 |
| 券預設有效期 | 21 天 | 獎項管理（可逐項設定） |
| 每次消費限用券數 | 1 張 | 設定 › 活動規則 |
| 紙卡序號有效期 | 90 天 | 設定 › 活動規則 |
| 動態 QR 存活秒數 | 60 秒 | 設定 › 活動規則 |
| 抽完到登入的領取時限 | 30 分鐘 | 設定 › 活動規則 |
| 各獎項機率與成本 | 見 §3.2 | 獎項管理 |

**唯一需要你現在提供的**是實物獎品的真實成本（滷蛋、加麵、飲料各多少錢），因為這個我沒辦法猜。其他都可以先填假設值上線後再調。

後台詳細規格見 [`ADMIN.md`](./ADMIN.md)。

---

## 1. 活動概念

**一句話**：來店消費一次，抽獎一次，100% 中獎，獎品存進 LINE 帳號，下次來店使用。

**核心目的**（依重要性排序）：

1. **提高回訪頻率**。券有到期日，製造「不用會過期」的回店動機
2. **建立客戶名單**。取得 LINE 帳號後可以推播新品、公休、優惠
3. **提高客單價**。券設使用門檻（滿 100 折 10），推高每次消費金額
4. 抽獎本身的娛樂感與口碑傳播

**不做的事**：不做集點卡。集點需要累積多次才有回饋，回饋週期太長。抽獎是「當下就有結果」，多巴胺回饋即時，參與率遠高於集點。

---

## 2. 防作弊機制

### 2.1 威脅列表

| 威脅 | 說明 | 對策 |
|---|---|---|
| 沒消費也能抽 | 路人掃牆上 QR | 不用固定 QR |
| 一次消費抽多次 | 客人重複掃同一張 QR | token 一次性，掃走即作廢 |
| 截圖轉發 | 客人把 QR 傳給朋友 | token 60 秒過期 + 一次性 |
| 帳號農場 | 一人辦多個 LINE 帳號 | 一個 token 只能用一次，跟帳號無關。多帳號無法增加抽獎次數 |
| 店員私發 | 員工發卡給親友換獎品 | 每張 token 記錄發放者，後台比對「發放張數 vs 當日來客數」 |
| 券重複核銷 | 客人截圖券反覆使用 | 券核銷後立即失效，店員端才有核銷權限 |
| 前端改機率 | 客人開 DevTools 改中獎率 | 機率計算全在後端，前端只播動畫 |
| 猜碼 | 暴力嘗試 token 碼 | token 用 crypto 隨機 12 碼 + rate limit |

### 2.2 方案 A：預印一次性紙卡（主力，推薦）

**流程**：

1. 後台批次產生 500 組唯一碼（每組 8 碼英數 + 對應 QR）
2. 匯出 PDF，拿去印刷行印成小卡或貼紙（約 A4 一張 10 格，成本每張 0.3~0.5 元）
3. 後台**分批啟用**，一次只啟用 100 張。未啟用的碼掃了無效
4. 結帳時遞一張給客人
5. 客人回家或當場掃 QR → 抽獎

**為什麼小吃店適合這個**：

- 尖峰時段店員只需要「遞一張卡」，動作 1 秒，不用掏手機、不用點螢幕
- 老闆手不濕、不用碰手機（小吃店常在處理食物）
- 客人可以回家再抽，不佔用結帳動線
- 中老年客人不會當場操作，帶回家給小孩幫忙掃

**風險與對策**：

- 整疊卡被偷 → 分批啟用，一次只啟用 100 張，損失有上限
- 卡不小心多發 → 後台每日對帳，發放張數異常會看得出來
- 卡沒有到期概念 → 碼本身設 90 天有效期，過期無法抽

### 2.3 方案 B：店員手機動態 QR（備援）

櫃檯手機開店員後台，按「發放抽獎」產生 QR：

- 有效期 60 秒
- 只能被兌換 1 次，被掃走後畫面立刻換新
- 支援「一次發 N 張」（一桌多人時用）
- 記錄發放者、時間

**用在**：紙卡發完的時候、外送/外帶自取補發、客訴補償。

### 2.4 建議

兩種並行，後台都支援。紙卡當日常主力，動態 QR 當補發工具。

---

## 3. 獎項設計

### 3.1 設計原則

1. **100% 中獎**。「銘謝惠顧」會讓客人下次不想抽，殺傷力遠大於省下的成本
2. **主力獎項用實物**。小吃店的優勢在這：滷蛋成本 5 元，客人感知價值 12 元，CP 值遠勝現金券
3. **免單一定要設上限**。否則會有人揪 10 個人來消費 1500 元賭免單
4. **免單做成「下次折抵」不是「當場免單」**。強制產生第二次來店，而且中獎當下的興奮感一樣強
5. **大獎要看得見**。轉盤上顯示「免單」但機率極低，這個「看得到」本身就是參與動機

### 3.2 獎項表（假設客單 120 元）

| 獎項 | 類型 | 實際成本 | 感知價值 | 機率 | 名目期望成本 |
|---|---|---|---|---|---|
| 免單（下次消費全免，上限 150） | 現金券 | 82 | 150 | 0.3% | 0.25 |
| 折 50 元（滿 150 可用） | 現金券 | 50 | 50 | 0.7% | 0.35 |
| 燙青菜一份 | 實物 | 12 | 35 | 3% | 0.36 |
| 飲料一杯 | 實物 | 8 | 20 | 9% | 0.72 |
| 滷蛋一顆 | 實物 | 5 | 12 | 22% | 1.10 |
| 加麵 / 加飯 | 實物 | 4 | 10 | 25% | 1.00 |
| 折 10 元（滿 100 可用） | 現金券 | 10 | 10 | 40% | 4.00 |

**名目期望成本合計：7.78 元**（客單 6.5%）

### 3.3 核銷率修正（重要）

上面是「假設每張券都被用掉」的數字。實務上折價券核銷率遠低於 100%。

| 獎項類型 | 預估核銷率 | 修正後成本 |
|---|---|---|
| 免單 | 90%（獎太大，一定會用） | 0.23 |
| 折 50 | 70% | 0.25 |
| 燙青菜 | 55% | 0.20 |
| 飲料 | 50% | 0.36 |
| 滷蛋 | 45% | 0.50 |
| 加麵 / 加飯 | 45% | 0.45 |
| 折 10 | 30% | 1.20 |

**修正後實際期望成本：約 3.19 元 / 客**，佔客單 2.7%。

以每日 80 客計，每月活動成本約 **7,600 元**。

這個數字要拿去跟「回訪率提升帶來的增額營收」比。如果回訪頻率從每月 4 次提升到 5 次，每月增額營收 = 80 客 × 120 元 × 25% = 2,400 元/日，遠超成本。

### 3.4 券的規則設定

| 參數 | 建議值 | 理由 |
|---|---|---|
| 有效期 | 21 天 | 小吃店回訪頻率高，21 天涵蓋 3 週，過短會讓客人反感，過長失去急迫感 |
| 每次消費可用張數 | 1 張 | 防止累積一疊券一次用光 |
| 是否可轉讓 | 否 | 綁定 LINE 帳號 |
| 現金券使用門檻 | 折 10 需滿 100、折 50 需滿 150 | 保護毛利，同時推高客單 |
| 實物券門檻 | 無門檻 | 成本低，門檻會降低核銷率也降低回訪動機 |
| 可否與其他優惠併用 | 否 | 條款寫清楚 |

### 3.5 稀有度呈現

轉盤/拉霸的視覺上要讓小獎也有儀式感。滷蛋做成金色特效，客人會截圖分享。這比獎品本身值錢。

---

## 4. 使用者流程

### 4.1 關鍵設計：先抽獎，後登入

**不要**一進頁面就要求登入。要求登入會流失 40~60% 的人。

正確順序：

```
掃 QR
  ↓
直接看到轉盤（不需登入）
  ↓
按「開始抽獎」→ 動畫 → 中獎！
  ↓
「你抽中了 滷蛋一顆 🥚」
  ↓
「用 LINE 登入，把獎品存進你的券包」  ← 這裡才要登入
  ↓
登入完成，券進入券包，顯示到期日
```

先給多巴胺，再要帳號。客人已經知道自己中了什麼，登入意願會高很多。

**技術上**：抽獎結果在後端產生並綁定 token，暫存 30 分鐘。登入後把該 token 的中獎結果轉移到使用者帳號。沒登入就是沒領，30 分鐘後失效。

### 4.2 完整頁面流程

| 頁面 | 路徑 | 說明 |
|---|---|---|
| 入口 | `/d/[code]` | 掃 QR 進來，驗證 token 有效性 |
| 抽獎 | `/d/[code]` | 轉盤動畫，按鈕觸發後端 API |
| 結果 | `/d/[code]/result` | 顯示獎品，引導登入 |
| 登入 | `/login` | LINE Login 為主，Email magic link 備援 |
| 券包 | `/wallet` | 我的券，依到期日排序，未使用在上 |
| 券詳情 | `/wallet/[id]` | 大字顯示 6 位核銷碼 + QR，店員掃 |
| 抽獎紀錄 | `/history` | 歷史中獎紀錄 |
| 活動辦法 | `/rules` | 機率公告、條款、個資聲明 |

### 4.3 錯誤狀態處理

每個都要有明確畫面，不能只丟 error：

- token 不存在 → 「這組序號無效，請確認 QR 是否完整」
- token 已使用 → 「這組序號已經被使用過了，中獎結果是 XXX」（顯示原本結果，避免爭議）
- token 未啟用 → 「這組序號尚未開放，請洽店家」
- token 過期 → 「這組序號已超過使用期限」
- 動態 QR 過期 → 「QR 已過期，請店家重新產生」

---

## 5. 店員 / 老闆流程

### 5.1 店員端（手機網頁，`/staff`）

用簡單 PIN 登入，不用帳密。

| 功能 | 說明 |
|---|---|
| 核銷券 | 掃客人 QR 或輸入 6 位碼 → 顯示獎品內容 → 按確認核銷 |
| 發放動態 QR | 按鈕產生一次性 QR，可選張數 |
| 今日統計 | 今日發放數、抽獎數、核銷數 |

**核銷畫面要大字、高對比**，店員手濕、光線亂、動作要快。確認鍵要夠大避免誤觸。

核銷後顯示 3 秒綠色全螢幕「核銷成功 ✓ 滷蛋一顆」，讓廚房那邊也看得到。

### 5.2 老闆後台（`/admin`）

完整規格見 [`ADMIN.md`](./ADMIN.md)。核心概念：**所有參數都在後台改，改完立即生效，不用重新部署。**

| 頁面 | 功能 |
|---|---|
| 儀表板 | 今日/本週/本月：發放、抽獎、核銷、實際成本、新客數、回訪率 |
| 獎項管理 | 調整獎項、機率、成本、庫存、上下架，**含即時期望成本試算與模擬器** |
| 序號管理 | 批次產生、分批啟用、作廢、匯出印刷 PDF |
| 券管理 | 查詢所有券、手動作廢、手動補發 |
| 會員名單 | LINE 名單、消費次數、最後來店日、匯出 CSV |
| 店員管理 | 新增店員、PIN 管理、查每位店員發放/核銷紀錄與對帳 |
| 報表 | 名目成本 vs 實際核銷成本、獎項分佈、時段分析 |
| 設定 | 品牌、活動規則、成本煞車、活動辦法內文、活動總開關 |

### 5.3 對帳機制

後台每日自動比對：

```
當日啟用序號數  vs  當日實際來客數
當日抽獎數      vs  當日發放數
```

差異超過閾值（例如 20%）自動標紅。這是抓店員私發的主要手段。

---

## 6. 資料庫設計

Supabase (PostgreSQL)。所有表開 RLS。

### 6.0 兩個必須遵守的原則

**原則一：獎項只能停用，不能刪除。**已發出的券會參照到獎項，硬刪會造成孤兒資料與報表斷裂。後台的「刪除」按鈕實際執行 `is_active = false`。

**原則二：券必須快照中獎當下的獎項內容。**

這是很容易踩的坑。如果 `coupons` 只存 `prize_id`，顯示時 join `prizes` 撈名稱，那老闆在後台把「滷蛋一顆」改名成「豆干一份」的瞬間，**所有已發出但還沒核銷的滷蛋券會全部變成豆干券**。客人抽到的東西被追溯性竄改，這是實打實的客訴。

解法：抽獎當下把獎項內容整包 snapshot 成 jsonb 存進 token，領取時複製到 coupon。之後老闆怎麼改後台，已發出的券都不受影響。`prize_id` 保留純粹作為報表分組用。

同理，`cost` 也要快照。成本會浮動（滷蛋今天 5 元下個月 6 元），報表要算的是「當時的成本」。

### 6.1 Schema

```sql
-- 全域設定（單列表，id 固定為 1）
create table settings (
  id                       int primary key default 1 check (id = 1),

  -- 品牌
  shop_name                text not null default '',
  logo_url                 text,
  primary_color            text default '#E4572E',

  -- 活動開關
  campaign_active          boolean default false,
  campaign_start_at        timestamptz,
  campaign_end_at          timestamptz,
  paused_reason            text,

  -- 活動規則
  default_valid_days       int  default 21,   -- 券預設有效天數
  max_coupons_per_visit    int  default 1,    -- 每次消費限用幾張券
  card_token_valid_days    int  default 90,   -- 紙卡序號有效天數
  dynamic_token_ttl_sec    int  default 60,   -- 動態 QR 存活秒數
  claim_window_minutes     int  default 30,   -- 抽完到登入領取的時限
  allow_stack_promo        boolean default false,

  -- 成本試算基準（報表用，不影響邏輯）
  avg_ticket               int  default 120,
  gross_margin_pct         int  default 55,
  daily_customers          int  default 80,

  -- 成本煞車
  monthly_cost_cap         int,               -- null = 不限
  cost_cap_action          text default 'notify',  -- 'notify' | 'pause'
  cost_cap_notified_at     timestamptz,

  -- 保底機制
  pity_enabled             boolean default false,
  pity_threshold           int  default 20,

  -- 活動辦法（後台可編輯的富文本）
  rules_content            text default '',

  updated_at               timestamptz default now(),
  updated_by               uuid
);
insert into settings (id) values (1);

-- 獎項設定（可隨時在後台調整）
create table prizes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,              -- 「滷蛋一顆」
  type          text not null,              -- 'item' | 'cash' | 'free_meal'
  face_value    int not null,               -- 感知價值（顯示用）
  cost          int not null,               -- 實際成本（報表用）
  discount_amt  int,                        -- 現金券折抵金額
  min_spend     int default 0,              -- 使用門檻
  max_discount  int,                        -- 免單上限
  weight        int not null,               -- 權重（非百分比，避免浮點誤差）
  stock         int,                        -- null = 無限
  stock_used    int default 0,
  valid_days    int,                        -- null = 用 settings.default_valid_days
  terms         text,                       -- 這張券的專屬使用條件
  image_url     text,
  color         text,                       -- 轉盤上的區塊顏色
  sort_order    int default 0,
  is_active     boolean default true,       -- 停用而非刪除
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 獎項異動紀錄（爭議舉證 + 防止偷改機率）
create table prize_change_log (
  id            uuid primary key default gen_random_uuid(),
  prize_id      uuid references prizes(id),
  changed_by    uuid,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz default now()
);
create index on prize_change_log (created_at desc);

-- 使用者
create table users (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text unique,
  email         text unique,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz default now(),
  last_visit_at timestamptz,
  visit_count   int default 0,
  is_blocked    boolean default false
);

-- 抽獎序號（紙卡 + 動態 QR 共用）
create table draw_tokens (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,       -- 8 碼英數（紙卡）或 12 碼（動態）
  kind          text not null,              -- 'card' | 'dynamic'
  batch_id      uuid references token_batches(id),
  status        text not null default 'inactive',
                -- 'inactive' | 'active' | 'drawn' | 'claimed' | 'expired' | 'voided'
  issued_by     uuid references staff(id),
  issued_at     timestamptz,
  expires_at    timestamptz,
  drawn_at      timestamptz,                -- 抽獎時間
  prize_id      uuid references prizes(id), -- 抽中什麼（報表分組用）
  prize_snapshot jsonb,                     -- 中獎當下的獎項完整內容（見 §6.0 原則二）
  claimed_by    uuid references users(id),  -- 誰領走的
  claimed_at    timestamptz,
  ip_hash       text,                       -- 防刷用
  created_at    timestamptz default now()
);
create index on draw_tokens (code);
create index on draw_tokens (status, expires_at);

-- 序號批次
create table token_batches (
  id            uuid primary key default gen_random_uuid(),
  name          text,                       -- 「2026-08 第一批」
  quantity      int not null,
  activated_qty int default 0,
  note          text,
  created_at    timestamptz default now()
);

-- 券（中獎後領取才產生）
create table coupons (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) not null,
  token_id      uuid references draw_tokens(id) unique not null,
  redeem_code   text unique not null,       -- 6 位數字，店員輸入用

  -- 報表分組用（顯示一律不看這個）
  prize_id      uuid references prizes(id) not null,

  -- 中獎當下的快照。後台改獎項不影響已發出的券
  prize_name    text not null,
  prize_type    text not null,
  face_value    int  not null,
  cost_at_draw  int  not null,              -- 當時成本，報表用
  discount_amt  int,
  min_spend     int  default 0,
  max_discount  int,
  terms         text,
  image_url     text,

  status        text not null default 'active',
                -- 'active' | 'used' | 'expired' | 'voided'
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       uuid references staff(id),
  void_reason   text,
  created_at    timestamptz default now()
);
create index on coupons (user_id, status);
create index on coupons (redeem_code);

-- 店員
create table staff (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  pin_hash      text not null,
  role          text default 'staff',       -- 'staff' | 'owner'
  is_active     boolean default true,
  created_at    timestamptz default now()
);

-- 操作稽核（爭議時的證據）
create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_type    text,                       -- 'user' | 'staff' | 'system'
  actor_id      uuid,
  action        text not null,              -- 'issue_token' | 'draw' | 'claim' | 'redeem' | 'void'
  target_type   text,
  target_id     uuid,
  detail        jsonb,
  ip_hash       text,
  created_at    timestamptz default now()
);
create index on audit_logs (created_at desc);
```

### 6.2 狀態機

**draw_tokens**：

```
inactive ──啟用──▶ active ──抽獎──▶ drawn ──登入領取──▶ claimed
                     │                 │
                     └──過期──▶ expired ◀┘（30分鐘未領取）
                     │
                     └──後台作廢──▶ voided
```

**coupons**：

```
active ──店員核銷──▶ used
   │
   ├──到期──▶ expired
   └──後台作廢──▶ voided
```

### 6.3 併發安全

抽獎與核銷都要防 race condition。用 Postgres 的原子更新，不要「先查再寫」：

```sql
-- 抽獎：只有 active 才能轉成 drawn，用 WHERE 保證原子性
update draw_tokens
set status = 'drawn', prize_id = $1, drawn_at = now()
where code = $2 and status = 'active' and expires_at > now()
returning *;
-- 回傳 0 列 = 已被別人抽走或無效
```

```sql
-- 核銷：同理
update coupons
set status = 'used', used_at = now(), used_by = $1
where redeem_code = $2 and status = 'active' and expires_at > now()
returning *;
```

有庫存限制的獎項，扣庫存要放在同一個 transaction 裡。

---

## 7. 抽獎演算法

**全部在後端執行。前端只負責播動畫，動畫結果由後端回傳決定。**

```
1. 撈出 is_active = true 且 (stock is null or stock_used < stock) 的獎項
2. 計算 totalWeight = sum(weight)
3. r = crypto.randomInt(0, totalWeight)   ← 用 crypto，不要 Math.random()
4. 累加權重找到落點
5. 在同一個 transaction 內：
   - update draw_tokens 狀態（帶 WHERE status='active'）
   - update prizes stock_used += 1
   - insert audit_logs
6. 回傳獎項給前端
```

**用 weight 整數而非百分比**，避免浮點數累加誤差。後台顯示時再換算成百分比。

**保底機制（可選）**：同一 LINE 帳號連續 20 次都抽到最小獎，第 21 次強制給中等以上獎項。這會提升熟客體感，成本增加極小。

---

## 8. 技術架構

| 層 | 選型 | 理由 |
|---|---|---|
| 框架 | Next.js 16 (App Router) | 你已熟悉，Server Actions 適合這種簡單 CRUD |
| 資料庫 | Supabase (Postgres) | 你在 Ongsa 已用過，RLS 好用，免費額度夠 |
| 登入 | LINE Login (OAuth 2.0) | 台灣普及率 90%+ |
| 備援登入 | Supabase Auth Magic Link | 給沒 LINE 的客人 |
| 樣式 | Tailwind CSS | |
| 動畫 | Framer Motion 或純 CSS | 轉盤用 CSS transform + cubic-bezier 就夠 |
| QR 產生 | `qrcode` npm | |
| QR 掃描 | `html5-qrcode` | 店員端掃券用 |
| PDF 匯出 | `pdf-lib` 或 `@react-pdf/renderer` | 紙卡排版 |
| 部署 | Vercel | |
| 網域 | 短網域（例如 `xxx.tw`） | QR 內容越短，圖案越簡單越好掃 |

**QR 網址設計**：`https://短網域/d/A7K2M9P4`

網址越短，QR 的 module 密度越低，用便宜印刷、小尺寸、油污環境下也掃得動。這對小吃店很重要。避免用 UUID 當網址。

### 8.1 API 端點

| Method | 路徑 | 說明 | 保護 |
|---|---|---|---|
| GET | `/api/token/[code]` | 查 token 狀態 | rate limit |
| POST | `/api/draw` | 執行抽獎 | rate limit + token 驗證 |
| POST | `/api/claim` | 登入後領取獎品 | 需登入 |
| GET | `/api/wallet` | 我的券 | 需登入 |
| POST | `/api/staff/issue` | 產生動態 QR | 需店員 |
| POST | `/api/staff/redeem` | 核銷券 | 需店員 |
| GET | `/api/admin/stats` | 統計 | 需 owner |
| POST | `/api/admin/batch` | 產生序號批次 | 需 owner |

**Rate limit**：以 IP 為單位，`/api/draw` 每分鐘 5 次、`/api/token/*` 每分鐘 20 次。用 Upstash Redis 或 Supabase 自建。

### 8.2 安全檢查清單

- [ ] 機率計算 100% 在後端
- [ ] 所有狀態轉換用原子 UPDATE + WHERE 條件
- [ ] Supabase service role key 只在 Server Action / Route Handler 使用，絕不出現在 client bundle
- [ ] 所有表開 RLS，使用者只能讀自己的 coupons
- [ ] 店員 PIN 用 bcrypt hash
- [ ] admin 路由用 middleware 保護，比對 email 白名單
- [ ] token code 用 `crypto.randomBytes`，不用時間戳或流水號
- [ ] 排除易混淆字元（0/O、1/I/l），紙卡用大寫 + 數字，字集 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
- [ ] rate limit
- [ ] audit log 記錄所有敏感操作

---

## 9. 法規與注意事項（台灣）

### 9.1 抽獎活動

「消費即可參加」的抽獎屬於**促銷活動**，不需要事前許可。但要注意：

- **公平交易法**：活動辦法（獎項、機率、期限、使用條件）必須明確公告，不可有誤導性標示。頁面要有 `/rules` 且從抽獎頁可點進去
- **獎項機率必須真實**。公告 0.3% 就要真的是 0.3%。後台調機率要留 audit log
- **免單獎的稅務**：個人中獎所得單次超過 2 萬元需扣繳並開扣繳憑單。本活動最大獎 150 元，不觸及

### 9.2 個資法

- 收集 LINE ID、姓名、頭像屬個資，登入頁必須有**告知同意**：蒐集目的、使用範圍、保存期限、當事人權利
- 提供刪除帳號功能
- 不得將名單提供第三方

### 9.3 消費者保護

- 券的使用條件（門檻、有效期、不可併用、不找零）要在券的畫面上直接寫清楚，不能只寫在條款頁
- 活動如果要提前終止，已發出的券必須讓客人用完，或提供等值補償

### 9.4 建議條款要寫的

```
1. 每次消費（不限金額 / 或滿 XX 元）可獲得抽獎序號一組
2. 序號僅限使用一次，遺失恕不補發
3. 獎項機率如下：（完整表格）
4. 券有效期 21 天，逾期自動失效
5. 每次消費限用一張券，不可與其他優惠併用
6. 券不得轉讓、兌換現金、不找零
7. 免單獎折抵上限 150 元，超過部分需自付
8. 本店保留活動修改與終止之權利，但已發出之券權益不受影響
9. 個資僅用於本活動與本店行銷通知
```

---

## 10. 開發階段規劃

### Phase 1：MVP（可上線試跑）

估 3~5 天

- [ ] Supabase 建表 + RLS
- [ ] 抽獎頁 `/d/[code]`：驗證 token + 轉盤動畫 + 後端抽獎 API
- [ ] LINE Login + 領取流程
- [ ] 券包 `/wallet` + 券詳情（核銷碼）
- [ ] 店員端 `/staff`：核銷（輸入 6 碼）
- [ ] 後台 `/admin`：序號批次產生 + 啟用 + 獎項設定
- [ ] 活動辦法頁

### Phase 2：實務工具

估 2~3 天

- [ ] 紙卡 PDF 匯出（含排版模板）
- [ ] 店員端動態 QR 發放
- [ ] 店員端 QR 掃描核銷（比手動輸入快）
- [ ] 後台儀表板 + 成本報表
- [ ] Email magic link 備援登入

### Phase 3：留客與成長

估 2~3 天

- [ ] LINE 官方帳號整合，券到期前 3 天推播提醒（這個對回訪率影響最大）
- [ ] 會員名單匯出
- [ ] 保底機制
- [ ] 分享機制：中獎畫面可分享到 LINE / IG，帶 OG image
- [ ] 對帳異常告警

### Phase 4：優化

- [ ] 抽獎動畫優化、音效
- [ ] 節慶限定獎項
- [ ] 生日券自動發放

---

## 11. 上線前檢查

### 技術

- [ ] 用測試序號跑完整流程 10 次
- [ ] 同一序號重複掃，確認擋得住
- [ ] 兩支手機同時掃同一序號，確認只有一個成功（併發測試）
- [ ] 抽 1000 次驗證機率分佈接近設定值
- [ ] 券核銷後再掃一次，確認擋得住
- [ ] 老人家的舊手機測試（Android 8 / iOS 14）
- [ ] 弱網環境測試（抽獎中斷網會怎樣）
- [ ] 店內實際光線下掃 QR 測試

### 營運

- [ ] 店員教育訓練，核銷流程演練
- [ ] 印製活動告示（桌牌、牆貼），寫清楚怎麼玩
- [ ] 準備實物獎品庫存（滷蛋、飲料要備足）
- [ ] 決定第一批序號數量（建議 200 張，跑一週看數據再調）
- [ ] 設定成本上限告警值

### 試跑期

**建議先跑 2 週，只發 200~300 張**，觀察：

- 掃碼率（發出去多少張、實際幾張被抽）
- 登入轉換率（抽獎後幾成願意登入）
- 核銷率（券發出後幾成被用掉）
- 回訪間隔變化

這三個數字出來後再調整機率表跟券的有效期。掃碼率如果低於 50%，代表告示不清楚或 QR 不好掃，要先解決這個再談其他。

---

## 12. 需要決定的事

1. 店名、品牌色、字體風格
2. 抽獎次數門檻：不限金額 vs 滿額才給（建議不限金額，小吃店客單差異小）
3. 實物獎品的實際品項與成本（要你提供真實數字）
4. 是否申請 LINE 官方帳號（強烈建議，推播提醒是整個系統回訪率的關鍵）
5. 短網域要不要買
6. 第一批印多少張紙卡、印在什麼材質
