-- ================================================================
-- 小吃店消費抽獎系統 初始 schema
-- 對應 docs/PLAN.md §6
--
-- 建表順序不可調換，外鍵有相依性：
--   settings → staff → prizes → token_batches → users
--   → draw_tokens → balance_transactions → coupons
--   → prize_change_log → audit_logs
-- ================================================================

-- ----------------------------------------------------------------
-- settings：全域設定（單列表，id 固定為 1）
-- 所有活動參數都在這裡，程式碼不得寫死任何數值
-- ----------------------------------------------------------------
create table settings (
  id                       int primary key default 1 check (id = 1),

  -- 品牌
  shop_name                text not null default '',
  logo_url                 text,
  primary_color            text not null default '#E4572E',

  -- 活動開關
  campaign_active          boolean not null default false,
  campaign_start_at        timestamptz,
  campaign_end_at          timestamptz,
  paused_reason            text,

  -- 儲值金規則（對外稱「回饋點數」，見 PLAN.md §9.2）
  credit_expire_days       int not null default 90
                             check (credit_expire_days between 1 and 3650),
  max_redeem_per_visit     int not null default 30
                             check (max_redeem_per_visit >= 1),
  min_balance_to_redeem    int not null default 0
                             check (min_balance_to_redeem >= 0),
  expire_warn_days         int not null default 7
                             check (expire_warn_days >= 0),

  -- 點數包裝（純顯示層，DB 一律存「元」）
  points_display_enabled   boolean not null default true,
  points_per_dollar        int not null default 10
                             check (points_per_dollar >= 1),

  -- 活動規則
  default_valid_days       int not null default 21 check (default_valid_days >= 1),
  max_coupons_per_visit    int not null default 1  check (max_coupons_per_visit >= 1),
  card_token_valid_days    int not null default 90 check (card_token_valid_days >= 1),
  dynamic_token_ttl_sec    int not null default 60 check (dynamic_token_ttl_sec >= 10),
  claim_window_minutes     int not null default 30 check (claim_window_minutes >= 1),
  allow_stack_promo        boolean not null default false,

  -- 成本試算基準（報表用，不影響邏輯）
  avg_ticket               int not null default 120,
  gross_margin_pct         int not null default 55,
  daily_customers          int not null default 80,

  -- 成本煞車
  monthly_cost_cap         int,
  cost_cap_action          text not null default 'notify'
                             check (cost_cap_action in ('notify', 'pause')),
  cost_cap_notified_at     timestamptz,

  -- 保底機制
  pity_enabled             boolean not null default true,
  pity_threshold           int not null default 20 check (pity_threshold >= 1),

  -- 活動辦法（後台可編輯）
  rules_content            text not null default '',

  updated_at               timestamptz not null default now(),
  updated_by               uuid
);

insert into settings (id) values (1);

comment on table settings is
  '全域設定，永遠只有一列（id=1）。任何活動參數都放這裡，不可寫死在程式碼';
comment on column settings.max_redeem_per_visit is
  '單次消費最多折抵幾元。成本控制的第二道防線，redeem_balance() 會強制檢查';
comment on column settings.credit_expire_days is
  '餘額滾動到期天數。任何進出都會把 users.balance_expires_at 往後推這麼多天';

