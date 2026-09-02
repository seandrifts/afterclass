import { NextResponse } from 'next/server';
import { z } from 'zod';

import { runDraw } from '@/lib/draw-server';
import { normalizeCode } from '@/lib/codes';
import { clientIpHash, hit } from '@/lib/ratelimit';
import { getUserSession } from '@/lib/session';

const bodySchema = z.object({ code: z.string().min(1).max(32) });

/**
 * 客人自己掃碼抽獎。
 *
 * 機率計算全部在伺服器完成，前端只收到已經決定好的結果並播動畫。
 *
 * 抽獎當下不入帳。中獎結果先掛在 token 上，等客人登入按領取才真正
 * 進餘額。這樣「抽完就關掉」的人不會產生成本，也解決了「還沒有帳號
 * 要入帳到哪裡」的問題。
 *
 * 實際的抽獎在 lib/draw-server.ts，店員用 iPad 代抽走的是同一段。
 */
export async function POST(request: Request) {
  const ip = await clientIpHash();

  const limit = hit(`draw:${ip}`, 5, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', retryAfter: limit.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const session = await getUserSession();

  const outcome = await runDraw({
    code: normalizeCode(parsed.data.code),
    ipHash: ip,
    userId: session?.uid ?? null,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, reason: outcome.reason },
      { status: outcome.status },
    );
  }

  return NextResponse.json({ ok: true, prize: outcome.prize });
}
