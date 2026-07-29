'use client';

import { useActionState } from 'react';

import { saveSettingsAction } from './actions';
import { Button, Card } from '@/components/ui';
import type { Settings } from '@/lib/types';

export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState(saveSettingsAction, null);

  return (
    <form action={action} className="space-y-6 pb-24">
      <h1 className="text-xl font-black">設定</h1>

      {state && 'error' in state && state.error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-bad">
          {state.error}
        </p>
      ) : null}
      {state && 'saved' in state && state.saved ? (
        <div className="rounded-xl bg-green-50 px-4 py-3 text-sm text-good">
          <p className="font-bold">已儲存</p>
          {state.notice ? <p className="mt-1">{state.notice}</p> : null}
        </div>
      ) : null}

      <Section title="品牌">
        <Field label="店名">
          <Text name="shop_name" defaultValue={settings.shop_name} />
        </Field>
        <Field label="主色">
          <input
            name="primary_color"
            type="color"
            defaultValue={settings.primary_color}
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 h-10 w-full rounded-xl border border-line"
          />
        </Field>
      </Section>

      <Section title="活動開關">
        <Toggle
          name="campaign_active"
          label="活動進行中"
          defaultChecked={settings.campaign_active}
          hint="暫停時客人掃碼無法抽獎，但已累積的點數仍可折抵。這符合消保法，也避免客人覺得錢被吞了"
        />
        <Field label="暫停原因（顯示給客人）">
          <Text
            name="paused_reason"
            defaultValue={settings.paused_reason ?? ''}
            placeholder="活動暫停中，造成不便敬請見諒"
          />
        </Field>
      </Section>

      <Section title="回饋點數規則">
        <Field
          label="餘額到期天數"
          hint="滾動式。任何進出都把到期日往後推這麼多天，所以熟客實質上永不過期，只清掉沉睡客"
        >
          <Num name="credit_expire_days" defaultValue={settings.credit_expire_days} />
        </Field>

        <Field
          label="單次折抵上限（元）"
          hint="成本控制的第二道防線。防止客人存一大筆後一次幾乎免單，也讓店員好記"
        >
          <Num
            name="max_redeem_per_visit"
            defaultValue={settings.max_redeem_per_visit}
          />
        </Field>

        <Field label="折抵門檻（元）" hint="0 代表無門檻隨時可用">
          <Num
            name="min_balance_to_redeem"
            defaultValue={settings.min_balance_to_redeem}
          />
        </Field>

        <Field label="到期提醒提前天數">
          <Num name="expire_warn_days" defaultValue={settings.expire_warn_days} />
        </Field>

        <Toggle
          name="points_display_enabled"
          label="用「點」顯示給客人"
          defaultChecked={settings.points_display_enabled}
          hint="抽到「1 元」感覺寒酸，抽到「10 點」感覺好很多。店員端一律顯示元，不需要換算"
        />

        <Field label="點數倍率（1 元 = 幾點）">
          <Num name="points_per_dollar" defaultValue={settings.points_per_dollar} />
        </Field>

        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-warn">
          縮短到期天數<strong>不會</strong>追溯既有餘額。現有客人的到期日
          在每次異動時就已經算好存下來了，改設定只影響之後的異動。
          追溯性縮短客人的到期日是會被投訴的。
        </p>
      </Section>

      <Section title="活動規則">
        <Field label="實物券預設有效天數">
          <Num name="default_valid_days" defaultValue={settings.default_valid_days} />
        </Field>
        <Field label="紙卡序號有效天數">
          <Num
            name="card_token_valid_days"
            defaultValue={settings.card_token_valid_days}
          />
        </Field>
        <Field label="動態 QR 存活秒數">
          <Num
            name="dynamic_token_ttl_sec"
            defaultValue={settings.dynamic_token_ttl_sec}
          />
        </Field>
        <Field label="抽完到登入的領取時限（分鐘）">
          <Num
            name="claim_window_minutes"
            defaultValue={settings.claim_window_minutes}
          />
        </Field>
      </Section>

      <Section title="成本試算基準">
        <Field label="平均客單價（元）">
          <Num name="avg_ticket" defaultValue={settings.avg_ticket} />
        </Field>
        <Field label="毛利率（%）">
          <Num name="gross_margin_pct" defaultValue={settings.gross_margin_pct} />
        </Field>
        <Field label="每日來客數">
          <Num name="daily_customers" defaultValue={settings.daily_customers} />
        </Field>
      </Section>

      <Section title="成本煞車">
        <Field label="每月成本上限（元）" hint="留空代表不設限">
          <Num
            name="monthly_cost_cap"
            defaultValue={settings.monthly_cost_cap ?? ''}
          />
        </Field>
        <Field
          label="達到上限時"
          hint="建議選「只通知」。自動暫停會讓客人在店裡掃碼卻抽不了，體驗很差，寧可收到通知後自己決定"
        >
          <select
            name="cost_cap_action"
            defaultValue={settings.cost_cap_action}
            className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 w-full rounded-xl border border-line px-3 py-2"
          >
            <option value="notify">只通知我</option>
            <option value="pause">自動暫停活動</option>
          </select>
        </Field>
        <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-ink-soft">
          成本以<strong>實際折抵</strong>計算，不是以發放計算。客人抽到
          50 元但還沒來用，這時候還沒有成本。流通中的點數另外列在儀表板
          當負債，兩個數字要分開看。
        </p>
      </Section>

      <Section title="保底機制">
        <Toggle
          name="pity_enabled"
          label="啟用保底"
          defaultChecked={settings.pity_enabled}
          hint="熟客一週來三次，連續抽到最低金額會覺得被耍。成本增加極小但體感差很多"
        />
        <Field label="連續幾次觸發">
          <Num name="pity_threshold" defaultValue={settings.pity_threshold} />
        </Field>
      </Section>

      <Section title="活動辦法">
        <Field
          label="條款內容"
          hint="中獎機率表由系統自動從獎項設定產生並插入，不需要手打。公平交易法要求公告機率必須真實，手打會有寫錯或忘記同步的風險"
        >
          <textarea
            name="rules_content"
            defaultValue={settings.rules_content}
            rows={14}
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 w-full rounded-xl border border-line px-3 py-2 font-mono text-sm"
          />
        </Field>
      </Section>

      <div className="sticky bottom-4 rounded-card border-2 border-brand-500 bg-raised p-3 shadow-lg">
        <Button type="submit" disabled={pending}>
          {pending ? '儲存中⋯' : '儲存設定'}
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <h2 className="mb-4 font-black">{title}</h2>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-ink-soft">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? (
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">{hint}</p>
      ) : null}
    </label>
  );
}

function Text(props: React.ComponentProps<'input'>) {
  return (
    <input
      {...props}
      className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 w-full rounded-xl border border-line px-3 py-2"
    />
  );
}

function Num(props: React.ComponentProps<'input'>) {
  return (
    <input
      {...props}
      type="number"
      className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 tabular w-full rounded-xl border border-line px-3 py-2"
    />
  );
}

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
}) {
  return (
    <div>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 h-5 w-5 rounded"
        />
        <span className="font-bold">{label}</span>
      </label>
      {hint ? (
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}
