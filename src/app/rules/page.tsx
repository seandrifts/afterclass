import Link from 'next/link';

import { IconArrowLeft } from '@/components/icons';
import { Card, Screen } from '@/components/ui';
import { getSettings } from '@/lib/settings';
import { db } from '@/lib/supabase';
import type { Prize } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const settings = await getSettings();

  const { data } = await db()
    .from('prizes')
    .select('*')
    .eq('is_active', true)
    .gt('weight', 0)
    .order('sort_order');

  const prizes = (data ?? []) as Prize[];
  const total = prizes.reduce((s, p) => s + p.weight, 0);

  return (
    <Screen>
      <header className="mb-6">
        <Link
          href="/wallet"
          className="inline-flex cursor-pointer items-center gap-1 rounded-xl px-2 py-1.5 text-sm text-brand-600 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
        >
          <IconArrowLeft className="size-4" />
          返回
        </Link>
        <h1 className="mt-2 text-2xl font-black">活動辦法</h1>
      </header>

      {/*
        機率表由系統直接從獎項設定產生，不是手打的。
        公平交易法要求公告機率必須真實，手打會有寫錯或忘記同步的風險。
      */}
      <Card>
        <h2 className="font-bold">中獎機率</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr>
              <th className="pb-2">獎項</th>
              <th className="pb-2 text-right">機率</th>
            </tr>
          </thead>
          <tbody>
            {prizes.map((p) => (
              <tr key={p.id} className="border-t border-line/60">
                <td className="py-2">{p.name}</td>
                <td className="tabular py-2 text-right font-bold">
                  {total > 0 ? ((p.weight / total) * 100).toFixed(2) : '0.00'}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-ink-faint">
          本表由系統依當前設定即時產生，與實際抽獎所用的機率完全一致。
        </p>
      </Card>

      <Card className="mt-4">
        <h2 className="font-bold">回饋點數規則</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>
            {settings.points_display_enabled
              ? `‧ ${settings.points_per_dollar} 點等值新台幣 1 元，僅供本店消費折抵`
              : '‧ 回饋金以新台幣計，僅供本店消費折抵'}
          </li>
          <li>‧ 點數不得轉讓、兌換現金、不找零</li>
          <li>
            ‧ 每次消費最多折抵 {settings.max_redeem_per_visit} 元，
            不可與其他優惠併用
          </li>
          <li>
            ‧ 點數自<strong>最後一次異動日</strong>起{' '}
            {settings.credit_expire_days} 日內有效。期間內任一次獲得或使用點數，
            有效期自動順延 {settings.credit_expire_days} 日。
            逾期未使用之點數將自動歸零，恕不補發
          </li>
          <li>
            ‧ 點數為本店提供之消費回饋，非預先付款購買之商品或服務
          </li>
        </ul>
      </Card>

      <Card className="mt-4">
        <h2 className="font-bold">活動方式</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>‧ 每次消費（不限金額）可獲得抽獎序號一組</li>
          <li>‧ 序號僅限使用一次，遺失恕不補發</li>
          <li>
            ‧ 抽獎後需於 {settings.claim_window_minutes} 分鐘內登入領取，
            逾時視為放棄
          </li>
          <li>‧ 本店保留活動修改與終止之權利，但已發出之點數權益不受影響</li>
          <li>‧ 個資僅用於本活動與本店行銷通知，得隨時要求刪除</li>
        </ul>
      </Card>

      {settings.rules_content ? (
        <Card className="mt-4">
          <h2 className="font-bold">補充說明</h2>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
            {settings.rules_content}
          </div>
        </Card>
      ) : null}
    </Screen>
  );
}
