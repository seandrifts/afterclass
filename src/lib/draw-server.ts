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

/*
  保底要往回看幾筆。

  這個數字必須「一次抓好抓滿」，因為要跟設定、獎項、序號狀態同時發出去
  才省得到往返時間，而那時候還讀不到 settings.pity_threshold（它就在
  同一批裡）。抓固定的 50 筆回來之後再照實際門檻去裁。

  門檻設得比 50 大的話（預設 20）就退回去補一次查詢，那是罕見情況，
  慢一點沒關係，但不能算錯。
*/
const PITY_LOOKBACK = 50;

export async function runDraw(opts: {
  code: string;
  ipHash: string;
  /** 已知是誰在抽時傳入，保底才算得準 */
  userId?: string | null;
}): Promise<DrawOutcome> {
  /*
    這四件事彼此不相依，一起發出去。

    原本是一個等一個：設定、序號狀態、獎項清單、保底紀錄，四趟往返
    排成一列。抽獎是客人站在櫃檯前盯著看的動作，這裡每一趟的延遲都
    直接變成他等待的時間。

    代價是活動關閉或序號無效時會多查幾筆用不到的資料。那是失敗路徑，
    不值得為它拖慢每一次正常的抽獎。
  */
  const [settings, state, prizeRes, pityRows] = await Promise.all([
    getSettings(),
    readToken(opts.code),
    db().from('prizes').select('*').eq('is_active', true).order('sort_order'),
    opts.userId ? recentSnapshots(opts.userId, PITY_LOOKBACK) : null,
  ]);

  const campaign = isCampaignOpen(settings);
  if (!campaign.open) {
    return {
      ok: false,
      error: 'CAMPAIGN_CLOSED',
      reason: campaign.reason ?? undefined,
      status: 403,
    };
  }

  if (state.kind !== 'ready') {
    return { ok: false, error: 'TOKEN_NOT_AVAILABLE', reason: state.kind, status: 409 };
  }

  let prizes = (prizeRes.data ?? []) as Prize[];
  if (prizes.length === 0) {
    return { ok: false, error: 'NO_PRIZES', status: 503 };
  }

  /*
    保底：連續抽到最低級距太多次就把它排除掉。

    熟客一週來三次，連續二十次都抽到 1 元會覺得被耍。店員代抽時
    一定知道客人是誰，所以這條在 iPad 那邊反而比客人自己抽更準：
    客人自己抽時如果還沒登入，根本追蹤不到連續次數。
  */
  if (settings.pity_enabled && opts.userId) {
    const threshold = settings.pity_threshold;

    const history =
      threshold <= PITY_LOOKBACK
        ? (pityRows ?? [])
        : await recentSnapshots(opts.userId, threshold);

    if (hasHitPity(history, prizes, threshold)) {
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

interface SnapshotRow {
  prize_snapshot: { face_value: number } | null;
}

/** 這個帳號最近 N 次的中獎內容，新的在前 */
async function recentSnapshots(
  userId: string,
  limit: number,
): Promise<SnapshotRow[]> {
  const { data } = await db()
    .from('draw_tokens')
    .select('prize_snapshot')
    .eq('claimed_by', userId)
    .not('prize_snapshot', 'is', null)
    .order('drawn_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as SnapshotRow[];
}

/**
 * 這個帳號是不是連續 N 次都抽到最低價值的獎項。
 *
 * 只做判斷不查資料庫，查詢在上面跟其他東西一起發出去了。
 */
function hasHitPity(
  history: SnapshotRow[],
  prizes: Prize[],
  threshold: number,
): boolean {
  const active = prizes.filter((p) => p.weight > 0);
  if (active.length === 0) return false;

  // 抽獎次數還不夠多，談不上連續
  if (history.length < threshold) return false;

  const lowest = Math.min(...active.map((p) => p.face_value));

  return history
    .slice(0, threshold)
    .every((row) => row.prize_snapshot?.face_value === lowest);
}
