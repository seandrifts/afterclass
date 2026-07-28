import 'server-only';

import { db } from './supabase';

function startOfDay(offsetDays = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString();
}

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export interface DashboardStats {
  todayIssued: number;
  todayDrawn: number;
  todayRedeemedCount: number;
  todayRedeemedTotal: number;

  monthRedeemedTotal: number;
  monthEarnedTotal: number;
  monthExpiredTotal: number;
  monthNewMembers: number;

  /** 流通中點數。客人手上還沒用掉的餘額總和，這是帳面負債 */
  outstanding: number;
  expiringSoonAmount: number;
  expiringSoonPeople: number;

  activeTokensLeft: number;

  /** 這個必須永遠是 0。非 0 代表有人繞過 ledger 動了餘額 */
  integrityBreaches: number;
}

export async function loadDashboard(
  expireWarnDays: number,
): Promise<DashboardStats> {
  const today = startOfDay();
  const month = startOfMonth();

  const warnCutoff = new Date();
  warnCutoff.setDate(warnCutoff.getDate() + expireWarnDays);

  const [
    issued,
    drawn,
    todaySpend,
    monthSpend,
    monthEarn,
    monthExpire,
    newMembers,
    balances,
    expiring,
    tokensLeft,
    integrity,
  ] = await Promise.all([
    db()
      .from('draw_tokens')
      .select('id', { count: 'exact', head: true })
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
    db()
      .from('balance_transactions')
      .select('amount')
      .eq('type', 'spend')
      .gte('created_at', month),
    db()
      .from('balance_transactions')
      .select('amount')
      .eq('type', 'earn')
      .gte('created_at', month),
    db()
      .from('balance_transactions')
      .select('amount')
      .eq('type', 'expire')
      .gte('created_at', month),
    db()
      .from('users')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', month),
    db().from('users').select('balance').gt('balance', 0),
    db()
      .from('users')
      .select('balance')
      .gt('balance', 0)
      .lt('balance_expires_at', warnCutoff.toISOString()),
    db()
      .from('draw_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    db().rpc('check_balance_integrity'),
  ]);

  const sum = (rows: { amount: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + Math.abs(r.amount), 0);

  const sumBalance = (rows: { balance: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + r.balance, 0);

  return {
    todayIssued: issued.count ?? 0,
    todayDrawn: drawn.count ?? 0,
    todayRedeemedCount: todaySpend.data?.length ?? 0,
    todayRedeemedTotal: sum(todaySpend.data),

    monthRedeemedTotal: sum(monthSpend.data),
    monthEarnedTotal: sum(monthEarn.data),
    monthExpiredTotal: sum(monthExpire.data),
    monthNewMembers: newMembers.count ?? 0,

    outstanding: sumBalance(balances.data),
    expiringSoonAmount: sumBalance(expiring.data),
    expiringSoonPeople: expiring.data?.length ?? 0,

    activeTokensLeft: tokensLeft.count ?? 0,

    integrityBreaches: Array.isArray(integrity.data)
      ? integrity.data.length
      : 0,
  };
}
