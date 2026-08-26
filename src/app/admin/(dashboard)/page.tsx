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
            emphasis
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
            {/*
              軌道用虛線邊框而不是實色底。實色底在 0% 時整條看起來
              像是「已經填滿」，反而讓人誤判成本狀況
            */}
            <div
              className="h-3 overflow-hidden rounded-full border border-dashed border-brand-200 bg-white"
              role="progressbar"
              aria-valuenow={capUsage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="本月成本佔上限比例"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-700 ${
                  capUsage >= 90 ? 'bg-bad' : 'bg-brand-500'
                }`}
                style={{ width: `${Math.min(100, capUsage)}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              本月成本已用 <strong className="tabular">{capUsage}%</strong> 的上限
              <span className="text-ink-faint">
                {' '}（{s.monthRedeemedTotal} / {settings.monthly_cost_cap} 元）
              </span>
            </p>
          </div>
        ) : null}
      </section>

      {/*
        原本這張卡塞了一整段「為什麼要看這個數字」的說明。儀表板是
        每天掃一眼的地方，不是文件，長解釋放在這裡只會擋住數字。
        判讀方式移到 details 裡，需要時才展開。
      */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-ink-soft">
              流通中點數（負債）
            </h2>
            <p className="tabular mt-1 text-4xl font-black">
              {s.outstanding}
              <span className="ml-2 text-lg font-bold text-ink-soft">元</span>
            </p>
          </div>

          <div className="text-right">
            <p className="text-sm text-ink-soft">
              {settings.expire_warn_days} 天內到期
            </p>
            <p className="tabular mt-1 text-2xl font-black text-brand-600">
              {s.expiringSoonAmount}
              <span className="ml-1 text-sm">元</span>
              <span className="ml-2 text-sm font-medium text-ink-soft">
                {s.expiringSoonPeople} 人
              </span>
            </p>
          </div>
        </div>

        <details className="group mt-4">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs text-ink-faint underline underline-offset-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
            這個數字怎麼看
          </summary>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            客人手上還沒用掉的餘額總和。活動初期會一路上升，跑滿一個到期
            週期（{settings.credit_expire_days} 天）之後應該趨於穩定。
            如果三個月後還在直線上升，代表客人不來用，該檢討的是金額級距
            或折抵流程，不是加碼獎項。
          </p>
        </details>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/admin/prizes"
          className="cursor-pointer rounded-xl bg-brand-500 px-5 py-3 text-sm font-bold text-(--color-brand-on) transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
        >
          調整獎項與機率
        </Link>
        <Link
          href="/admin/tokens"
          className="cursor-pointer rounded-xl border border-line bg-raised px-5 py-3 text-sm font-bold transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
        >
          序號管理
        </Link>
      </div>
    </div>
  );
}

/**
 * 統計方塊。
 *
 * emphasis 用來區分主要指標。原本 8 個方塊長得一模一樣，
 * 掃過去看不出哪個該優先注意，等於沒有層級。
 */
function Tile({
  label,
  value,
  unit,
  note,
  emphasis,
}: {
  label: string;
  value: number;
  unit: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        emphasis
          ? 'border-brand-300 bg-brand-50'
          : 'border-line bg-raised'
      }`}
    >
      <p
        className={`text-xs font-medium ${
          emphasis ? 'text-brand-700' : 'text-ink-soft'
        }`}
      >
        {label}
      </p>
      <p
        className={`tabular mt-1 font-black ${
          emphasis ? 'text-3xl text-brand-700' : 'text-2xl'
        }`}
      >
        {value}
        <span className="ml-1 text-sm font-bold opacity-60">{unit}</span>
      </p>
      {note ? (
        <p
          className={`mt-1 text-xs ${
            emphasis ? 'text-brand-600' : 'text-ink-faint'
          }`}
        >
          {note}
        </p>
      ) : null}
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

  /*
    排程停掉是「安靜的失敗」：點數不會到期、到期提醒不會發送，
    而且不會有任何錯誤畫面。要主動盯著才發現得了。

    正常是每天跑一次，超過 36 小時沒跑就代表有問題。
  */
  const cronAge = stats.cronAgeHours;

  if (cronAge === null) {
    alerts.push({
      level: 'warn',
      text: '每日排程還沒執行過。第一次會在明天凌晨 4 點，到時候再回來確認。',
    });
  } else if (cronAge > 36) {
    alerts.push({
      level: 'bad',
      text: `每日排程已經 ${Math.floor(cronAge / 24)} 天沒有執行。點數不會到期，到期提醒也不會發送。請檢查 Vercel 的 Cron 設定。`,
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
