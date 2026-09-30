-- ================================================================
-- 核銷碼撞號、撤銷折抵的併發
-- ================================================================


-- ----------------------------------------------------------------
-- 1. 核銷碼只在「有效的券」之間不可重複
--
-- 原本 redeem_code 是全表 unique，6 位數字，用過的號碼永遠不釋放。
-- 以每天約 18 張券估，一年約 6600 張，生日悖論下第一年預期撞號
-- 約 20 次。撞到時 claim_token 整筆回滾，token 卡在 drawn、庫存
-- 已扣，店員端只能看到「入帳失敗」。
--
-- 核銷（redeem_coupon）只查 status = 'active' 的券，已用、過期、
-- 作廢的券不會再被這組碼找到，所以唯一性只需要涵蓋有效的券。
-- ----------------------------------------------------------------
alter table coupons drop constraint if exists coupons_redeem_code_key;

create unique index if not exists coupons_redeem_active_uidx
  on coupons (redeem_code)
  where status = 'active';


-- ----------------------------------------------------------------
-- 2. claim_token：撞號時換一組碼重試，並回傳實際使用的核銷碼
--
-- 應用層傳進來的碼（crypto 亂數）當作第一次嘗試。撞到有效券時在
-- 這裡換碼重試，不讓整筆入帳失敗。因為最後用的碼可能跟傳進來的
-- 不同，回傳欄位多一個 redeem_code，呼叫端要以它為準。
--
-- 回傳欄位變了，必須先 drop 再建。
-- ----------------------------------------------------------------
drop function if exists claim_token(text, uuid, text);

create function claim_token(
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
  coupon_id    uuid,
  redeem_code  text
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
  v_code       text := p_redeem_code;
  v_attempt    int  := 0;
  v_constraint text;
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
                        null::text, null::int, null::int, null::uuid, null::text;
    return;
  end if;

  v_snap := v_token.prize_snapshot;
  v_type := v_snap ->> 'type';

  if v_type = 'credit' then
    v_amount := (v_snap ->> 'credit_amount')::int;

    select eb.new_balance into v_balance
      from earn_balance(p_user_id, v_amount, v_token.id) eb;

    return query select true, null::text, v_type, v_amount, v_balance,
                        null::uuid, null::text;
    return;
  end if;

  loop
    v_attempt := v_attempt + 1;

    begin
      insert into coupons (
        user_id, token_id, redeem_code, prize_id,
        prize_name, prize_type, face_value, cost_at_draw,
        discount_amt, min_spend, max_discount, terms, image_url,
        expires_at
      ) values (
        p_user_id, v_token.id, v_code, v_token.prize_id,
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

      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

      -- 只有核銷碼撞號才重試，其他唯一性衝突照原樣拋出
      if v_constraint <> 'coupons_redeem_active_uidx' or v_attempt >= 8 then
        raise;
      end if;

      v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
    end;
  end loop;

  update users
     set last_visit_at = now(),
         visit_count   = visit_count + 1
   where id = p_user_id;

  return query select true, null::text, v_type, null::int, null::int,
                      v_coupon_id, v_code;
end;
$$;


-- ----------------------------------------------------------------
-- 3. undo_redeem：鎖住原始那筆，擋住連點兩下
--
-- 原本是先查「撤銷過沒」再寫入，兩個請求同時進來會一起通過檢查，
-- 客人被加回兩倍金額。讀原始交易時加 for update，第二個請求會等
-- 第一個 commit，之後的 exists 檢查就看得到剛寫入的撤銷紀錄。
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
  select * into v_orig
    from balance_transactions
   where id = p_txn_id
     for update;

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
