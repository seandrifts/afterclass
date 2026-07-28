'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/auth-guard';
import { env } from '@/lib/env';
import { expiryWarningMessage, pushMessage } from '@/lib/line';
import { sendExpiryWarnings } from '@/lib/notify';
import { getSettings } from '@/lib/settings';
import { db } from '@/lib/supabase';

export async function togglePushAction(_prev: unknown, formData: FormData) {
  const owner = await requireOwner();

  const field = String(formData.get('field') ?? '');
  const next = formData.get('value') === 'true';

  if (!['push_enabled', 'push_expiry_enabled'].includes(field)) {
    return { error: '不支援的設定' };
  }

  const { error } = await db()
    .from('settings')
    .update({ [field]: next, updated_at: new Date().toISOString() })
    .eq('id', 1);

  if (error) return { error: '更新失敗' };

  await db().from('audit_logs').insert({
    actor_type: 'staff',
    actor_id: owner.sid,
    action: 'toggle_push',
    target_type: 'settings',
    detail: { field, value: next },
  });

  revalidatePath('/admin/push');
  return { saved: true };
}

/**
 * 試推給自己。
 *
 * 正式對客人推播之前一定要先看過真實的訊息長相。在後台預覽區看到的
 * 是純文字，實際在 LINE 裡的斷行、連結預覽、字體都不一樣。
 *
 * 這則試推不寫進 notifications，所以不會影響防重複判斷。
 */
export async function testPushAction(_prev: unknown, formData: FormData) {
  await requireOwner();

  const walletCode = String(formData.get('walletCode') ?? '')
    .trim()
    .toUpperCase();

  if (!walletCode) return { error: '請輸入要試推的會員碼' };

  const { data: user } = await db()
    .from('users')
    .select('id, display_name, line_user_id, balance, balance_expires_at')
    .eq('wallet_code', walletCode)
    .maybeSingle();

  if (!user) return { error: '查不到這組會員碼' };
  if (!user.line_user_id) return { error: '這個帳號不是用 LINE 註冊的，推不了' };

  const settings = await getSettings();

  const days = user.balance_expires_at
    ? Math.ceil(
        (new Date(user.balance_expires_at).getTime() - Date.now()) / 86_400_000,
      )
    : settings.expire_warn_days;

  const messages = expiryWarningMessage({
    shopName: settings.shop_name || '消費抽獎',
    points: user.balance * settings.points_per_dollar,
    dollars: user.balance,
    days,
    usePoints: settings.points_display_enabled,
    walletUrl: `${env.siteUrl}/wallet`,
    extendDays: settings.credit_expire_days,
  });

  const result = await pushMessage(user.line_user_id, messages);

  if (!result.ok) {
    return {
      error: result.unreachable
        ? '推不到這個人。對方沒有加官方帳號好友，或已經封鎖'
        : `推播失敗：${result.error}`,
    };
  }

  return { saved: true, message: `已試推給 ${user.display_name ?? '該會員'}` };
}

/**
 * 手動立即執行一次到期提醒。
 *
 * 平常由每日排程自動跑，這顆按鈕是給「想馬上看到效果」或
 * 「排程那天出問題要補推」時用的。有 dedup_key 擋著，
 * 重複按不會重複推給同一個人。
 */
export async function runExpiryPushAction() {
  await requireOwner();

  const settings = await getSettings();
  const summary = await sendExpiryWarnings(settings);

  revalidatePath('/admin/push');
  return summary;
}
