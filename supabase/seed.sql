-- 初始資料
--
-- 這裡的數字全部只是「初始值」，上線後一律在後台調整，不要回來改這個檔案。
--
-- 基準：客單 120 元、每日 80 客、免單成本率 38%
-- 主力機制為儲值金（對外稱「回饋點數」，見 docs/PLAN.md §9.2）

-- ---------------------------------------------------------------
-- 全域設定
-- ---------------------------------------------------------------
update settings set
  shop_name              = '（待填店名）',
  primary_color          = '#E4572E',

  -- 開發完成、店員訓練完後才手動開啟
  campaign_active        = false,

  -- 儲值金規則
  credit_expire_days     = 90,   -- 最後異動後 90 天歸零（滾動式，任何進出都順延）
  max_redeem_per_visit   = 30,   -- 單次消費最多折抵 30 元。成本控制的第二道防線
  min_balance_to_redeem  = 0,    -- 無門檻，隨時可用
  expire_warn_days       = 7,    -- 到期前 7 天推播提醒（回訪率最強的單一功能）

  -- 點數包裝：1 元顯示為 10 點。DB 一律存「元」，這只是顯示層
  points_display_enabled = true,
  points_per_dollar      = 10,

  -- 活動規則
  default_valid_days     = 21,   -- 實物券有效天數（目前無實物券獎項）
  max_coupons_per_visit  = 1,
  card_token_valid_days  = 90,
  dynamic_token_ttl_sec  = 60,
  claim_window_minutes   = 30,
  allow_stack_promo      = false,

  -- 成本試算基準
  avg_ticket             = 120,
  gross_margin_pct       = 55,
  daily_customers        = 80,

  -- 成本煞車。預估月成本 6,700，設 9,000 留緩衝
  monthly_cost_cap       = 9000,
  cost_cap_action        = 'notify',

  -- 保底：連續 20 次抽到最低級距後，第 21 次排除 1 元
  pity_enabled           = true,
  pity_threshold         = 20
where id = 1;


-- ---------------------------------------------------------------
-- 獎項
--
-- weight 總和刻意湊成 1000，機率 = weight / 10 %，心算方便。
-- type='credit' 的獎項不產生券，直接進 users.balance。
-- cost 為實際成本（只有老闆看得到）：
--   儲值金的成本 = 面額全額（折抵時直接減少收入）
--   免單的成本   = 食材成本，非面額
-- ---------------------------------------------------------------
insert into prizes
  (name, type, credit_amount, face_value, cost, discount_amt, min_spend,
   max_discount, weight, stock, valid_days, terms, color, sort_order, is_active)
values
  -- 0.30% 大獎。做成「下次消費折抵」而非當場免單，強制產生第二次來店
  ('免單（下次消費全免）', 'free_meal', null, 150, 57, null, 0,
   150, 3, null, 21, '折抵上限 150 元，超過部分需自付。限內用。',
   '#D62828', 1, true),

  -- 0.50%
  ('回饋金 50 元', 'credit', 50, 50, 50, null, 0,
   null, 5, null, null, null, '#F77F00', 2, true),

  -- 1.50%
  ('回饋金 20 元', 'credit', 20, 20, 20, null, 0,
   null, 15, null, null, null, '#FCBF49', 3, true),

  -- 5.70%
  ('回饋金 10 元', 'credit', 10, 10, 10, null, 0,
   null, 57, null, null, null, '#90BE6D', 4, true),

  -- 12.00%
  ('回饋金 5 元', 'credit', 5, 5, 5, null, 0,
   null, 120, null, null, null, '#43AA8B', 5, true),

  -- 25.00%
  ('回饋金 3 元', 'credit', 3, 3, 3, null, 0,
   null, 250, null, null, null, '#4D908E', 6, true),

  -- 30.00% 機率最高的級距
  ('回饋金 2 元', 'credit', 2, 2, 2, null, 0,
   null, 300, null, null, null, '#577590', 7, true),

  -- 25.00% 最低級距，保底機制會在連續 20 次後排除這項
  ('回饋金 1 元', 'credit', 1, 1, 1, null, 0,
   null, 250, null, null, null, '#457B9D', 8, true);


-- ---------------------------------------------------------------
-- 驗算
--
--   權重合計           1000
--   平均抽到金額       3.32 元
--   名目期望成本       3.49 元 / 客（含免單成本 0.17）
--   核銷率修正後       2.81 元 / 客（儲值金 80%、免單 90%）
--   佔客單 120         2.3%
--   預估月成本         約 6,700 元（每日 80 客 × 30 天）
--
-- 核銷率為預估值，上線兩週後改用後台報表算出的真實值。
-- ---------------------------------------------------------------


-- ---------------------------------------------------------------
-- 店員
-- PIN 請在後台首次登入時重設，不要沿用這裡的佔位值
-- ---------------------------------------------------------------
insert into staff (name, pin_hash, role, is_active)
values ('老闆', '$2b$10$REPLACE_ME_ON_FIRST_LOGIN', 'owner', true);
