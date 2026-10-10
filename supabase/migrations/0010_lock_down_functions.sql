-- ================================================================
-- 收回資料庫函式的對外執行權限
-- ================================================================
--
-- 資料表都開了 RLS 而且沒有任何 policy，拿公開金鑰（anon /
-- publishable key）直接讀寫是擋住的。但函式是另一回事：
--
--   1. Postgres 預設把新函式的執行權給 PUBLIC（所有角色）
--   2. Supabase 另外把 public schema 的函式授權給 anon、authenticated
--   3. 我們的函式都是 security definer，以擁有者的權限執行，
--      不受 RLS 限制
--
-- 三件事加起來，任何拿到公開金鑰的人都能直接打
-- /rest/v1/rpc/adjust_balance 改餘額，完全繞過網站的登入與權限檢查。
-- 公開金鑰目前沒有用在任何地方，所以還沒有人打得到，但那把金鑰在
-- Supabase 的設計裡本來就不算機密，不能把安全押在它不外流上。
--
-- 網站一律用 service_role 連線，收回 anon 與 authenticated 的權限
-- 對它沒有影響。pg_cron 的排程以擁有者身分執行，同樣不受影響。
-- ================================================================


-- ----------------------------------------------------------------
-- 1. 現有的函式
-- ----------------------------------------------------------------
revoke execute on all functions in schema public
  from public, anon, authenticated;

grant execute on all functions in schema public to service_role;


-- ----------------------------------------------------------------
-- 2. 之後新建的函式
--
-- 不改預設值的話，下一支 migration 建的函式又會自動對外開放。
--
-- 第一句不能加 in schema public：PUBLIC 的執行權是全域預設，
-- 針對單一 schema 的設定只能往上加、收不回來。
-- ----------------------------------------------------------------
alter default privileges
  revoke execute on functions from public;

alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

alter default privileges in schema public
  grant execute on functions to service_role;


-- ----------------------------------------------------------------
-- 3. 自我檢查
--
-- 列出 public schema 裡 anon 或 authenticated 還能執行的函式。
-- 正常情況下回傳 0 列。scripts/check-connection.mjs 會呼叫它，
-- 之後如果有函式又被開放出去（例如從 Supabase 後台手動建立），
-- 跑檢查就看得到。
-- ----------------------------------------------------------------
create or replace function exposed_functions()
returns setof text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
    )
  order by 1;
$$;

revoke execute on function exposed_functions()
  from public, anon, authenticated;

grant execute on function exposed_functions() to service_role;
