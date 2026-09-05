import { CreditBoard } from './credit-board';
import { db } from '@/lib/supabase';
import { getSettings } from '@/lib/settings';
import { shopMonthStart } from '@/lib/time';

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

export default async function CreditsPage(
  props: PageProps<'/admin/credits'>,
) {
  const settings = await getSettings();

  const params = await props.searchParams;
  const query = (typeof params.q === 'string' ? params.q : '').trim();

  /*
    查單一客人的紀錄。

    原本只有全站流水一長串，要查「某位客人的點數怎麼變成這樣」
    得自己往下捲著找。客訴處理時這是最常用的功能。

    支援會員碼與姓名，兩者都用模糊比對。
  */
  let matchedUserIds: string[] | null = null;
  let matchedUsers: { id: string; display_name: string | null; wallet_code: string; balance: number }[] = [];

  if (query) {
    const { data: found } = await db()
      .from('users')
      .select('id, display_name, wallet_code, balance')
      .or(`wallet_code.ilike.%${query}%,display_name.ilike.%${query}%`)
      .limit(20);

    matchedUsers = found ?? [];
    matchedUserIds = matchedUsers.map((u) => u.id);
  }

  let ledgerQuery = db()
    .from('balance_transactions')
    .select(
      'id, created_at, type, amount, balance_after, note, users(display_name, wallet_code), staff(name)',
    )
    .order('created_at', { ascending: false });

  if (matchedUserIds) {
    // 查不到人的時候要回傳空清單，不能退回全站資料
    ledgerQuery = ledgerQuery.in(
      'user_id',
      matchedUserIds.length > 0 ? matchedUserIds : ['00000000-0000-0000-0000-000000000000'],
    );
  }

  const { data: ledger } = await ledgerQuery.limit(query ? 300 : 100);

  const warnCutoff = new Date();
  warnCutoff.setDate(warnCutoff.getDate() + settings.expire_warn_days);

  // 月初也要用店家時區，否則月初與月底那幾小時會歸錯月份
  const monthStart = shopMonthStart();

  const [soon, all, expiredThisMonth, integrity, prizeRows] = await Promise.all([
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
      .gte('created_at', monthStart),
    db().rpc('check_balance_integrity'),
    // 送獎項的下拉選單。只列還在啟用的，停用的獎項不該再送出去
    db()
      .from('prizes')
      .select('id, name, face_value, type')
      .eq('is_active', true)
      .order('sort_order'),
  ]);

  const sum = (rows: { balance: number }[] | null) =>
    (rows ?? []).reduce((a, r) => a + r.balance, 0);

  return (
    <CreditBoard
      ledger={(ledger ?? []) as unknown as LedgerRow[]}
      query={query}
      matchedUsers={matchedUsers}
      warnDays={settings.expire_warn_days}
      prizes={prizeRows.data ?? []}
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
