import { PrizeBoard } from './prize-board';
import { db } from '@/lib/supabase';
import { getSettings } from '@/lib/settings';
import type { Prize } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PrizesPage() {
  const settings = await getSettings();

  const { data } = await db()
    .from('prizes')
    .select('*')
    .order('sort_order')
    .order('created_at');

  const { data: changes } = await db()
    .from('prize_change_log')
    .select('id, created_at, before, after, prize_id')
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <PrizeBoard
      prizes={(data ?? []) as Prize[]}
      settings={settings}
      changes={changes ?? []}
    />
  );
}
