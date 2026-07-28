import Link from 'next/link';

import { Card } from '@/components/ui';
import { getSettings } from '@/lib/settings';
import { loadDashboard } from '@/lib/stats';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const settings = await getSettings();
  const s = await loadDashboard(settings.expire_warn_days);

  const scanRate =
    s.todayIssued > 0 ? Math.round((s.todayDrawn / s.todayIssued) * 100) : null;

  const capUsage =
    settings.monthly_cost_cap && settings.monthly_cost_cap > 0
      ? Math.round((s.monthRedeemedTotal / settings.monthly_cost_cap) * 100)
      : null;

  return (
    <div className="space-y-6">
      <Alerts stats={s} settings={settings} capUsage={capUsage} />

      <section>
        <h2 className="mb-3 text-sm font-bold text-ink-soft">今日</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="發放" value={s.todayIssued} unit="張" />
          <Tile
            label="抽獎"
            value={s.todayDrawn}
            unit="次"
            note={scanRate !== null ? `掃碼率 ${scanRate}%` : undefined}
          />
          <Tile
            label="折抵"
            value={s.todayRedeemedTotal}
            unit="元"
            note={`${s.todayRedeemedCount} 筆`}
          />
          <Tile
            label="今日成本"
            value={s.todayRedeemedTotal}
            unit="元"
            note="以實際折抵計"
          />
        </div>
        {scanRate !== null && scanRate < 50 ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-warn">
            掃碼率低於 50%。這是最該優先處理的指標，先改善店內告示與 QR
            的可掃性，在這之前調機率沒有意義。
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold text-ink-soft">本月</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="發出點數" value={s.monthEarnedTotal} unit="元" />
          <Tile
            label="實際折抵"
            value={s.monthRedeemedTotal}
            unit="元"
            note={
              settings.monthly_cost_cap
                ? `上限 ${settings.monthly_cost_cap}`
                : undefined
            }
          />
          <Tile label="到期歸零" value={s.monthExpiredTotal} unit="元" />
          <Tile label="新會員" value={s.monthNewMembers} unit="人" />
        </div>

        {capUsage !== null ? (
          <div className="mt-4">
            <div className="h-3 overflow-hidden rounded-full bg-brand-100">
              <div
                className={`h-full rounded-full ${
                  capUsage >= 90 ? 'bg-bad' : 'bg-brand-500'
                }`}
                style={{ width: `${Math.min(100, capUsage)}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              本月成本已用 {capUsage}% 的上限
            </p>
          </div>
        ) : null}
      </section>

      <Card>
        <h2 className="text-sm font-bold text-ink-soft">流通中點數（負債）</h2>
        <p className="tabular mt-2 text-4xl font-black">
          {s.outstanding}
          <span className="ml-2 text-lg font-bold text-ink-soft">元</span>
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          客人手上還沒用掉的餘額總和。活動初期會一路上升，跑滿一個到期週期
          （{settings.credit_expire_days} 天）之後應該趨於穩定。
          如果三個月後還在直線上升，代表客人不來用，該檢討的是金額級距
          或折抵流程，不是加碼獎項。
        </p>
        <p className="mt-3 text-sm">
          <span className="font-bold">{settings.expire_warn_days}</span> 天內到期：
          <span className="font-bold text-brand-600">
            {' '}
            {s.expiringSoonAmount} 元 / {s.expiringSoonPeople} 人
          </span>
        </p>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/prizes"
          className="rounded-xl bg-brand-500 px-5 py-3 text-sm font-bold text-white"
        >
          調整獎項與機率
        </Link>
        <Link
          href="/admin/tokens"
          className="rounded-xl border border-line bg-raised px-5 py-3 text-sm font-bold"
        >
          序號管理
        </Link>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: number;
  unit: string;
  note?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-raised p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="tabular mt-1 text-2xl font-black">
        {value}
        <span className="ml-1 text-sm font-bold text-ink-soft">{unit}</span>
      </p>
      {note ? <p className="mt-1 text-xs text-ink-faint">{note}</p> : null}
    </div>
  );
}

function Alerts({
  stats,
  settings,
  capUsage,
}: {
  stats: Awaited<ReturnType<typeof loadDashboard>>;
  settings: Awaited<ReturnType<typeof getSettings>>;
  capUsage: number | null;
}) {
  const alerts: { level: 'bad' | 'warn'; text: string }[] = [];

  // 最高優先。代表有人繞過 ledger 動了餘額，那筆錢查不出去向
  if (stats.integrityBreaches > 0) {
    alerts.push({
      level: 'bad',
      text: `餘額一致性檢查失敗：${stats.integrityBreaches} 個帳戶的餘額與流水帳對不上。請立即停用活動並聯繫工程人員。`,
    });
  }

  if (!settings.campaign_active) {
    alerts.push({
      level: 'warn',
      text: '活動目前是暫停狀態，客人掃碼無法抽獎。已累積的點數仍可折抵。',
    });
  }

  if (capUsage !== null && capUsage >= 90) {
    alerts.push({
      level: 'bad',
      text: `本月成本已達上限的 ${capUsage}%。`,
    });
  }

  if (stats.activeTokensLeft < 50) {
    alerts.push({
      level: 'warn',
      text: `可用序號只剩 ${stats.activeTokensLeft} 組，該啟用下一批了。`,
    });
  }

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <p
          key={i}
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            a.level === 'bad' ? 'bg-red-50 text-bad' : 'bg-amber-50 text-warn'
          }`}
        >
          {a.text}
        </p>
      ))}
    </div>
  );
}
