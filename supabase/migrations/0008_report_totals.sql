-- ================================================================
-- 報表加總移回 SQL
--
-- 原本後台首頁與點數頁的做法是：把符合條件的資料列整批拉回 Node，
-- 再用 JS 的 reduce 加總。
--
-- 問題出在 PostgREST 單次回傳有筆數上限（Supabase 預設 1000 筆）。
-- 超過上限它會直接截斷，而且**不會報錯**，回來的仍然是一個看起來
-- 正常的陣列。所以加總出來的數字會偏小，畫面上沒有任何異常。
--
-- 以每天 80 客估算，balance_transactions 大約兩週就會超過 1000 筆。
-- 從那天開始，老闆看到的「本月折抵」「流通中點數」全部是錯的，而且
-- 要對帳到某個程度才會發現。這是會影響決策的數字，不能靠運氣。
--
-- 這個函式把加總留在資料庫做，回傳單獨一列。順帶把首頁原本 12 次
-- 平行查詢縮成 1 次往返。
--
-- 註：本專案的 Supabase 關閉了 PostgREST 的聚合函式（查詢會回
-- 「Use of aggregate functions is not allowed」），所以只能走 RPC，
-- 不能在 select 裡寫 amount.sum()。
-- ================================================================

create or replace function report_totals(
  p_day_start   timestamptz,
  p_month_start timestamptz,
  p_warn_cutoff timestamptz
)
returns table (
  today_issued        bigint,
  today_drawn         bigint,
  today_spend_count   bigint,
  today_spend_total   bigint,

  month_spend_total   bigint,
  month_earn_total    bigint,
  month_expire_total  bigint,
  month_new_members   bigint,

  -- 客人手上還沒用掉的餘額。這是帳面負債
  outstanding         bigint,
  outstanding_people  bigint,
  expiring_amount     bigint,
  expiring_people     bigint,

  active_tokens       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from draw_tokens where issued_at >= p_day_start),
    (select count(*) from draw_tokens where drawn_at  >= p_day_start),

    /*
      金額一律取絕對值後加總，跟原本 JS 端 Math.abs() 的行為一致。
      spend 在流水帳裡存的是負數，直接 sum 會得到負的折抵總額。
    */
    (select count(*) from balance_transactions
      where type = 'spend' and created_at >= p_day_start),
    (select coalesce(sum(abs(amount)), 0) from balance_transactions
      where type = 'spend' and created_at >= p_day_start),

    (select coalesce(sum(abs(amount)), 0) from balance_transactions
      where type = 'spend' and created_at >= p_month_start),
    (select coalesce(sum(abs(amount)), 0) from balance_transactions
      where type = 'earn' and created_at >= p_month_start),
    (select coalesce(sum(abs(amount)), 0) from balance_transactions
      where type = 'expire' and created_at >= p_month_start),
    (select count(*) from users where created_at >= p_month_start),

    (select coalesce(sum(balance), 0) from users where balance > 0),
    (select count(*) from users where balance > 0),

    /*
      到期日為 null 的不算。SQL 的 null < 值 會得到 null 而非 true，
      這跟原本 PostgREST 的 .lt() 行為相同，保持一致。
    */
    (select coalesce(sum(balance), 0) from users
      where balance > 0 and balance_expires_at < p_warn_cutoff),
    (select count(*) from users
      where balance > 0 and balance_expires_at < p_warn_cutoff),

    (select count(*) from draw_tokens where status = 'active');
$$;


-- ----------------------------------------------------------------
-- 上面幾個 where 用到的欄位。
--
-- balance_transactions 已經有 (type, created_at desc) 的索引，
-- users 已經有 (balance_expires_at) where balance > 0 與 (created_at)。
-- 缺的只有「餘額大於零」這個條件本身，流通中點數與人數都靠它。
-- ----------------------------------------------------------------
create index if not exists users_positive_balance_idx
  on users (balance)
  where balance > 0;
