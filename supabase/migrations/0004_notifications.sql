-- ================================================================
-- LINE 推播
--
-- 每月只有 200 則額度，而且客人收到重複訊息會直接封鎖，
-- 所以防重複比推播本身更重要。
-- ================================================================

-- ----------------------------------------------------------------
-- notifications：推播紀錄
--
-- dedup_key 是防重複的核心。到期提醒的 key 帶上「這次的到期日」，
-- 所以：
--   同一個到期日只會推一次（不會連續七天每天煩客人）
--   客人來店消費後到期日往後滾，變成新的 key，下次到期前會再推一次
-- ----------------------------------------------------------------
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) not null,

  type        text not null,            -- 'expiry_warning'
  dedup_key   text not null,

  status      text not null default 'sent'
                check (status in ('sent', 'failed', 'blocked')),
  error       text,
  detail      jsonb,

  created_at  timestamptz not null default now(),

  -- 同一個人、同一種類型、同一個情境，只會有一筆
  unique (user_id, type, dedup_key)
);

create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_created_idx on notifications (created_at desc);

alter table notifications enable row level security;

comment on column notifications.dedup_key is
  '防重複鍵。到期提醒用 expiry:YYYY-MM-DD（該次的到期日），'
  '到期日往後滾之後會變成新的 key，下個週期才會再推一次';


-- ----------------------------------------------------------------
-- users：記錄無法推播的對象
--
-- 客人封鎖官方帳號或刪好友之後，push API 會回 403。
-- 標記起來就不再浪費額度重試。
-- ----------------------------------------------------------------
alter table users
  add column line_unreachable_at timestamptz;

comment on column users.line_unreachable_at is
  '推播被拒（封鎖或未加好友）的時間。有值就跳過推播，'
  '客人重新加好友後由推播成功時自動清除';


-- ----------------------------------------------------------------
-- settings：推播開關
-- ----------------------------------------------------------------
alter table settings
  add column push_enabled boolean not null default false,
  add column push_expiry_enabled boolean not null default true;

comment on column settings.push_enabled is
  '推播總開關。預設關閉，確認訊息內容與名單無誤後再由後台開啟';