-- ----------------------------------------------------------------
-- staff：店員
-- ----------------------------------------------------------------
create table staff (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  pin_hash      text not null,
  role          text not null default 'staff' check (role in ('staff', 'owner')),
  is_active     boolean not null default true,
  failed_count  int not null default 0,
  locked_until  timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

create index staff_active_idx on staff (is_active) where is_active;

-- ----------------------------------------------------------------
-- prizes：獎項設定（可隨時在後台調整）
-- 只能停用不能刪除，已發出的券會參照這張表做報表分組
-- ----------------------------------------------------------------
create table prizes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          text not null check (type in ('credit', 'item', 'cash', 'free_meal')),

  -- type='credit' 專用：入帳金額（元）
  credit_amount int check (credit_amount is null or credit_amount >= 1),

  face_value    int not null check (face_value >= 0),   -- 感知價值，顯示用
  cost          int not null check (cost >= 0),         -- 實際成本，報表用

  discount_amt  int,                                    -- 現金券折抵金額
  min_spend     int not null default 0,                 -- 使用門檻
  max_discount  int,                                    -- 免單折抵上限

  weight        int not null check (weight >= 0),       -- 整數權重，避免浮點誤差
  stock         int check (stock is null or stock >= 0),
  stock_used    int not null default 0 check (stock_used >= 0),

  valid_days    int check (valid_days is null or valid_days >= 1),
  terms         text,
  image_url     text,
  color         text,
  sort_order    int not null default 0,
  is_active     boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- credit 類型必須有入帳金額，且成本必須等於面額（折抵時直接減收入）
  constraint prizes_credit_shape check (
    type <> 'credit'
    or (credit_amount is not null and cost = credit_amount and face_value = credit_amount)
  ),
  -- 免單必須設折抵上限，否則有人會揪團賭免單
  constraint prizes_free_meal_shape check (
    type <> 'free_meal' or max_discount is not null
  ),
  -- 現金券的門檻不可小於折抵金額（滿 50 折 100 是虧的）
  constraint prizes_cash_shape check (
    type <> 'cash'
    or (discount_amt is not null and min_spend >= discount_amt)
  )
);

create index prizes_active_idx on prizes (is_active, sort_order);

comment on constraint prizes_credit_shape on prizes is
  '儲值金的成本等於面額全額，折抵時直接減少收入，不像實物獎只有食材成本';

-- ----------------------------------------------------------------
-- token_batches：序號批次
-- ----------------------------------------------------------------
create table token_batches (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  quantity      int not null check (quantity >= 1),
  activated_qty int not null default 0 check (activated_qty >= 0),
  note          text,
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- users：會員
-- balance 只是快取，真實來源是 balance_transactions（見 PLAN.md §6.0 原則三）
-- ----------------------------------------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text unique,
  email         text unique,
  display_name  text,
  avatar_url    text,

  -- 儲值金。恆等式：balance = sum(balance_transactions.amount)
  balance             int not null default 0 check (balance >= 0),
  balance_expires_at  timestamptz,
  lifetime_earned     int not null default 0 check (lifetime_earned >= 0),
  lifetime_spent      int not null default 0 check (lifetime_spent >= 0),

  -- 店員掃這個查餘額。與 id 分開，避免對外洩漏內部 uuid
  wallet_code   text unique not null,

  created_at    timestamptz not null default now(),
  last_visit_at timestamptz,
  visit_count   int not null default 0,
  is_blocked    boolean not null default false,

  -- 至少要有一種登入方式
  constraint users_identity check (line_user_id is not null or email is not null)
);

create index users_wallet_code_idx on users (wallet_code);
create index users_expiring_idx on users (balance_expires_at) where balance > 0;
create index users_line_idx on users (line_user_id) where line_user_id is not null;

comment on column users.balance is
  '快取值。唯一真實來源是 balance_transactions，兩者必須永遠相等（見 check_balance_integrity()）';

-- ----------------------------------------------------------------
-- draw_tokens：抽獎序號（紙卡 + 動態 QR 共用）
-- ----------------------------------------------------------------
create table draw_tokens (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  kind          text not null check (kind in ('card', 'dynamic')),
  batch_id      uuid references token_batches(id),

  status        text not null default 'inactive'
                  check (status in ('inactive', 'active', 'drawn',
                                    'claimed', 'expired', 'voided')),

  issued_by     uuid references staff(id),
  issued_at     timestamptz,
  expires_at    timestamptz,

  drawn_at      timestamptz,
  prize_id      uuid references prizes(id),
  -- 中獎當下的獎項完整內容。後台改獎項不影響已抽出的結果
  prize_snapshot jsonb,

  claimed_by    uuid references users(id),
  claimed_at    timestamptz,

  ip_hash       text,
  created_at    timestamptz not null default now()
);

create index draw_tokens_code_idx on draw_tokens (code);
create index draw_tokens_status_idx on draw_tokens (status, expires_at);
create index draw_tokens_batch_idx on draw_tokens (batch_id, status);
create index draw_tokens_claimed_idx on draw_tokens (claimed_by, drawn_at desc);

