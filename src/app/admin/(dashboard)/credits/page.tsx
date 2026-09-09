import { CreditBoard } from './credit-board';
import { db } from '@/lib/supabase';
import { getSettings } from '@/lib/settings';
import { loadCreditTotals } from '@/lib/stats';

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

  /*
    加總走 report_totals()，跟後台首頁同一個函式。

    原本這裡是把所有餘額大於零的使用者、以及本月每一筆到期紀錄整批
    拉回來用 JS 加總。PostgREST 單次回傳有筆數上限，超過會靜靜截斷，
    加總出來的「流通中點數」會偏小而且看不出異常。詳見 0008 migration。
  */
  const [totals, integrity, prizeRows] = await Promise.all([
    loadCreditTotals(settings.expire_warn_days),
    db().rpc('check_balance_integrity'),
    // 送獎項的下拉選單。只列還在啟用的，停用的獎項不該再送出去
    db()
      .from('prizes')
      .select('id, name, face_value, type')
      .eq('is_active', true)
      .order('sort_order'),
  ]);

  return (
    <CreditBoard
      ledger={(ledger ?? []) as unknown as LedgerRow[]}
      query={query}
      matchedUsers={matchedUsers}
      warnDays={settings.expire_warn_days}
      prizes={prizeRows.data ?? []}
      /* null 代表 0008 migration 還沒跑。畫面要講清楚，不能顯示 0 */
      totalsMissing={totals === null}
      summary={{
        outstanding: totals?.outstanding ?? 0,
        outstandingPeople: totals?.outstanding_people ?? 0,
        expiringSoon: totals?.expiring_amount ?? 0,
        expiringSoonPeople: totals?.expiring_people ?? 0,
        expiredThisMonth: totals?.month_expire_total ?? 0,
        integrityBreaches: Array.isArray(integrity.data)
          ? integrity.data.length
          : 0,
      }}
    />
  );
}
