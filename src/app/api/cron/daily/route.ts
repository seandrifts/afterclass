import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { sendExpiryWarnings } from '@/lib/notify';
import { getSettings } from '@/lib/settings';
import { db } from '@/lib/supabase';

/**
 * 每日排程。
 *
 * Vercel Cron 會自動帶上 CRON_SECRET 當 Bearer token。
 * 若改用 Supabase 的 pg_cron，到期歸零那三項會由資料庫自己跑，
 * 但推播只有這條路由做得到（pg_cron 打不到外部 API）。
 *
 * 重複執行是安全的：到期函式的 WHERE 只挑到期資料，跑第二次是 0 列；
 * 推播有 dedup_key 的唯一約束擋著。
 */
export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${env.cronSecret()}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // 先清到期資料，再發提醒。順序反過來會提醒到已經歸零的人
  const [balances, coupons, tokens] = await Promise.all([
    db().rpc('expire_balances'),
    db().rpc('expire_coupons'),
    db().rpc('expire_tokens'),
  ]);

  const settings = await getSettings();
  const push = await sendExpiryWarnings(settings);

  const integrity = await db().rpc('check_balance_integrity');
  const breaches = Array.isArray(integrity.data) ? integrity.data.length : 0;

  return NextResponse.json({
    expiredBalances: balances.data ?? 0,
    expiredCoupons: coupons.data ?? 0,
    expiredTokens: tokens.data ?? 0,
    push,
    // 這個數字必須永遠是 0。非 0 代表有人繞過流水帳動了餘額
    integrityBreaches: breaches,
  });
}