comment on column draw_tokens.prize_snapshot is
  '抽獎當下的獎項快照。避免老闆改後台導致已抽出的獎項被追溯性竄改';

-- ----------------------------------------------------------------
-- balance_transactions：餘額流水帳
-- 這張表是餘額的唯一真實來源。任何餘額變動都必須在這裡留一筆
-- ----------------------------------------------------------------
create table balance_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) not null,

  type          text not null check (type in ('earn', 'spend', 'expire', 'adjust')),
  amount        int not null check (amount <> 0),  -- 正為進帳，負為扣除
  balance_after int not null check (balance_after >= 0),

  source_type   text check (source_type in ('draw', 'redeem', 'cron', 'admin')),
  source_id     uuid,
  staff_id      uuid references staff(id),
  note          text,

  -- 冪等鍵。店員在收訊差的環境重複按確認時，防止重複扣款
  idempotency_key text unique,

  created_at    timestamptz not null default now()
);

create index bt_user_idx on balance_transactions (user_id, created_at desc);
create index bt_created_idx on balance_transactions (created_at desc);
create index bt_type_idx on balance_transactions (type, created_at desc);
create index bt_source_idx on balance_transactions (source_type, source_id);

comment on table balance_transactions is
  '餘額流水帳。users.balance 只是快取，這裡才是帳本。爭議舉證、對帳、報表都靠這張表';

-- ----------------------------------------------------------------
-- coupons：實物券 / 免單券
-- 只有 type != 'credit' 的獎項才產生。儲值金直接進 users.balance
-- ----------------------------------------------------------------
create table coupons (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) not null,
  token_id      uuid references draw_tokens(id) unique not null,
  redeem_code   text unique not null,

  -- 報表分組用。顯示一律不看這個，看下面的快照欄位
  prize_id      uuid references prizes(id) not null,

  -- 中獎當下的快照
  prize_name    text not null,
  prize_type    text not null,
  face_value    int not null,
  cost_at_draw  int not null,
  discount_amt  int,
  min_spend     int not null default 0,
  max_discount  int,
  terms         text,
  image_url     text,

  status        text not null default 'active'
                  check (status in ('active', 'used', 'expired', 'voided')),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       uuid references staff(id),
  void_reason   text,
  created_at    timestamptz not null default now()
);

create index coupons_user_idx on coupons (user_id, status);
create index coupons_redeem_idx on coupons (redeem_code);
create index coupons_expiring_idx on coupons (expires_at) where status = 'active';

-- ----------------------------------------------------------------
-- prize_change_log：獎項異動紀錄
-- 公平交易法要求公告機率必須真實，有爭議時這是證據
-- ----------------------------------------------------------------
create table prize_change_log (
  id            uuid primary key default gen_random_uuid(),
  prize_id      uuid references prizes(id),
  changed_by    uuid references staff(id),
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

create index pcl_created_idx on prize_change_log (created_at desc);

-- ----------------------------------------------------------------
-- audit_logs：操作稽核
-- ----------------------------------------------------------------
create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_type    text check (actor_type in ('user', 'staff', 'system')),
  actor_id      uuid,
  action        text not null,
  target_type   text,
  target_id     uuid,
  detail        jsonb,
  ip_hash       text,
  created_at    timestamptz not null default now()
);

create index audit_created_idx on audit_logs (created_at desc);
create index audit_action_idx on audit_logs (action, created_at desc);
create index audit_actor_idx on audit_logs (actor_type, actor_id, created_at desc);

-- ================================================================
-- RLS
--
-- 這個應用的所有資料存取都走 service_role key（伺服器端），
-- service_role 會繞過 RLS。開啟 RLS 且不建任何 policy 的用意是：
-- 萬一 anon key 外洩，或有人誤用 client 端 supabase-js 直接查表，
-- 一列都讀不到。這是縱深防禦。
-- ================================================================
alter table settings             enable row level security;
alter table staff                enable row level security;
alter table prizes               enable row level security;
alter table token_batches        enable row level security;
alter table users                enable row level security;
alter table draw_tokens          enable row level security;
alter table balance_transactions enable row level security;
alter table coupons              enable row level security;
alter table prize_change_log     enable row level security;
alter table audit_logs           enable row level security;
