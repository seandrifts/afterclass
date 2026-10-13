import { TokenBoard } from './token-board';
import { db } from '@/lib/supabase';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export interface BatchRow {
  id: string;
  name: string;
  quantity: number;
  activated_qty: number;
  note: string | null;
  created_at: string;
  counts: { active: number; drawn: number; claimed: number; inactive: number };
  /** 最近一次藍牙列印印到第幾張。沒印過是 null */
  lastPrinted: { range: string; last: number; at: string } | null;
}

export default async function TokensPage() {
  const settings = await getSettings();

  const { data: batches } = await db()
    .from('token_batches')
    .select('*')
    .order('created_at', { ascending: false });

  /*
    一次 GROUP BY 拿回所有批次的統計。

    原本是對每個批次分別發 4 次 count 查詢，而且批次之間循序等待，
    10 個批次就是 40 次查詢分 10 輪往返。
  */
  interface BatchStat {
    batch_id: string;
    inactive: number;
    active: number;
    drawn: number;
    claimed: number;
  }

  const { data: stats } = await db().rpc('batch_stats');

  const byBatch = new Map<string, BatchStat>(
    ((stats ?? []) as BatchStat[]).map((s) => [s.batch_id, s]),
  );

  /*
    每個批次最近一次藍牙列印印到哪裡（由瀏覽器印完後回報，見
    api/admin/tokens/[id]/printed）。由新到舊掃，每個批次只留第一筆。
  */
  const { data: printLogs } = await db()
    .from('audit_logs')
    .select('target_id, detail, created_at')
    .eq('action', 'ticket_printed')
    .order('created_at', { ascending: false })
    .limit(300);

  const lastPrinted = new Map<string, BatchRow['lastPrinted']>();
  for (const log of printLogs ?? []) {
    if (lastPrinted.has(log.target_id)) continue;
    const detail = log.detail as { 範圍?: string; 最後一張?: number } | null;
    if (!detail?.最後一張) continue;
    lastPrinted.set(log.target_id, {
      range: detail.範圍 ?? '',
      last: detail.最後一張,
      at: log.created_at,
    });
  }

  const rows: BatchRow[] = (batches ?? []).map((b) => {
    const s = byBatch.get(b.id);
    return {
      ...b,
      lastPrinted: lastPrinted.get(b.id) ?? null,
      counts: {
        inactive: Number(s?.inactive ?? 0),
        active: Number(s?.active ?? 0),
        drawn: Number(s?.drawn ?? 0),
        claimed: Number(s?.claimed ?? 0),
      },
    };
  });

  return <TokenBoard batches={rows} validDays={settings.card_token_valid_days} />;
}
