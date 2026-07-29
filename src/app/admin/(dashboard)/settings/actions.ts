'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireOwner } from '@/lib/auth-guard';
import { db } from '@/lib/supabase';

const schema = z.object({
  shop_name: z.string().max(40),
  primary_color: z.string().max(20),

  campaign_active: z.coerce.boolean(),
  paused_reason: z.string().max(100).nullable(),

  credit_expire_days: z.coerce.number().int().min(1).max(3650),
  max_redeem_per_visit: z.coerce.number().int().min(1),
  min_balance_to_redeem: z.coerce.number().int().min(0),
  expire_warn_days: z.coerce.number().int().min(0),

  points_display_enabled: z.coerce.boolean(),
  points_per_dollar: z.coerce.number().int().min(1),

  default_valid_days: z.coerce.number().int().min(1),
  card_token_valid_days: z.coerce.number().int().min(1),
  dynamic_token_ttl_sec: z.coerce.number().int().min(10),
  claim_window_minutes: z.coerce.number().int().min(1),

  avg_ticket: z.coerce.number().int().min(1),
  gross_margin_pct: z.coerce.number().int().min(0).max(100),
  daily_customers: z.coerce.number().int().min(1),

  monthly_cost_cap: z.coerce.number().int().min(0).nullable(),
  cost_cap_action: z.enum(['notify', 'pause']),

  pity_enabled: z.coerce.boolean(),
  pity_threshold: z.coerce.number().int().min(1),

  rules_content: z.string().max(20000),
});

export async function saveSettingsAction(_prev: unknown, formData: FormData) {
  const owner = await requireOwner();

  const raw = Object.fromEntries(formData.entries());

  const parsed = schema.safeParse({
    ...raw,
    campaign_active: raw.campaign_active === 'on',
    points_display_enabled: raw.points_display_enabled === 'on',
    pity_enabled: raw.pity_enabled === 'on',
    paused_reason: String(raw.paused_reason ?? '').trim() || null,
    monthly_cost_cap:
      String(raw.monthly_cost_cap ?? '').trim() === ''
        ? null
        : raw.monthly_cost_cap,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '欄位有誤' };
  }

  const { data: before } = await db()
    .from('settings')
    .select('credit_expire_days')
    .eq('id', 1)
    .single();

  const { error } = await db()
    .from('settings')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
      updated_by: owner.sid,
    })
    .eq('id', 1);

  if (error) return { error: '儲存失敗' };

  await db().from('audit_logs').insert({
    actor_type: 'staff',
    actor_id: owner.sid,
    action: 'update_settings',
    target_type: 'settings',
    detail: parsed.data,
  });

  revalidatePath('/admin/settings');
  revalidatePath('/admin');

  /**
   * 縮短到期天數不追溯既有餘額。
   *
   * users.balance_expires_at 在每次異動時就已經算好存下來了，
   * 改設定不會回頭去改它。客人本來看到「11/03 到期」，隔天變成
   * 「10/04 到期」是會被投訴到消保官的。新規則只影響之後的異動。
   */
  const shortened =
    before && parsed.data.credit_expire_days < before.credit_expire_days;

  const { count } = await db()
    .from('users')
    .select('id', { count: 'exact', head: true })
    .gt('balance', 0);

  return {
    saved: true,
    notice: shortened
      ? `到期天數已從 ${before.credit_expire_days} 改為 ${parsed.data.credit_expire_days} 天。現有 ${count ?? 0} 位客人的到期日不受影響，下次異動時才會套用新規則。`
      : null,
  };
}
