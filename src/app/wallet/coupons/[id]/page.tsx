import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { IconArrowLeft } from '@/components/icons';
import { ScanCard } from '@/components/scan-card';
import { Card, Screen } from '@/components/ui';
import { formatExpiryDate } from '@/lib/points';
import { qrSvg } from '@/lib/qr';
import { getUserSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import type { Coupon } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CouponPage(
  props: PageProps<'/wallet/coupons/[id]'>,
) {
  const session = await getUserSession();
  if (!session) redirect('/login');

  const { id } = await props.params;

  const { data } = await db()
    .from('coupons')
    .select('*')
    .eq('id', id)
    .eq('user_id', session.uid) // 只能看自己的券
    .maybeSingle();

  if (!data) notFound();

  const coupon = data as Coupon;
  const qr = await qrSvg(coupon.redeem_code, 200);
  const used = coupon.status !== 'active';

  return (
    <Screen>
      <header className="mb-5">
        <Link
          href="/wallet"
          className="inline-flex cursor-pointer items-center gap-1 rounded-xl px-2 py-1.5 text-brand-600 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
        >
          <IconArrowLeft className="size-5" />
          返回
        </Link>
      </header>

      <Card className="text-center">
        <p className="text-3xl font-black text-brand-600">
          {coupon.prize_name}
        </p>

        {used ? (
          <p className="mt-6 rounded-2xl bg-stone-100 px-4 py-8 text-lg font-bold text-ink-faint">
            {coupon.status === 'used' ? '已使用' : '已失效'}
          </p>
        ) : (
          <>
            <ScanCard svg={qr} code={coupon.redeem_code} />
          </>
        )}
      </Card>

      <Card className="mt-4">
        <h2 className="text-sm font-bold">使用條件</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>‧ {formatExpiryDate(coupon.expires_at)} 到期，逾期自動失效</li>
          {coupon.min_spend > 0 ? (
            <li>‧ 單筆消費滿 {coupon.min_spend} 元可用</li>
          ) : null}
          {coupon.max_discount !== null ? (
            <li>‧ 折抵上限 {coupon.max_discount} 元，超過部分需自付</li>
          ) : null}
          {coupon.terms ? <li>‧ {coupon.terms}</li> : null}
          <li>‧ 不得轉讓、兌換現金、不找零</li>
          <li>‧ 不可與其他優惠併用</li>
        </ul>
      </Card>
    </Screen>
  );
}
