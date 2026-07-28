import { CreditBoard } from './credit-board';
import { db } from '@/lib/supabase';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export interface LedgerRow {
  id: string;
  created_at: string;
  type: string;
  amount: number;
  balance_after: number;
  note: string | null;
  users: { display_name: string | null; wallet_code: string } | null;
  staff: { name: string } | null;
}

export default async function CreditsPage() {
  const settings = await getSettings();

  const { data: ledger } = await db()
    .from('balance_transactions')
    .select(
      'id, created_at, type, amount, balance_after, note, users(display_name, wallet_code), staff(name)',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  const warnCutoff = new Date();
  warnCutoff.setDate(warnCutoff.getDate() + settings.expire_warn_days);

  const month = new Date();
  month.setDate(1);
  month.setHours(0, 0, 0, 0);

  const [soon, all, expiredThisMonth, integrity] = await Promise.all([
    db()
      .from('users')
      .select('balance')
      .gt('balance', 0)
      .lt('balance_expires_at', warnCutoff.toISOString()),
    db().from('users').select('balance').gt('balance', 0),
    db()
      .from('balance_transactions')
      .select('amount')
      .eq('type', 'expire')
      .gte('created_at', month.toISOString()),
    db().rpc('check_balance_integrity'),
  ]);

  const sum = (rows: { balance: number }[] | null) =>
    (rows ?? []).reduce((a, r) => a + r.balance, 0);

  return (
    <CreditBoard
      ledger={(ledger ?? []) as unknown as LedgerRow[]}
      warnDays={settings.expire_warn_days}
      summary={{
        outstanding: sum(all.data),
        outstandingPeople: all.data?.length ?? 0,
        expiringSoon: sum(soon.data),
        expiringSoonPeople: soon.data?.length ?? 0,
        expiredThisMonth: (expiredThisMonth.data ?? []).reduce(
          (a, r) => a + Math.abs(r.amount),
          0,
        ),
        integrityBreaches: Array.isArray(integrity.data)
          ? integrity.data.length
          : 0,
      }}
    />
  );
}
