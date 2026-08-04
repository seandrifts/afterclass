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

  /*
    每次執行都留一筆心跳。

    原本只有「真的有東西到期」才寫紀錄，平常跑完不留痕跡，所以無法
    分辨「排程正常但沒事可做」與「排程根本沒跑」。後者會讓點數永遠
    不到期、到期提醒永遠不發，而且要等好幾個月才會被發現。

    這筆紀錄同時也是 Supabase 免費方案的保命符：每天一次資料庫寫入
    就足以讓專案不被判定為閒置而暫停。
  */
  await db()
    .from('audit_logs')
    .insert({
      actor_type: 'system',
      action: 'cron_daily',
      target_type: 'cron',
      detail: {
        到期餘額: balances.data ?? 0,
        到期券: coupons.data ?? 0,
        失效序號: tokens.data ?? 0,
        推播: push,
        帳務異常: breaches,
      },
    })
    .then(
      () => undefined,
      () => undefined,
    );

  return NextResponse.json({
    expiredBalances: balances.data ?? 0,
    expiredCoupons: coupons.data ?? 0,
    expiredTokens: tokens.data ?? 0,
    push,
    // 這個數字必須永遠是 0。非 0 代表有人繞過流水帳動了餘額
    integrityBreaches: breaches,
  });
}
