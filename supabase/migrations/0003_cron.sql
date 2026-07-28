-- ================================================================
-- 每日排程
--
-- 若 Supabase 專案未啟用 pg_cron，可改用 Vercel Cron 呼叫
-- /api/cron/daily（帶 Authorization: Bearer CRON_SECRET），
-- 那條路由做的事跟這裡完全一樣。
-- ================================================================

create extension if not exists pg_cron;

-- 每日凌晨 4 點執行，避開營業時間
select cron.schedule(
  'lucky-draw-daily',
  '0 4 * * *',
  $$
    select expire_balances();
    select expire_coupons();
    select expire_tokens();
  $$
);
