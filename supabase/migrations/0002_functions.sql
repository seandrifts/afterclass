-- ================================================================
-- 原子操作函式
-- 對應 docs/PLAN.md §6.3 ~ §6.6
--
-- 核心原則：所有涉及餘額或狀態轉換的邏輯都放在資料庫，
-- 條件寫在 WHERE 而不是應用層的 if。
-- 「先查再寫」在併發下必然出錯，這裡一律不用。
-- ================================================================

-- ----------------------------------------------------------------
-- earn_balance：抽獎入帳
--
-- 同時把到期日往後滾 credit_expire_days 天。
-- ----------------------------------------------------------------
create or replace function earn_balance(
  p_user_id   uuid,
  p_amount    int,
  p_source_id uuid
)
returns table (new_balance int, expires_at timestamptz, txn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expire_days int;
  v_balance     int;
  v_expires     timestamptz;
  v_txn_id      uuid;
begin
  if p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using hint = '入帳金額必須大於 0';
  end if;

  select credit_expire_days into v_expire_days from settings where id = 1;

  update users
     set balance            = balance + p_amount,
         lifetime_earned    = lifetime_earned + p_amount,
         balance_expires_at = now() + make_interval(days => v_expire_days),
         last_visit_at      = now(),
         visit_count        = visit_count + 1
   where id = p_user_id
     and is_blocked = false
   returning balance, balance_expires_at into v_balance, v_expires;

  if not found then
    raise exception 'USER_NOT_FOUND_OR_BLOCKED';
  end if;

  insert into balance_transactions
    (user_id, type, amount, balance_after, source_type, source_id)
  values
    (p_user_id, 'earn', p_amount, v_balance, 'draw', p_source_id)
  returning id into v_txn_id;

  return query select v_balance, v_expires, v_txn_id;
end;
$$;


-- ----------------------------------------------------------------
-- redeem_balance：店員折抵
--
-- 這是整個系統最危險的操作。客人兩支手機同時出示、店員誤觸兩次，
-- 都可能造成重複扣款或餘額變負數。
--
-- 三層保護：
--   1. idempotency_key 擋重複請求
--   2. 扣款條件寫在 WHERE，不是應用層的 if
--   3. users.balance 有 check (balance >= 0) 當最後保險
-- ----------------------------------------------------------------
create or replace function redeem_balance(
  p_user_id         uuid,
  p_amount          int,
  p_staff_id        uuid,
  p_idempotency_key text
)
returns table (new_balance int, txn_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_per_visit int;
  v_min_balance   int;
  v_expire_days   int;
  v_balance       int;
  v_txn_id        uuid;
  v_existing      balance_transactions%rowtype;
begin
  -- 1. 冪等檢查。重送同一個 key 直接回傳原本結果，不重複扣款
  select * into v_existing
    from balance_transactions
   where idempotency_key = p_idempotency_key;

  if found then
    return query select v_existing.balance_after, v_existing.id, true;
    return;
  end if;

  select max_redeem_per_visit, min_balance_to_redeem, credit_expire_days
    into v_max_per_visit, v_min_balance, v_expire_days
    from settings where id = 1;

  if p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using hint = '折抵金額必須大於 0';
  end if;

  -- 單次上限在後端強制檢查，不能只靠前端擋
  if p_amount > v_max_per_visit then
    raise exception 'EXCEEDS_PER_VISIT_LIMIT'
      using hint = format('單次折抵上限為 %s 元', v_max_per_visit);
  end if;

  -- 2. 扣款。條件放在 WHERE，餘額不足時直接不更新
  update users
     set balance            = balance - p_amount,
         lifetime_spent     = lifetime_spent + p_amount,
         -- 折抵也算異動，到期日往後滾
         balance_expires_at = now() + make_interval(days => v_expire_days),
         last_visit_at      = now()
   where id = p_user_id
     and balance >= p_amount
     and balance >= v_min_balance
     and is_blocked = false
   returning balance into v_balance;

  if not found then
    raise exception 'INSUFFICIENT_BALANCE'
      using hint = '餘額不足、未達折抵門檻，或帳號已封鎖';
  end if;

  insert into balance_transactions
    (user_id, type, amount, balance_after, source_type, staff_id, idempotency_key)
  values
    (p_user_id, 'spend', -p_amount, v_balance, 'redeem', p_staff_id, p_idempotency_key)
  returning id into v_txn_id;

  return query select v_balance, v_txn_id, false;
end;
$$;


-- ----------------------------------------------------------------
-- undo_redeem：撤銷折抵
--
-- 小吃店結帳出錯很常見，沒有這個功能客訴處理會很痛苦。
-- 只能撤銷指定時限內、尚未被撤銷過的折抵。
-- ----------------------------------------------------------------
create or replace function undo_redeem(
  p_txn_id      uuid,
  p_staff_id    uuid,
  p_window_secs int default 300
)
returns table (new_balance int, txn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig    balance_transactions%rowtype;
  v_balance int;
  v_new_txn uuid;
begin
  select * into v_orig from balance_transactions where id = p_txn_id;

  if not found or v_orig.type <> 'spend' then
    raise exception 'TXN_NOT_FOUND';
  end if;

  if v_orig.created_at < now() - make_interval(secs => p_window_secs) then
    raise exception 'UNDO_WINDOW_EXPIRED'
      using hint = '超過可撤銷時限，請改用後台人工調整';
  end if;

  -- 同一筆只能撤銷一次
  if exists (
    select 1 from balance_transactions
     where type = 'adjust' and source_type = 'redeem' and source_id = p_txn_id
  ) then
    raise exception 'ALREADY_UNDONE';
  end if;

  update users
     set balance        = balance - v_orig.amount,   -- amount 是負數，減去等於加回
         lifetime_spent = greatest(0, lifetime_spent + v_orig.amount)
   where id = v_orig.user_id
   returning balance into v_balance;

  insert into balance_transactions
    (user_id, type, amount, balance_after, source_type, source_id, staff_id, note)
  values
    (v_orig.user_id, 'adjust', -v_orig.amount, v_balance, 'redeem', p_txn_id,
     p_staff_id, '撤銷折抵')
  returning id into v_new_txn;

  return query select v_balance, v_new_txn;
end;
$$;


-- ----------------------------------------------------------------
-- adjust_balance：後台人工調整
--
-- 客訴處理用。必填原因，一律留 ledger。
-- 後台絕不可直接 update users set balance，否則那筆錢查不出去向。
-- ----------------------------------------------------------------
create or replace function adjust_balance(
  p_user_id  uuid,
  p_amount   int,          -- 正為增加，負為扣除
  p_staff_id uuid,
  p_note     text
)
returns table (new_balance int, txn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expire_days int;
  v_balance     int;
  v_txn_id      uuid;
begin
  if p_amount = 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'NOTE_REQUIRED' using hint = '人工調整必須填寫原因';
  end if;

  select credit_expire_days into v_expire_days from settings where id = 1;

  update users
     set balance = balance + p_amount,
         balance_expires_at = case
           when balance + p_amount > 0
             then coalesce(balance_expires_at, now() + make_interval(days => v_expire_days))
           else null
         end
   where id = p_user_id
     and balance + p_amount >= 0     -- 不可扣成負數
   returning balance into v_balance;

  if not found then
    raise exception 'INSUFFICIENT_BALANCE' using hint = '扣除後餘額會變成負數';
  end if;

  insert into balance_transactions
    (user_id, type, amount, balance_after, source_type, staff_id, note)
  values
    (p_user_id, 'adjust', p_amount, v_balance, 'admin', p_staff_id, btrim(p_note))
  returning id into v_txn_id;

  return query select v_balance, v_txn_id;
end;
$$;


-- ----------------------------------------------------------------
-- expire_balances：每日到期歸零
--
-- 用逐列鎖定的迴圈而不是單一 UPDATE。原因是 UPDATE ... RETURNING
-- 回傳的是「新值」，拿不到歸零前的餘額，而 ledger 必須記錄實際
-- 消滅了多少錢。用 CTE 撈舊值則會有快照與併發修改的邊界情況。
--
-- 每天到期的人數是幾十列的量級，迴圈的效能完全不是問題，
-- 換來的是顯而易見的正確性。
-- ----------------------------------------------------------------
create or replace function expire_balances()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   record;
  v_count int := 0;
begin
  for v_row in
    select id, balance
      from users
     where balance > 0
       and balance_expires_at is not null
       and balance_expires_at < now()
     for update
  loop
    update users
       set balance = 0,
           balance_expires_at = null
     where id = v_row.id;

    insert into balance_transactions
      (user_id, type, amount, balance_after, source_type, note)
    values
      (v_row.id, 'expire', -v_row.balance, 0, 'cron',
       format('餘額到期歸零（%s 元）', v_row.balance));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- ----------------------------------------------------------------
-- expire_coupons：每日到期實物券
-- ----------------------------------------------------------------
create or replace function expire_coupons()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  update coupons
     set status = 'expired'
   where status = 'active'
     and expires_at < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


-- ----------------------------------------------------------------
-- expire_tokens：未領取的抽獎結果失效
--
-- 抽完卻沒登入領取的，超過 claim_window_minutes 就作廢。
-- 這些人不會產生成本。
-- ----------------------------------------------------------------
create or replace function expire_tokens()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window int;
  v_count  int := 0;
begin
  select claim_window_minutes into v_window from settings where id = 1;

  -- 抽了沒領
  update draw_tokens
     set status = 'expired'
   where status = 'drawn'
     and drawn_at < now() - make_interval(mins => v_window);

  get diagnostics v_count = row_count;

  -- 紙卡序號本身過期
  update draw_tokens
     set status = 'expired'
   where status in ('inactive', 'active')
     and expires_at is not null
     and expires_at < now();

  return v_count;
end;
$$;


-- ----------------------------------------------------------------
-- check_balance_integrity：餘額一致性檢查
--
-- 這個函式必須永遠回傳 0 列。有任何一列就代表有人繞過 ledger
-- 直接動了 users.balance，那筆錢查不出去向。最高優先級的告警。
-- ----------------------------------------------------------------
create or replace function check_balance_integrity()
returns table (user_id uuid, balance int, ledger_sum bigint)
language sql
security definer
set search_path = public
as $$
  select u.id, u.balance, coalesce(sum(t.amount), 0)
    from users u
    left join balance_transactions t on t.user_id = u.id
   group by u.id, u.balance
  having u.balance <> coalesce(sum(t.amount), 0);
$$;


-- ----------------------------------------------------------------
-- commit_draw：抽獎結果落地
--
-- 加權抽選在應用層用 crypto 亂數執行（見 src/lib/draw.ts），
-- 這裡負責把結果原子性地寫進去。
--
-- 回傳 ok=false 代表這個 token 已經被別人抽走或無效，
-- 此時什麼都沒有寫入，應用層直接回報「已被使用」。
-- ----------------------------------------------------------------
create or replace function commit_draw(
  p_code     text,
  p_prize_id uuid,
  p_snapshot jsonb,
  p_ip_hash  text
)
returns table (ok boolean, reason text, token_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_id uuid;
  v_stock_ok boolean;
begin
  -- 有庫存限制的獎項，先原子性扣庫存
  update prizes
     set stock_used = stock_used + 1
   where id = p_prize_id
     and is_active = true
     and (stock is null or stock_used < stock);

  v_stock_ok := found;

  if not v_stock_ok then
    return query select false, 'PRIZE_OUT_OF_STOCK'::text, null::uuid;
    return;
  end if;

  -- 只有 active 才能轉成 drawn。WHERE 保證併發下只有一個請求成功
  update draw_tokens
     set status         = 'drawn',
         prize_id       = p_prize_id,
         prize_snapshot = p_snapshot,
         drawn_at       = now(),
         ip_hash        = p_ip_hash
   where code = p_code
     and status = 'active'
     and (expires_at is null or expires_at > now())
   returning id into v_token_id;

  if not found then
    -- token 沒搶到，把剛才扣的庫存還回去
    update prizes set stock_used = stock_used - 1 where id = p_prize_id;
    return query select false, 'TOKEN_NOT_AVAILABLE'::text, null::uuid;
    return;
  end if;

  insert into audit_logs (actor_type, action, target_type, target_id, detail, ip_hash)
  values ('user', 'draw', 'draw_token', v_token_id,
          jsonb_build_object('code', p_code, 'prize', p_snapshot), p_ip_hash);

  return query select true, null::text, v_token_id;
end;
$$;


-- ----------------------------------------------------------------
-- claim_token：登入後領取
--
-- 依獎項類型分流：
--   credit → 進 users.balance + 寫 ledger，不產生券
--   其他   → 產生一張 coupons，快照獎項內容
-- ----------------------------------------------------------------
create or replace function claim_token(
  p_code        text,
  p_user_id     uuid,
  p_redeem_code text
)
returns table (
  ok           boolean,
  reason       text,
  prize_type   text,
  credit_added int,
  new_balance  int,
  coupon_id    uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token      draw_tokens%rowtype;
  v_window     int;
  v_valid_days int;
  v_snap       jsonb;
  v_type       text;
  v_amount     int;
  v_balance    int;
  v_coupon_id  uuid;
begin
  select claim_window_minutes, default_valid_days
    into v_window, v_valid_days
    from settings where id = 1;

  -- 原子性佔位。只有 drawn 且在時限內才能轉成 claimed
  update draw_tokens
     set status     = 'claimed',
         claimed_by = p_user_id,
         claimed_at = now()
   where code = p_code
     and status = 'drawn'
     and drawn_at > now() - make_interval(mins => v_window)
   returning * into v_token;

  if not found then
    return query select false, 'TOKEN_NOT_CLAIMABLE'::text,
                        null::text, null::int, null::int, null::uuid;
    return;
  end if;

  v_snap := v_token.prize_snapshot;
  v_type := v_snap ->> 'type';

  if v_type = 'credit' then
    v_amount := (v_snap ->> 'credit_amount')::int;

    select eb.new_balance into v_balance
      from earn_balance(p_user_id, v_amount, v_token.id) eb;

    return query select true, null::text, v_type, v_amount, v_balance, null::uuid;
  else
    insert into coupons (
      user_id, token_id, redeem_code, prize_id,
      prize_name, prize_type, face_value, cost_at_draw,
      discount_amt, min_spend, max_discount, terms, image_url,
      expires_at
    ) values (
      p_user_id, v_token.id, p_redeem_code, v_token.prize_id,
      v_snap ->> 'name',
      v_type,
      (v_snap ->> 'face_value')::int,
      (v_snap ->> 'cost')::int,
      nullif(v_snap ->> 'discount_amt', '')::int,
      coalesce(nullif(v_snap ->> 'min_spend', '')::int, 0),
      nullif(v_snap ->> 'max_discount', '')::int,
      v_snap ->> 'terms',
      v_snap ->> 'image_url',
      now() + make_interval(
        days => coalesce(nullif(v_snap ->> 'valid_days', '')::int, v_valid_days)
      )
    )
    returning id into v_coupon_id;

    update users
       set last_visit_at = now(),
           visit_count   = visit_count + 1
     where id = p_user_id;

    return query select true, null::text, v_type, null::int, null::int, v_coupon_id;
  end if;
end;
$$;


-- ----------------------------------------------------------------
-- redeem_coupon：店員核銷實物券
-- ----------------------------------------------------------------
create or replace function redeem_coupon(
  p_redeem_code text,
  p_staff_id    uuid
)
returns table (ok boolean, reason text, prize_name text, coupon_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon coupons%rowtype;
begin
  update coupons
     set status  = 'used',
         used_at = now(),
         used_by = p_staff_id
   where redeem_code = p_redeem_code
     and status = 'active'
     and expires_at > now()
   returning * into v_coupon;

  if not found then
    return query select false, 'COUPON_NOT_REDEEMABLE'::text, null::text, null::uuid;
    return;
  end if;

  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, detail)
  values ('staff', p_staff_id, 'redeem_coupon', 'coupon', v_coupon.id,
          jsonb_build_object('prize', v_coupon.prize_name));

  return query select true, null::text, v_coupon.prize_name, v_coupon.id;
end;
$$;
