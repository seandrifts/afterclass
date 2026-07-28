export type PrizeType = 'credit' | 'item' | 'cash' | 'free_meal';

export type TokenStatus =
  | 'inactive'
  | 'active'
  | 'drawn'
  | 'claimed'
  | 'expired'
  | 'voided';

export type CouponStatus = 'active' | 'used' | 'expired' | 'voided';

export type TxnType = 'earn' | 'spend' | 'expire' | 'adjust';

export interface Settings {
  id: number;

  shop_name: string;
  logo_url: string | null;
  primary_color: string;

  campaign_active: boolean;
  campaign_start_at: string | null;
  campaign_end_at: string | null;
  paused_reason: string | null;

  credit_expire_days: number;
  max_redeem_per_visit: number;
  min_balance_to_redeem: number;
  expire_warn_days: number;

  points_display_enabled: boolean;
  points_per_dollar: number;

  default_valid_days: number;
  max_coupons_per_visit: number;
  card_token_valid_days: number;
  dynamic_token_ttl_sec: number;
  claim_window_minutes: number;
  allow_stack_promo: boolean;

  avg_ticket: number;
  gross_margin_pct: number;
  daily_customers: number;

  monthly_cost_cap: number | null;
  cost_cap_action: 'notify' | 'pause';
  cost_cap_notified_at: string | null;

  pity_enabled: boolean;
  pity_threshold: number;

  rules_content: string;

  updated_at: string;
  updated_by: string | null;
}

export interface Prize {
  id: string;
  name: string;
  type: PrizeType;
  credit_amount: number | null;
  face_value: number;
  cost: number;
  discount_amt: number | null;
  min_spend: number;
  max_discount: number | null;
  weight: number;
  stock: number | null;
  stock_used: number;
  valid_days: number | null;
  terms: string | null;
  image_url: string | null;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 中獎當下寫進 draw_tokens.prize_snapshot 的內容。
 *
 * 存快照而不是只存 prize_id 的理由見 docs/PLAN.md §6.0 原則二：
 * 老闆在後台改獎項名稱時，已經抽出但還沒領取的結果不可以跟著變。
 */
export interface PrizeSnapshot {
  prize_id: string;
  name: string;
  type: PrizeType;
  credit_amount: number | null;
  face_value: number;
  cost: number;
  discount_amt: number | null;
  min_spend: number;
  max_discount: number | null;
  valid_days: number | null;
  terms: string | null;
  image_url: string | null;
  color: string | null;
}

export interface User {
  id: string;
  line_user_id: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  balance: number;
  balance_expires_at: string | null;
  lifetime_earned: number;
  lifetime_spent: number;
  wallet_code: string;
  created_at: string;
  last_visit_at: string | null;
  visit_count: number;
  is_blocked: boolean;
}

export interface DrawToken {
  id: string;
  code: string;
  kind: 'card' | 'dynamic';
  batch_id: string | null;
  status: TokenStatus;
  issued_by: string | null;
  issued_at: string | null;
  expires_at: string | null;
  drawn_at: string | null;
  prize_id: string | null;
  prize_snapshot: PrizeSnapshot | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface BalanceTransaction {
  id: string;
  user_id: string;
  type: TxnType;
  amount: number;
  balance_after: number;
  source_type: 'draw' | 'redeem' | 'cron' | 'admin' | null;
  source_id: string | null;
  staff_id: string | null;
  note: string | null;
  created_at: string;
}

export interface Coupon {
  id: string;
  user_id: string;
  token_id: string;
  redeem_code: string;
  prize_id: string;
  prize_name: string;
  prize_type: PrizeType;
  face_value: number;
  cost_at_draw: number;
  discount_amt: number | null;
  min_spend: number;
  max_discount: number | null;
  terms: string | null;
  image_url: string | null;
  status: CouponStatus;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
}

export interface Staff {
  id: string;
  name: string;
  role: 'staff' | 'owner';
  is_active: boolean;
}
