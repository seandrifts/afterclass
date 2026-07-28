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
}

export default async function TokensPage() {
  const settings = await getSettings();

  const { data: batches } = await db()
    .from('token_batches')
    .select('*')
    .order('created_at', { ascending: false });

  const rows: BatchRow[] = [];

  for (const b of batches ?? []) {
    const statuses = ['inactive', 'active', 'drawn', 'claimed'] as const;

    const counts = await Promise.all(
      statuses.map((s) =>
        db()
          .from('draw_tokens')
          .select('id', { count: 'exact', head: true })
          .eq('batch_id', b.id)
          .eq('status', s),
      ),
    );

    rows.push({
      ...b,
      counts: {
        inactive: counts[0].count ?? 0,
        active: counts[1].count ?? 0,
        drawn: counts[2].count ?? 0,
        claimed: counts[3].count ?? 0,
      },
    });
  }

  return <TokenBoard batches={rows} validDays={settings.card_token_valid_days} />;
}
