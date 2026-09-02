import 'server-only';

import { excludeLowestTier, pickPrize, toSnapshot } from './draw';
import { getSettings, isCampaignOpen } from './settings';
import { db } from './supabase';
import { readToken } from './tokens';
import type { Prize, PrizeSnapshot } from './types';

/**
 * 抽獎的實際執行。
 *
 * 客人自己掃碼（/api/draw）與店員用 iPad 代抽（店員端）走的是同一段
 * 程式。兩邊各寫一份的話，機率、保底、缺貨判斷遲早會走鐘，而這種
 * 誤差不會噴錯，只會安靜地讓某些客人中獎率跟公告的不一樣。
 *
 * 結果決定後只寫進 token，不入帳。入帳是 claim_token() 的事。
 */
export type DrawOutcome =
  | { ok: true; prize: PrizeSnapshot }
  | { ok: false; error: string; reason?: string; status: number };

export async function runDraw(opts: {
  code: string;
  ipHash: string;
  /** 已知是誰在抽時傳入，保底才算得準 */
  userId?: string | null;
}): Promise<DrawOutcome> {
  const settings = await getSettings();

  const campaign = isCampaignOpen(settings);
  if (!campaign.open) {
    return {
      ok: false,
      error: 'CAMPAIGN_CLOSED',
      reason: campaign.reason ?? undefined,
      status: 403,
    };
  }

  const state = await readToken(opts.code);
  if (state.kind !== 'ready') {
    return { ok: false, error: 'TOKEN_NOT_AVAILABLE', reason: state.kind, status: 409 };
  }

  const { data: prizeRows } = await db()
    .from('prizes')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');

  let prizes = (prizeRows ?? []) as Prize[];
  if (prizes.length === 0) {
    return { ok: false, error: 'NO_PRIZES', status: 503 };
  }

  /*
    保底：連續抽到最低級距太多次就把它排除掉。

    熟客一週來三次，連續二十次都抽到 1 元會覺得被耍。店員代抽時
    一定知道客人是誰，所以這條在 iPad 那邊反而比客人自己抽更準 ——
    客人自己抽時如果還沒登入，根本追蹤不到連續次數。
  */
  if (settings.pity_enabled && opts.userId) {
    if (await hasHitPity(opts.userId, prizes, settings.pity_threshold)) {
      prizes = excludeLowestTier(prizes);
    }
  }

  const prize = pickPrize(prizes);
  if (!prize) return { ok: false, error: 'NO_PRIZES', status: 503 };

  const snapshot = toSnapshot(prize);

  const { data: result, error } = await db()
    .rpc('commit_draw', {
      p_code: opts.code,
      p_prize_id: prize.id,
      p_snapshot: snapshot,
      p_ip_hash: opts.ipHash,
    })
    .single<{ ok: boolean; reason: string | null; token_id: string | null }>();

  if (error) return { ok: false, error: 'DRAW_FAILED', status: 500 };

  // 併發下被別人搶先抽走，或獎項剛好賣完。什麼都沒寫入
  if (!result?.ok) {
    return { ok: false, error: result?.reason ?? 'DRAW_FAILED', status: 409 };
  }

  return { ok: true, prize: snapshot };
}

/**
 * 這個帳號是不是連續 N 次都抽到最低價值的獎項。
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
