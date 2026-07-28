import 'server-only';

import { env } from './env';
import {
  clearUnreachable,
  expiryWarningMessage,
  markUnreachable,
  pushMessage,
} from './line';
import { db } from './supabase';
import type { Settings, User } from './types';

export interface ExpiryTarget {
  user: Pick<
    User,
    'id' | 'display_name' | 'line_user_id' | 'balance' | 'balance_expires_at'
  >;
  days: number;
  dedupKey: string;
}

/**
 * 找出即將到期而且推得到的人。
 *
 * 排除條件：
 *   沒有餘額           沒東西好提醒
 *   沒有 LINE 帳號     推不了（email 註冊的客人）
 *   已封鎖             帳號被停用
 *   推播曾被拒         封鎖了官方帳號或沒加好友，重試只是浪費額度
 *   這個到期日推過了   防重複的核心
 */
export async function findExpiryTargets(
  settings: Settings,
): Promise<ExpiryTarget[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + settings.expire_warn_days);

  const { data } = await db()
    .from('users')
    .select('id, display_name, line_user_id, balance, balance_expires_at')
    .gt('balance', 0)
    .not('line_user_id', 'is', null)
    .eq('is_blocked', false)
    .is('line_unreachable_at', null)
    .not('balance_expires_at', 'is', null)
    .lte('balance_expires_at', cutoff.toISOString())
    .order('balance_expires_at');

  const rows = (data ?? []) as ExpiryTarget['user'][];
  if (rows.length === 0) return [];

  // dedup_key 帶上該次的到期日。客人來店消費後到期日往後滾，
  // key 就變了，下個週期到期前會再收到一次提醒
  const candidates = rows.map((user) => ({
    user,
    days: daysUntil(user.balance_expires_at!),
    dedupKey: `expiry:${user.balance_expires_at!.slice(0, 10)}`,
  }));

  const { data: sent } = await db()
    .from('notifications')
    .select('user_id, dedup_key')
    .eq('type', 'expiry_warning')
    .in(
      'user_id',
      candidates.map((c) => c.user.id),
    );

  const already = new Set(
    (sent ?? []).map((s) => `${s.user_id}|${s.dedup_key}`),
  );

  return candidates.filter(
    (c) => !already.has(`${c.user.id}|${c.dedupKey}`),
  );
}

export interface PushSummary {
  attempted: number;
  sent: number;
  unreachable: number;
  failed: number;
  skippedReason?: string;
}

/**
 * 送出到期提醒。
 *
 * 每則之間留 100ms。LINE 沒有明訂 push 的頻率上限，但小吃店的名單
 * 一次也就幾十筆，慢個幾秒換取不被判定為濫發是划算的。
 */
export async function sendExpiryWarnings(
  settings: Settings,
  options: { dryRun?: boolean; limit?: number } = {},
): Promise<PushSummary> {
  const summary: PushSummary = {
    attempted: 0,
    sent: 0,
    unreachable: 0,
    failed: 0,
  };

  if (!settings.push_enabled) {
    return { ...summary, skippedReason: '推播總開關未開啟' };
  }
  if (!settings.push_expiry_enabled) {
    return { ...summary, skippedReason: '到期提醒未啟用' };
  }
  if (!process.env.LINE_MESSAGING_TOKEN) {
    return { ...summary, skippedReason: '缺少 LINE_MESSAGING_TOKEN' };
  }

  let targets = await findExpiryTargets(settings);
  if (options.limit) targets = targets.slice(0, options.limit);

  summary.attempted = targets.length;
  if (options.dryRun) return summary;

  for (const target of targets) {
    const messages = expiryWarningMessage({
      shopName: settings.shop_name || '消費抽獎',
      points: target.user.balance * settings.points_per_dollar,
      dollars: target.user.balance,
      days: target.days,
      usePoints: settings.points_display_enabled,
      walletUrl: `${env.siteUrl}/wallet`,
      extendDays: settings.credit_expire_days,
    });

    const result = await pushMessage(target.user.line_user_id!, messages);

    // 先寫紀錄再處理結果。就算後面出錯，至少不會重複推同一個人
    await db()
      .from('notifications')
      .insert({
        user_id: target.user.id,
        type: 'expiry_warning',
        dedup_key: target.dedupKey,
        status: result.ok
          ? 'sent'
          : result.unreachable
            ? 'blocked'
            : 'failed',
        error: result.ok ? null : result.error,
        detail: { balance: target.user.balance, days: target.days },
      });

    if (result.ok) {
      summary.sent += 1;
      await clearUnreachable(target.user.id);
    } else if (result.unreachable) {
      summary.unreachable += 1;
      await markUnreachable(target.user.id);
    } else {
      summary.failed += 1;
    }

    await sleep(100);
  }

  return summary;
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
