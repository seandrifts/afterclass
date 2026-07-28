import { PushBoard } from './push-board';
import { env } from '@/lib/env';
import { expiryWarningMessage, fetchQuota } from '@/lib/line';
import { findExpiryTargets } from '@/lib/notify';
import { getSettings } from '@/lib/settings';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function PushPage() {
  const settings = await getSettings();
  const hasToken = Boolean(process.env.LINE_MESSAGING_TOKEN);

  const [quota, targets, recent, reachable] = await Promise.all([
    hasToken ? fetchQuota() : Promise.resolve(null),
    findExpiryTargets(settings),
    db()
      .from('notifications')
      .select('id, type, status, error, created_at, detail, users(display_name)')
      .order('created_at', { ascending: false })
      .limit(30),
    db()
      .from('users')
      .select('id', { count: 'exact', head: true })
      .not('line_user_id', 'is', null)
      .is('line_unreachable_at', null),
  ]);

  const { count: unreachable } = await db()
    .from('users')
    .select('id', { count: 'exact', head: true })
    .not('line_unreachable_at', 'is', null);

  // 用第一位待推送對象的真實數字產生預覽，看到的就是客人會收到的內容
  const sample = targets[0];
  const preview = expiryWarningMessage({
    shopName: settings.shop_name || '消費抽獎',
    points: (sample?.user.balance ?? 47) * settings.points_per_dollar,
    dollars: sample?.user.balance ?? 47,
    days: sample?.days ?? settings.expire_warn_days,
    usePoints: settings.points_display_enabled,
    walletUrl: `${env.siteUrl}/wallet`,
    extendDays: settings.credit_expire_days,
  })[0].text;

  return (
    <PushBoard
      settings={settings}
      hasToken={hasToken}
      quota={quota}
      pendingCount={targets.length}
      pendingSample={targets.slice(0, 10).map((t) => ({
        name: t.user.display_name ?? '會員',
        balance: t.user.balance,
        days: t.days,
      }))}
      reachableCount={reachable.count ?? 0}
      unreachableCount={unreachable ?? 0}
      preview={preview}
      recent={
        (recent.data ?? []) as unknown as {
          id: string;
          type: string;
          status: string;
          error: string | null;
          created_at: string;
          detail: { balance: number; days: number } | null;
          users: { display_name: string | null } | null;
        }[]
      }
    />
  );
}
