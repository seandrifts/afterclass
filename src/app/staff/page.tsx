import { redirect } from 'next/navigation';

import { StaffPanel } from './staff-panel';
import { getStaffSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { shopDayStart } from '@/lib/time';
import type { Prize } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const session = await getStaffSession();
  if (!session) redirect('/staff/login');

  const today = startOfToday();

  // 今日統計。折抵金額是實際成本，比發放張數更該盯
  const [issued, drawn, redeemed, prizeRows] = await Promise.all([
    db()
      .from('draw_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('issued_by', session.sid)
      .gte('issued_at', today),
    db()
      .from('draw_tokens')
      .select('id', { count: 'exact', head: true })
      .gte('drawn_at', today),
    db()
      .from('balance_transactions')
      .select('amount')
      .eq('type', 'spend')
      .gte('created_at', today),
    // 轉盤要顯示所有獎項名稱，跟客人端同一份資料
    db().from('prizes').select('*').eq('is_active', true).order('sort_order'),
  ]);

  const redeemedTotal = (redeemed.data ?? []).reduce(
    (sum, r) => sum + Math.abs(r.amount as number),
    0,
  );

  return (
    <StaffPanel
      staffName={session.name}
      isOwner={session.role === 'owner'}
      prizes={(prizeRows.data ?? []) as Prize[]}
      stats={{
        issued: issued.count ?? 0,
        drawn: drawn.count ?? 0,
        redeemedCount: redeemed.data?.length ?? 0,
        redeemedTotal,
      }}
    />
  );
}

// 日界用店家時區，見 src/lib/time.ts
const startOfToday = () => shopDayStart();
