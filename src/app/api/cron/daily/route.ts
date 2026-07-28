import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { db } from '@/lib/supabase';

/**
 * 每日排程。
 *
 * 跟 supabase/migrations/0003_cron.sql 的 pg_cron 做的事完全一樣。
 * 兩者擇一即可，這條路由是給沒有啟用 pg_cron 的專案用的
 * （例如接 Vercel Cron）。
 *
 * 重複執行是安全的：每個函式的 WHERE 條件都只挑到期的資料，
 * 跑第二次會是 0 列。
 */
export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${env.cronSecret()}`) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const [balances, coupons, tokens, integrity] = await Promise.all([
    db().rpc('expire_balances'),
    db().rpc('expire_coupons'),
    db().rpc('expire_tokens'),
    db().rpc('check_balance_integrity'),
  ]);

  const breaches = Array.isArray(integrity.data) ? integrity.data.length : 0;

  return NextResponse.json({
    expiredBalances: balances.data ?? 0,
    expiredCoupons: coupons.data ?? 0,
    expiredTokens: tokens.data ?? 0,
    // 這個數字必須永遠是 0。非 0 代表有人繞過流水帳動了餘額
    integrityBreaches: breaches,
  });
}
