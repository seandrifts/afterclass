import 'server-only';

import { env } from './env';
import { expiryWarningMessage, markUnreachable, pushMessage } from './line';
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
  /** 時間預算用完、這次沒推到的人數。下一次排程會再撿起來 */
  remaining?: number;
  skippedReason?: string;
}

/*
  一次同時推幾則。

  原本是完全循序，每則之間還睡 100ms。名單只有幾十筆時沒問題，但
  Vercel 的函式有執行時間上限，兩百人就會在中途被砍掉，而且是在
  排程路由把心跳紀錄寫進去之前。

  LINE Messaging API 的速率上限是每秒 2000 次請求，這裡的 5 是為了
  控制對資料庫的併發寫入，離 LINE 的門檻還很遠。
*/
const PUSH_CONCURRENCY = 5;

/**
 * 送出到期提醒。
 *
 * budgetMs 是給這件事的時間上限。用完就停下來、把剩幾人回報出去，
 * 讓呼叫端還有時間把紀錄寫完。沒推到的人在下一次排程會再被選中
 * （dedup_key 只擋已經成功寫過紀錄的人）。
 */
export async function sendExpiryWarnings(
  settings: Settings,
  options: { dryRun?: boolean; limit?: number; budgetMs?: number } = {},
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

  const deadline =
    options.budgetMs !== undefined ? Date.now() + options.budgetMs : Infinity;

  let index = 0;

  /** 一條工作線：從共用的清單取下一個人來推，直到取完或時間到 */
  async function worker() {
    while (true) {
      if (Date.now() >= deadline) return;

      const target = targets[index];
      index += 1;
      if (!target) return;

      await sendOne(target, settings, summary);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PUSH_CONCURRENCY, targets.length) }, worker),
  );

  const done = summary.sent + summary.unreachable + summary.failed;
  if (done < targets.length) summary.remaining = targets.length - done;

  return summary;
}

async function sendOne(
  target: ExpiryTarget,
  settings: Settings,
  summary: PushSummary,
) {
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
      status: result.ok ? 'sent' : result.unreachable ? 'blocked' : 'failed',
      error: result.ok ? null : result.error,
      detail: { balance: target.user.balance, days: target.days },
    });

  if (result.ok) {
    /*
      這裡原本還會呼叫 clearUnreachable()。

      但 findExpiryTargets 的條件已經包含 line_unreachable_at is null，
      所以進到這裡的人那個欄位一定是 null，那次 update 永遠寫不到任何
      東西。等於每推一個人就多一趟毫無作用的資料庫往返。

      標記真正該被清掉的時機是客人下次用 LINE 登入，那件事現在由
      upsertLineUser() 負責。
    */
    summary.sent += 1;
  } else if (result.unreachable) {
    summary.unreachable += 1;
    await markUnreachable(target.user.id);
  } else {
    summary.failed += 1;
  }
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
