import { redirect } from 'next/navigation';

import { StaffPanel } from './staff-panel';
import { getStaffSession } from '@/lib/session';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const session = await getStaffSession();
  if (!session) redirect('/staff/login');

  const today = startOfToday();

  // 今日統計。折抵金額是實際成本，比發放張數更該盯
  const [issued, drawn, redeemed] = await Promise.all([
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
  ]);

  const redeemedTotal = (redeemed.data ?? []).reduce(
    (sum, r) => sum + Math.abs(r.amount as number),
    0,
  );

  return (
    <StaffPanel
      staffName={session.name}
      isOwner={session.role === 'owner'}
      stats={{
        issued: issued.count ?? 0,
        drawn: drawn.count ?? 0,
        redeemedCount: redeemed.data?.length ?? 0,
        redeemedTotal,
      }}
    />
  );
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
