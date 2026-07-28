import { NextResponse } from 'next/server';
import { z } from 'zod';

import { excludeLowestTier, pickPrize, toSnapshot } from '@/lib/draw';
import { normalizeCode } from '@/lib/codes';
import { clientIpHash, hit } from '@/lib/ratelimit';
import { getSettings, isCampaignOpen } from '@/lib/settings';
import { getUserSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { readToken } from '@/lib/tokens';
import type { Prize } from '@/lib/types';

const bodySchema = z.object({ code: z.string().min(1).max(32) });

/**
 * 執行抽獎。
 *
 * 機率計算全部在這裡完成，前端只收到已經決定好的結果並播動畫。
 *
 * 抽獎當下不入帳。中獎結果先掛在 token 上，等客人登入按領取才
 * 真正進餘額。這樣「抽完就關掉」的人不會產生成本，也解決了
 * 「還沒有帳號要入帳到哪裡」的問題。
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

  const code = normalizeCode(parsed.data.code);
  const settings = await getSettings();

  const campaign = isCampaignOpen(settings);
  if (!campaign.open) {
    return NextResponse.json(
      { error: 'CAMPAIGN_CLOSED', reason: campaign.reason },
      { status: 403 },
    );
  }

  const state = await readToken(code);
  if (state.kind !== 'ready') {
    return NextResponse.json({ error: 'TOKEN_NOT_AVAILABLE', state: state.kind }, {
      status: 409,
    });
  }

  const { data: prizeRows } = await db()
    .from('prizes')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');

  let prizes = (prizeRows ?? []) as Prize[];
  if (prizes.length === 0) {
    return NextResponse.json({ error: 'NO_PRIZES' }, { status: 503 });
  }

  // 保底：連續抽到最低級距太多次就排除它。只對登入過的人生效，
  // 未登入無法追蹤連續次數，但會連抽二十次的一定是熟客。
  if (settings.pity_enabled) {
    const session = await getUserSession();
    if (session && (await hasHitPity(session.uid, prizes, settings.pity_threshold))) {
      prizes = excludeLowestTier(prizes);
    }
  }

  const prize = pickPrize(prizes);
  if (!prize) {
    return NextResponse.json({ error: 'NO_PRIZES' }, { status: 503 });
  }

  const snapshot = toSnapshot(prize);

  const { data: result, error } = await db()
    .rpc('commit_draw', {
      p_code: code,
      p_prize_id: prize.id,
      p_snapshot: snapshot,
      p_ip_hash: ip,
    })
    .single<{ ok: boolean; reason: string | null; token_id: string | null }>();

  if (error) {
    return NextResponse.json({ error: 'DRAW_FAILED' }, { status: 500 });
  }

  // 併發下被別人搶先抽走，或獎項剛好賣完。什麼都沒寫入，直接回報
  if (!result?.ok) {
    return NextResponse.json(
      { error: result?.reason ?? 'DRAW_FAILED' },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, prize: snapshot });
}

/**
 * 這個帳號是不是連續 N 次都抽到最低價值的獎項。
 *
 * 熟客一週來三次，連續二十次都抽到 1 元會覺得被耍。
 */
async function hasHitPity(
  userId: string,
  prizes: Prize[],
  threshold: number,
): Promise<boolean> {
  const active = prizes.filter((p) => p.weight > 0);
  if (active.length === 0) return false;

  const lowest = Math.min(...active.map((p) => p.face_value));

  const { data } = await db()
    .from('draw_tokens')
    .select('prize_snapshot')
    .eq('claimed_by', userId)
    .not('prize_snapshot', 'is', null)
    .order('drawn_at', { ascending: false })
    .limit(threshold);

  if (!data || data.length < threshold) return false;

  return data.every(
    (row) =>
      (row.prize_snapshot as { face_value: number } | null)?.face_value ===
      lowest,
  );
}
