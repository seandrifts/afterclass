import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Card, Screen } from '@/components/ui';
import { formatForCustomer } from '@/lib/points';
import { getSettings } from '@/lib/settings';
import { getUserSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import type { BalanceTransaction, TxnType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const LABELS: Record<TxnType, string> = {
  earn: '抽獎獲得',
  spend: '結帳折抵',
  expire: '到期歸零',
  adjust: '調整',
};

export default async function HistoryPage() {
  const session = await getUserSession();
  if (!session) redirect('/login?next=%2Fwallet%2Fhistory');

  const settings = await getSettings();

  const { data } = await db()
    .from('balance_transactions')
    .select('*')
    .eq('user_id', session.uid)
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (data ?? []) as BalanceTransaction[];

  return (
    <Screen>
      <header className="mb-5 flex items-center gap-3">
        <Link href="/wallet" className="text-brand-600">
          ← 返回
        </Link>
        <h1 className="text-xl font-bold">點數明細</h1>
      </header>

      {rows.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-ink-soft">還沒有任何紀錄</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.id} className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{LABELS[row.type]}</p>
                <p className="mt-0.5 text-sm text-ink-faint">
                  {new Date(row.created_at).toLocaleString('zh-TW', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {row.note ? ` · ${row.note}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`tabular text-lg font-bold ${
                    row.amount > 0 ? 'text-good' : 'text-ink'
                  }`}
                >
                  {row.amount > 0 ? '+' : '−'}
                  {formatForCustomer(Math.abs(row.amount), settings)}
                </p>
                <p className="tabular text-xs text-ink-faint">
                  餘 {row.balance_after} 元
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Screen>
  );
}
