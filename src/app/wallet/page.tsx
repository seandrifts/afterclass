import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  IconAlert,
  IconChevronRight,
  IconClock,
  IconReceipt,
  IconRules,
} from '@/components/icons';
import { AutoRefresh } from '@/components/auto-refresh';
import { ScanCard } from '@/components/scan-card';
import { Card, Screen, TextLink } from '@/components/ui';
import {
  daysUntilExpiry,
  formatExpiryDate,
  formatForCustomer,
  progressToward,
  redeemableNow,
} from '@/lib/points';
import { qrSvg } from '@/lib/qr';
import { getSettings } from '@/lib/settings';
import { getUserSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { getUserById } from '@/lib/users';
import type { Coupon } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function WalletPage() {
  const session = await getUserSession();
  if (!session) redirect('/login?next=%2Fwallet');

  const user = await getUserById(session.uid);
  if (!user) redirect('/login');

  const settings = await getSettings();

  // 店員掃的是 wallet_code，跟內部 uuid 分開避免外洩
  const qr = await qrSvg(user.wallet_code, 240);

  const days = daysUntilExpiry(user.balance_expires_at);
  const progress = progressToward(user.balance, settings);
  const usable = redeemableNow(user.balance, settings);
  const expiringSoon = days !== null && days <= settings.expire_warn_days;

  const { data: couponRows } = await db()
    .from('coupons')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at');

  const coupons = (couponRows ?? []) as Coupon[];

  return (
    <Screen>
      {/* 店員折抵後，客人開著的這一頁要自己更新，不能等手動重整 */}
      <AutoRefresh />
      <header className="mb-5 flex items-center justify-between gap-3">
        {settings.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={settings.logo_url}
            alt=""
            className="size-11 shrink-0 rounded-full object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink-soft">
            {settings.shop_name || '消費抽獎'}
          </p>
          <h1 className="truncate text-xl font-bold">
            {user.display_name ?? '我的帳戶'}
          </h1>
        </div>
        <Link
          href="/wallet/history"
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-xl px-3 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
        >
          <IconReceipt className="size-4" />
          明細
        </Link>
      </header>

      <Card className="text-center">
        <p className="tabular text-6xl leading-none font-black text-brand-600">
          {settings.points_display_enabled
            ? user.balance * settings.points_per_dollar
            : user.balance}
        </p>
        <p className="mt-2 text-lg font-medium text-ink-soft">
          {settings.points_display_enabled ? '點' : '元'}
          {/* 直接顯示元的時候，再寫一次「可折抵 N 元」是重複的 */}
          {settings.points_display_enabled ? (
            <span className="ml-2 text-base">可折抵 {user.balance} 元</span>
          ) : null}
        </p>

        <ScanCard svg={qr} code={user.wallet_code} />
      </Card>

      {user.balance > 0 ? (
        <Card className="mt-4">
          <div
            className="h-3 overflow-hidden rounded-full bg-brand-100"
            role="progressbar"
            aria-valuenow={Math.round(progress.ratio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="距離單次折抵上限的進度"
          >
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-700"
              style={{ width: `${progress.ratio * 100}%` }}
            />
          </div>
          <p className="mt-3 text-center text-sm font-medium text-pretty text-ink-soft">
            {progress.reached
              ? `這次結帳可折抵 ${usable} 元（單次上限）`
              : `再 ${formatForCustomer(progress.remaining, settings)} 達單次折抵上限 ${progress.target} 元`}
          </p>
        </Card>
      ) : null}

      {user.balance > 0 && days !== null ? (
        <div
          className={`mt-4 flex gap-3 rounded-2xl px-4 py-3 text-sm ${
            expiringSoon ? 'bg-red-50 text-bad' : 'bg-brand-50 text-ink-soft'
          }`}
        >
          {expiringSoon ? (
            <IconAlert className="mt-0.5 size-5 shrink-0" />
          ) : (
            <IconClock className="mt-0.5 size-5 shrink-0" />
          )}
          <div>
            <p className="font-medium">
              {formatExpiryDate(user.balance_expires_at!)} 到期
              {days > 0 ? `（還有 ${days} 天）` : '（今天）'}
            </p>
            <p className="mt-1 text-pretty">
              來店消費或使用點數即可自動延長 {settings.credit_expire_days} 天
            </p>
          </div>
        </div>
      ) : null}

      {user.balance === 0 ? (
        <Card className="mt-4 text-center">
          <p className="text-ink-soft">還沒有點數</p>
          <p className="mt-1 text-sm text-pretty text-ink-faint">
            來店消費就能拿到抽獎序號，掃描後點數會存進這裡
          </p>
        </Card>
      ) : null}

      {coupons.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-bold text-ink-soft">我的券</h2>
          <ul className="space-y-3">
            {coupons.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/wallet/coupons/${c.id}`}
                  className="flex cursor-pointer items-center justify-between rounded-card border border-line bg-raised p-5 shadow-sm transition-colors duration-200 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                >
                  <span>
                    <span className="block font-bold">{c.prize_name}</span>
                    <span className="mt-1 block text-sm text-ink-soft">
                      {formatExpiryDate(c.expires_at)} 到期
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-brand-600">
                    出示
                    <IconChevronRight className="size-5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-auto space-y-3 pt-10 text-center">
        <TextLink href="/rules" className="inline-flex items-center gap-1.5 text-sm text-ink-faint">
          <IconRules className="size-4" />
          活動辦法與中獎機率
        </TextLink>
        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="cursor-pointer rounded px-3 py-1 text-sm text-ink-faint underline underline-offset-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
          >
            登出
          </button>
        </form>
      </div>
    </Screen>
  );
}
