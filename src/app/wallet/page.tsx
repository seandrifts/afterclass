import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, Screen } from '@/components/ui';
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
  const qr = await qrSvg(user.wallet_code, 220);

  const days = daysUntilExpiry(user.balance_expires_at);
  const progress = progressToward(user.balance, settings);
  const usable = redeemableNow(user.balance, settings);

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
      <header className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-soft">
            {settings.shop_name || '消費抽獎'}
          </p>
          <h1 className="text-xl font-bold">
            {user.display_name ?? '我的帳戶'}
          </h1>
        </div>
        <Link href="/wallet/history" className="text-sm text-brand-600 underline">
          明細
        </Link>
      </header>

      <Card className="text-center">
        <p className="tabular text-6xl font-black leading-none text-brand-600">
          {settings.points_display_enabled
            ? user.balance * settings.points_per_dollar
            : user.balance}
        </p>
        <p className="mt-2 text-lg font-medium text-ink-soft">
          {settings.points_display_enabled ? '點' : '元'}
          <span className="ml-2 text-base">可折抵 {user.balance} 元</span>
        </p>

        {/* QR 一打開就在正中央。客人在櫃檯前掏手機，多一次點擊就是多幾秒鐘的隊伍 */}
        <div
          className="mx-auto mt-6 w-fit rounded-2xl bg-white p-3 shadow-inner ring-1 ring-line"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <p className="mt-3 font-mono text-lg font-bold tracking-widest text-ink">
          {user.wallet_code}
        </p>
        <p className="mt-1 text-sm text-ink-soft">結帳時出示給店員</p>
      </Card>

      {user.balance > 0 ? (
        <Card className="mt-4">
          <div className="h-3 overflow-hidden rounded-full bg-brand-100">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${progress.ratio * 100}%` }}
            />
          </div>
          <p className="mt-3 text-center text-sm font-medium text-ink-soft">
            {progress.reached
              ? `這次結帳可折抵 ${usable} 元（單次上限）`
              : `再 ${formatForCustomer(progress.remaining, settings)} 達單次折抵上限 ${progress.target} 元`}
          </p>
        </Card>
      ) : null}

      {user.balance > 0 && days !== null ? (
        <div
          className={`mt-4 rounded-2xl px-4 py-3 text-center text-sm ${
            days <= settings.expire_warn_days
              ? 'bg-red-50 text-bad'
              : 'bg-brand-50 text-ink-soft'
          }`}
        >
          <p className="font-medium">
            {formatExpiryDate(user.balance_expires_at!)} 到期
            {days > 0 ? `（還有 ${days} 天）` : '（今天）'}
          </p>
          <p className="mt-1">來店消費或使用點數即可自動延長 {settings.credit_expire_days} 天</p>
        </div>
      ) : null}

      {coupons.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-bold text-ink-soft">我的券</h2>
          <div className="space-y-3">
            {coupons.map((c) => (
              <Link key={c.id} href={`/wallet/coupons/${c.id}`}>
                <Card className="flex items-center justify-between">
                  <div>
                    <p className="font-bold">{c.prize_name}</p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {formatExpiryDate(c.expires_at)} 到期
                    </p>
                  </div>
                  <span className="text-brand-600">出示 →</span>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-auto space-y-3 pt-10 text-center">
        <Link href="/rules" className="block text-sm text-ink-faint underline">
          活動辦法與中獎機率
        </Link>
        <form action="/auth/logout" method="post">
          <button type="submit" className="text-sm text-ink-faint underline">
            登出
          </button>
        </form>
      </div>
    </Screen>
  );
}
