-- ================================================================
-- 序號批次統計
--
-- 後台的序號頁原本對每個批次分別發 4 次 count 查詢，而且批次之間
-- 是循序等待的。10 個批次就是 40 次查詢分 10 輪往返，批次越多越慢。
--
-- 改成一次 GROUP BY 拿回全部。draw_tokens (batch_id, status) 上
-- 已經有索引，這個查詢走得到。
-- ================================================================

create or replace function batch_stats()
returns table (
  batch_id  uuid,
  inactive  bigint,
  active    bigint,
  drawn     bigint,
  claimed   bigint,
  expired   bigint,
  voided    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.batch_id,
    count(*) filter (where t.status = 'inactive'),
    count(*) filter (where t.status = 'active'),
    count(*) filter (where t.status = 'drawn'),
    count(*) filter (where t.status = 'claimed'),
    count(*) filter (where t.status = 'expired'),
    count(*) filter (where t.status = 'voided')
  from draw_tokens t
  where t.batch_id is not null
  group by t.batch_id;
$$;


-- ----------------------------------------------------------------
-- 儀表板每次載入都會依時間範圍統計這兩個欄位。
-- 資料量還小的時候沒差，但序號會隨著營運累積，這兩個索引很便宜。
-- ----------------------------------------------------------------
create index if not exists draw_tokens_issued_at_idx
  on draw_tokens (issued_at desc)
  where issued_at is not null;

create index if not exists draw_tokens_drawn_at_idx
  on draw_tokens (drawn_at desc)
  where drawn_at is not null;

create index if not exists users_created_at_idx
  on users (created_at desc);
