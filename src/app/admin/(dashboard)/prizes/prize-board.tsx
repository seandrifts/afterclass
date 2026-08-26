'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';

import {
  savePrizeAction,
  saveWeightsAction,
  togglePrizeAction,
} from './actions';
import { Button, Card } from '@/components/ui';
import type { Prize, PrizeType, Settings } from '@/lib/types';

const TYPE_LABELS: Record<PrizeType, string> = {
  credit: '儲值金',
  item: '實物',
  cash: '現金券',
  free_meal: '免單',
};

/** 預估核銷率。上線兩週後改用報表算出的真實值 */
const REDEMPTION_RATE: Record<PrizeType, number> = {
  credit: 0.8,
  free_meal: 0.9,
  item: 0.5,
  cash: 0.35,
};

export function PrizeBoard({
  prizes,
  settings,
  changes,
}: {
  prizes: Prize[];
  settings: Settings;
  changes: { id: string; created_at: string; after: unknown }[];
}) {
  const [editing, setEditing] = useState<Prize | 'new' | null>(null);

  // 權重改動的即時試算全在前端算，不打 API。只有按儲存才寫 DB，
  // 這樣拖數字的手感才會順
  const [draft, setDraft] = useState<Record<string, number>>({});

  const clearDraft = useCallback(() => setDraft({}), []);
  const closeEditor = useCallback(() => setEditing(null), []);

  const rows = prizes.map((p) => ({
    ...p,
    weight: draft[p.id] ?? p.weight,
  }));

  const active = rows.filter((p) => p.is_active && p.weight > 0);
  const totalWeight = active.reduce((s, p) => s + p.weight, 0);

  // 不包 useMemo。React Compiler 會自動處理記憶化，而手寫的 useMemo
  // 反而會讓它判定「既有的記憶化無法保留」而整個跳過優化
  const calc = computeCost(active, totalWeight);

  const monthly = calc.adjusted * settings.daily_customers * 30;
  const capUsage = settings.monthly_cost_cap
    ? (monthly / settings.monthly_cost_cap) * 100
    : null;

  const dirty = Object.keys(draft).length > 0;

  return (
    <div className="space-y-6">
      {/* 窄螢幕時標題與按鈕堆疊，不然中文標題會被按鈕壓到 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-black">獎項管理</h1>
        <Button
          className="sm:w-auto sm:px-5"
          size="sm"
          onClick={() => setEditing('new')}
          type="button"
        >
          新增獎項
        </Button>
      </div>

      {/*
        手機用卡片，桌機用表格。

        原本讓表格橫向捲動，結果權重、機率、期望成本三欄全在畫面外。
        老闆站在店裡用手機調機率時，最重要的三個數字反而看不到。
      */}
      <ul className="space-y-3 lg:hidden">
        {rows.map((p) => {
          const prob =
            totalWeight > 0 && p.is_active && p.weight > 0
              ? (p.weight / totalWeight) * 100
              : 0;
          const exp = (prob / 100) * p.cost;

          return (
            <li
              key={p.id}
              className={`rounded-card border border-line bg-raised p-4 ${
                p.is_active ? '' : 'opacity-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-bold">
                    <span
                      className="inline-block size-3 shrink-0 rounded-full"
                      style={{ background: p.color ?? '#ccc' }}
                    />
                    <span className="truncate">{p.name}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {TYPE_LABELS[p.type]} ‧ 面額 {p.face_value} ‧ 成本 {p.cost}
                    {p.is_active ? '' : ' ‧ 已停用'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-sm text-brand-600 underline underline-offset-2 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                >
                  編輯
                </button>
              </div>

              <div className="mt-4 flex items-end gap-4">
                <label className="flex-1">
                  <span className="text-xs text-ink-soft">權重</span>
                  <input
                    type="number"
                    min={0}
                    value={p.weight}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [p.id]: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="tabular mt-1 w-full rounded-lg border border-line px-3 py-2 text-right transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                  />
                </label>
                <div className="flex-1 text-right">
                  <p className="text-xs text-ink-soft">機率</p>
                  <p className="tabular text-xl font-black">
                    {prob.toFixed(2)}%
                  </p>
                </div>
                <div className="flex-1 text-right">
                  <p className="text-xs text-ink-soft">期望成本</p>
                  <p className="tabular text-xl font-bold">{exp.toFixed(2)}</p>
                </div>
              </div>
            </li>
          );
        })}

        <li className="rounded-card bg-brand-50 p-4">
          <div className="flex items-center justify-between font-black">
            <span>合計</span>
            <span className="tabular">
              權重 {totalWeight} ‧ 100.00% ‧ {calc.nominal.toFixed(2)}
            </span>
          </div>
        </li>
      </ul>

      <div className="hidden overflow-x-auto rounded-card border border-line bg-raised lg:block">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-ink-soft">
            <tr>
              <th className="px-4 py-3">獎項</th>
              <th className="px-3 py-3">類型</th>
              <th className="px-3 py-3 text-right">面額</th>
              <th className="px-3 py-3 text-right">成本</th>
              <th className="px-3 py-3 text-right">權重</th>
              <th className="px-3 py-3 text-right">機率</th>
              <th className="px-3 py-3 text-right">期望成本</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const prob = totalWeight > 0 && p.is_active && p.weight > 0
                ? (p.weight / totalWeight) * 100
                : 0;
              const exp = (prob / 100) * p.cost;

              return (
                <tr
                  key={p.id}
                  className={`border-b border-line/60 ${
                    p.is_active ? '' : 'opacity-40'
                  }`}
                >
                  <td className="px-4 py-3 font-bold">
                    <span
                      className="mr-2 inline-block h-3 w-3 rounded-full align-middle"
                      style={{ background: p.color ?? '#ccc' }}
                    />
                    {p.name}
                  </td>
                  <td className="px-3 py-3 text-ink-soft">
                    {TYPE_LABELS[p.type]}
                  </td>
                  <td className="tabular px-3 py-3 text-right">
                    {p.face_value}
                  </td>
                  <td className="tabular px-3 py-3 text-right">{p.cost}</td>
                  <td className="px-3 py-3 text-right">
                    <input
                      type="number"
                      min={0}
                      value={p.weight}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [p.id]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="tabular w-20 rounded-lg border border-line px-2 py-1 text-right transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                    />
                  </td>
                  <td className="tabular px-3 py-3 text-right font-bold">
                    {prob.toFixed(2)}%
                  </td>
                  <td className="tabular px-3 py-3 text-right">
                    {exp.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded px-1 text-brand-600 underline underline-offset-2 hover:text-brand-700"
                    >
                      編輯
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr className="bg-brand-50 font-black">
              <td className="px-4 py-3" colSpan={4}>
                合計
              </td>
              <td className="tabular px-3 py-3 text-right">{totalWeight}</td>
              <td className="tabular px-3 py-3 text-right">100.00%</td>
              <td className="tabular px-3 py-3 text-right">
                {calc.nominal.toFixed(2)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {dirty ? (
        <WeightSaver prizes={prizes} draft={draft} onDone={clearDraft} />
      ) : null}

      <CostPanel
        settings={settings}
        calc={calc}
        monthly={monthly}
        capUsage={capUsage}
      />

      <Simulator prizes={active} />

      {editing ? (
        <PrizeEditor
          prize={editing === 'new' ? null : editing}
          onClose={closeEditor}
        />
      ) : null}

      {changes.length > 0 ? (
        <Card>
          <h2 className="text-sm font-bold text-ink-soft">最近異動</h2>
          <ul className="mt-3 space-y-1 text-xs text-ink-faint">
            {changes.map((c) => (
              <li key={c.id}>
                {new Date(c.created_at).toLocaleString('zh-TW')} ‧{' '}
                {summarize(c.after)}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

interface CostBreakdown {
  nominal: number;
  adjusted: number;
  creditPayout: number;
  top: Prize | null;
  topShare: number;
}

/**
 * 成本試算。
 *
 * 名目成本是「假設每個獎項都被兌現」，實際成本還要乘上核銷率。
 * 儲值金的核銷率遠高於折價券，因為客人不會忘記自己帳戶裡有錢。
 */
function computeCost(active: Prize[], totalWeight: number): CostBreakdown {
  if (totalWeight === 0) {
    return {
      nominal: 0,
      adjusted: 0,
      creditPayout: 0,
      top: null,
      topShare: 0,
    };
  }

  let nominal = 0;
  let adjusted = 0;
  let creditPayout = 0;
  let topCost = -1;
  let top: Prize | null = null;

  for (const p of active) {
    const prob = p.weight / totalWeight;
    const cost = prob * p.cost;

    nominal += cost;
    adjusted += cost * REDEMPTION_RATE[p.type];
    if (p.type === 'credit') creditPayout += prob * (p.credit_amount ?? 0);

    if (cost > topCost) {
      topCost = cost;
      top = p;
    }
  }

  return {
    nominal,
    adjusted,
    creditPayout,
    top,
    topShare: nominal > 0 ? topCost / nominal : 0,
  };
}

function CostPanel({
  settings,
  calc,
  monthly,
  capUsage,
}: {
  settings: Settings;
  calc: CostBreakdown;
  monthly: number;
  capUsage: number | null;
}) {
  const share = settings.avg_ticket
    ? (calc.adjusted / settings.avg_ticket) * 100
    : 0;

  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-ink-soft">成本試算</h2>
        <span className="text-xs text-ink-faint">
          基準：客單 {settings.avg_ticket} / 日客 {settings.daily_customers}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric
          label="平均抽到金額"
          value={calc.creditPayout.toFixed(2)}
          unit="元 / 次"
        />
        <Metric
          label="名目期望成本"
          value={calc.nominal.toFixed(2)}
          unit="元 / 客"
        />
        <Metric
          label="核銷率修正後"
          value={calc.adjusted.toFixed(2)}
          unit={`元 / 客（客單 ${share.toFixed(1)}%）`}
          highlight
        />
        <Metric
          label="預估每月成本"
          value={Math.round(monthly).toLocaleString()}
          unit="元"
        />
      </dl>

      {capUsage !== null ? (
        <div className="mt-5">
          <div className="h-3 overflow-hidden rounded-full bg-brand-100">
            <div
              className={`h-full rounded-full ${
                capUsage >= 100 ? 'bg-bad' : 'bg-brand-500'
              }`}
              style={{ width: `${Math.min(100, capUsage)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            佔月上限 {settings.monthly_cost_cap} 元的 {capUsage.toFixed(0)}%
          </p>
        </div>
      ) : null}

      {calc.top && calc.topShare > 0.4 ? (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-warn">
          「{calc.top.name}」佔了總成本的{' '}
          {Math.round(calc.topShare * 100)}%。單一獎項吃掉這麼多成本，
          考慮降低它的權重。
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        核銷率目前用預估值（儲值金 80%、免單 90%、實物 50%、現金券 35%）。
        上線兩週、累積 200 筆以上之後，改用報表算出的真實折抵率，
        整個成本模型才可信。
      </p>
    </Card>
  );
}

function Metric({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd
        className={`tabular mt-1 text-2xl font-black ${
          highlight ? 'text-brand-600' : ''
        }`}
      >
        {value}
      </dd>
      <dd className="text-xs text-ink-faint">{unit}</dd>
    </div>
  );
}

/**
 * 模擬器。
 *
 * 「最壞情況」那一列才是重點。免單這種 0.3% 的獎，平均值不會咬你，
 * 但單月連開三次會。設成本上限要看的是這個數字。
 */
function Simulator({ prizes }: { prizes: Prize[] }) {
  const [result, setResult] = useState<{
    counts: Record<string, number>;
    avg: number;
    worst: number;
  } | null>(null);

  function run() {
    const total = prizes.reduce((s, p) => s + p.weight, 0);
    if (total === 0) return;

    const counts: Record<string, number> = {};
    let sum = 0;

    for (let i = 0; i < 1000; i += 1) {
      const p = roll(prizes, total);
      counts[p.id] = (counts[p.id] ?? 0) + 1;
      sum += p.cost;
    }

    // 跑 100 輪取最高，就是運氣最差的月份會花多少
    let worst = 0;
    for (let round = 0; round < 100; round += 1) {
      let cost = 0;
      for (let i = 0; i < 1000; i += 1) cost += roll(prizes, total).cost;
      worst = Math.max(worst, cost);
    }

    setResult({ counts, avg: sum / 1000, worst: worst / 1000 });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink-soft">模擬器</h2>
        <button
          type="button"
          onClick={run}
          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded-xl border border-line px-4 py-2 text-sm font-bold hover:bg-brand-50"
        >
          模擬 1000 次
        </button>
      </div>

      {result ? (
        <div className="mt-4 space-y-1 text-sm">
          {prizes.map((p) => {
            const hits = result.counts[p.id] ?? 0;
            const totalW = prizes.reduce((s, x) => s + x.weight, 0);
            const expected = (p.weight / totalW) * 100;
            return (
              <div key={p.id} className="flex justify-between">
                <span>{p.name}</span>
                <span className="tabular text-ink-soft">
                  {hits} 次 {((hits / 1000) * 100).toFixed(2)}% （期望{' '}
                  {expected.toFixed(2)}%）
                </span>
              </div>
            );
          })}
          <div className="mt-3 border-t border-line pt-3">
            <p className="tabular">
              平均成本 <strong>{result.avg.toFixed(2)}</strong> 元 / 客
            </p>
            <p className="tabular mt-1 text-bad">
              最壞情況（100 輪取最高）
              <strong className="ml-1">{result.worst.toFixed(2)}</strong> 元 / 客
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              如果最壞情況超過你的承受度，就降低大獎權重或給它設庫存上限。
            </p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function roll(prizes: Prize[], total: number): Prize {
  let r = Math.random() * total;
  for (const p of prizes) {
    r -= p.weight;
    if (r < 0) return p;
  }
  return prizes[prizes.length - 1];
}

/**
 * 權重批次儲存。
 *
 * 改一個權重會影響所有獎項的百分比，所以一起送出一起寫入。
 * 逐個儲存的話，中間狀態的機率分佈會是錯的。
 */
function WeightSaver({
  prizes,
  draft,
  onDone,
}: {
  prizes: Prize[];
  draft: Record<string, number>;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveWeightsAction, null);
  const changed = prizes.filter((p) => draft[p.id] !== undefined);

  useEffect(() => {
    if (state && 'saved' in state && state.saved) onDone();
  }, [state, onDone]);

  const payload = JSON.stringify(
    changed.map((p) => ({ id: p.id, weight: draft[p.id] })),
  );

  return (
    <form
      action={action}
      className="sticky bottom-4 z-10 rounded-card border-2 border-brand-500 bg-raised p-4 shadow-lg"
    >
      <input type="hidden" name="weights" value={payload} />

      <p className="text-sm font-bold">
        {changed.length} 個獎項的權重已改動，尚未儲存
      </p>
      <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
        {changed.map((p) => (
          <li key={p.id}>
            {p.name}：{p.weight} → {draft[p.id]}
          </li>
        ))}
      </ul>

      {state && 'error' in state && state.error ? (
        <p className="mt-2 text-sm text-bad">{state.error}</p>
      ) : null}

      <div className="mt-3 flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded-xl bg-brand-500 px-5 py-2 text-sm font-bold text-(--color-brand-on) hover:bg-brand-600"
        >
          {pending ? '儲存中⋯' : '儲存權重'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded-xl border border-line px-4 py-2 text-sm hover:bg-brand-50"
        >
          放棄變更
        </button>
      </div>
    </form>
  );
}

function PrizeEditor({
  prize,
  onClose,
}: {
  prize: Prize | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(savePrizeAction, null);
  const [type, setType] = useState<PrizeType>(prize?.type ?? 'credit');
  const [toggleState, toggleAction] = useActionState(togglePrizeAction, null);

  // 存檔成功才關閉。這要放在 effect 裡，在 render 期間呼叫 onClose
  // 等於在 render 中更新父層 state，React 會報錯
  useEffect(() => {
    if (state && 'saved' in state && state.saved) onClose();
  }, [state, onClose]);

  const isCredit = type === 'credit';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-card bg-raised p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black">
            {prize ? '編輯獎項' : '新增獎項'}
          </h2>
          <button type="button" onClick={onClose} className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded px-2 py-1 text-ink-faint hover:text-ink">
            關閉
          </button>
        </div>

        <form action={action} className="space-y-4">
          {prize ? <input type="hidden" name="id" value={prize.id} /> : null}

          <Field label="獎項名稱">
            <input
              name="name"
              defaultValue={prize?.name}
              required
              maxLength={40}
              className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
            />
          </Field>

          <Field label="類型">
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as PrizeType)}
              className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>

          {isCredit ? (
            <Field
              label="入帳金額（元）"
              hint="成本自動等於入帳金額。儲值金折抵時直接減少收入，不像實物獎只有食材成本"
            >
              <input
                name="credit_amount"
                type="number"
                min={1}
                defaultValue={prize?.credit_amount ?? 3}
                required
                className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
              />
            </Field>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="感知價值（元）">
                  <input
                    name="face_value"
                    type="number"
                    min={0}
                    defaultValue={prize?.face_value ?? 0}
                    className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                  />
                </Field>
                <Field label="實際成本（元）" hint="只有你看得到">
                  <input
                    name="cost"
                    type="number"
                    min={0}
                    defaultValue={prize?.cost ?? 0}
                    className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="折抵金額">
                  <input
                    name="discount_amt"
                    type="number"
                    min={0}
                    defaultValue={prize?.discount_amt ?? ''}
                    className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                  />
                </Field>
                <Field label="使用門檻">
                  <input
                    name="min_spend"
                    type="number"
                    min={0}
                    defaultValue={prize?.min_spend ?? 0}
                    className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                  />
                </Field>
                <Field label="折抵上限">
                  <input
                    name="max_discount"
                    type="number"
                    min={0}
                    defaultValue={prize?.max_discount ?? ''}
                    className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                  />
                </Field>
              </div>

              <Field label="有效天數" hint="留空則用全域預設">
                <input
                  name="valid_days"
                  type="number"
                  min={1}
                  defaultValue={prize?.valid_days ?? ''}
                  className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
                />
              </Field>
            </>
          )}

          {/* credit 的這兩個欄位由後端覆寫，但表單仍需送出以通過 schema */}
          {isCredit ? (
            <>
              <input type="hidden" name="face_value" value={0} />
              <input type="hidden" name="cost" value={0} />
              <input type="hidden" name="min_spend" value={0} />
            </>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="權重">
              <input
                name="weight"
                type="number"
                min={0}
                defaultValue={prize?.weight ?? 0}
                required
                className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
              />
            </Field>
            <Field label="庫存上限" hint="留空為無限">
              <input
                name="stock"
                type="number"
                min={0}
                defaultValue={prize?.stock ?? ''}
                className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="排序">
              <input
                name="sort_order"
                type="number"
                defaultValue={prize?.sort_order ?? 0}
                className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
              />
            </Field>
            <Field label="轉盤顏色">
              <input
                name="color"
                type="color"
                defaultValue={prize?.color ?? '#457B9D'}
                className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 h-10 w-full rounded-xl border border-line"
              />
            </Field>
          </div>

          <Field label="專屬使用條件">
            <input
              name="terms"
              defaultValue={prize?.terms ?? ''}
              maxLength={200}
              className="w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
            />
          </Field>

          {state && 'error' in state && state.error ? (
            <p className="text-sm font-medium text-bad">{state.error}</p>
          ) : null}

          <Button type="submit" disabled={pending}>
            {pending ? '儲存中⋯' : '儲存'}
          </Button>
        </form>

        {prize ? (
          <form action={toggleAction} className="mt-4">
            <input type="hidden" name="id" value={prize.id} />
            <input
              type="hidden"
              name="active"
              value={String(!prize.is_active)}
            />
            <button
              type="submit"
              className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 w-full rounded-xl border border-line py-2 text-sm text-ink-soft hover:bg-brand-50"
            >
              {prize.is_active ? '停用此獎項' : '重新啟用'}
            </button>
            {toggleState && 'error' in toggleState && toggleState.error ? (
              <p className="mt-2 text-sm text-bad">{toggleState.error}</p>
            ) : null}
            <p className="mt-2 text-xs text-ink-faint">
              獎項只能停用不能刪除。已發出的券會參照它做報表分組，
              硬刪會造成報表斷裂。
            </p>
          </form>
        ) : null}
      </div>
    </div>
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
      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </label>
  );
}

function summarize(after: unknown): string {
  if (!after || typeof after !== 'object') return '調整';
  const o = after as Record<string, unknown>;
  if ('is_active' in o) return o.is_active ? '重新啟用獎項' : '停用獎項';
  if ('name' in o) return `調整「${o.name}」（權重 ${o.weight}）`;
  return '調整';
}
