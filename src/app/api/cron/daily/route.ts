import { createHash, timingSafeEqual } from 'node:crypto';
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

/*
  Vercel 的函式有執行時間上限，不指定就用預設值。60 秒是 Hobby 與 Pro
  兩種方案都吃得下的最大值，所以寫死在這裡不會因為方案而部署失敗。
*/
export const maxDuration = 60;

/*
  整條路由要在幾秒內收工。

  推播是唯一會隨著會員數成長的部分（每人一次 LINE API 加一次資料庫
  寫入），所以時間預算給它。留 10 秒的餘裕給後面的心跳更新，讓它在
  被砍掉之前一定寫得完。
*/
const DEADLINE_MS = (maxDuration - 10) * 1000;

export async function GET(request: Request) {
  const startedAt = Date.now();
  const auth = request.headers.get('authorization');
  if (!auth || !sameSecret(auth, `Bearer ${env.cronSecret()}`)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // 先清到期資料，再發提醒。順序反過來會提醒到已經歸零的人
  const [balances, coupons, tokens] = await Promise.all([
    db().rpc('expire_balances'),
    db().rpc('expire_coupons'),
    db().rpc('expire_tokens'),
  ]);

  const [settings, integrity] = await Promise.all([
    getSettings(),
    db().rpc('check_balance_integrity'),
  ]);
  const breaches = Array.isArray(integrity.data) ? integrity.data.length : 0;

  /*
    心跳要在推播之前寫。

    原本這筆紀錄寫在整條路由的最後。推播是逐人跑的，會員一多就會超過
    函式的執行時間上限被砍掉，於是這筆永遠寫不進去，後果是：

      1. 後台會顯示「每日排程已經 N 天沒有執行」，但其實到期處理都跑完了
      2. Supabase 免費方案靠這筆寫入判定專案沒有閒置，少了它專案會被暫停

    到期處理在這一行之前就已經完成，所以先寫是誠實的。推播結果等一下
    再補上去。

    這筆紀錄的另一個用途是分辨「排程正常但沒事可做」與「排程根本沒跑」。
    後者會讓點數永遠不到期而且要好幾個月才發現得了。
  */
  const { data: log } = await db()
    .from('audit_logs')
    .insert({
      actor_type: 'system',
      action: 'cron_daily',
      target_type: 'cron',
      detail: {
        到期餘額: balances.data ?? 0,
        到期券: coupons.data ?? 0,
        失效序號: tokens.data ?? 0,
        帳務異常: breaches,
        推播: '進行中',
      },
    })
    .select('id')
    .single();

  // 前面的到期處理已經花掉一些時間，預算要扣掉，不能從這一刻重新算
  const push = await sendExpiryWarnings(settings, {
    budgetMs: Math.max(0, DEADLINE_MS - (Date.now() - startedAt)),
  });

  if (log) {
    await db()
      .from('audit_logs')
      .update({
        detail: {
          到期餘額: balances.data ?? 0,
          到期券: coupons.data ?? 0,
          失效序號: tokens.data ?? 0,
          帳務異常: breaches,
          推播: push,
        },
      })
      .eq('id', log.id)
      .then(
        () => undefined,
        () => undefined,
      );
  }

  return NextResponse.json({
    expiredBalances: balances.data ?? 0,
    expiredCoupons: coupons.data ?? 0,
    expiredTokens: tokens.data ?? 0,
    push,
    // 這個數字必須永遠是 0。非 0 代表有人繞過流水帳動了餘額
    integrityBreaches: breaches,
  });
}

/** 定時比對。先雜湊成等長再比，長度本身也不會從回應時間洩漏 */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
