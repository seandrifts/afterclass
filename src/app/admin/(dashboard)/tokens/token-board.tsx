'use client';

import { useActionState, useState } from 'react';

import { activateAction, createBatchAction } from './actions';
import type { BatchRow } from './page';
import { Button, Card } from '@/components/ui';

export function TokenBoard({
  batches,
  validDays,
}: {
  batches: BatchRow[];
  validDays: number;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-black">序號管理</h1>
        <Button
          type="button"
          className="sm:w-auto sm:px-5"
          size="sm"
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? '收起' : '產生新批次'}
        </Button>
      </div>

      {creating ? <CreateForm validDays={validDays} /> : null}

      {batches.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-ink-soft">
            還沒有任何批次。建議第一批先產生 200 組，跑一週看數據再調整。
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {batches.map((b) => (
            <BatchCard key={b.id} batch={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateForm({ validDays }: { validDays: number }) {
  const [state, action, pending] = useActionState(createBatchAction, null);

  return (
    <Card>
      <form action={action} className="space-y-4">
        <label className="block">
          <span className="text-sm font-bold text-ink-soft">批次名稱</span>
          <input
            name="name"
            required
            placeholder="2026-08 第一批"
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 mt-1 w-full rounded-xl border border-line px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-ink-soft">數量</span>
          <input
            name="quantity"
            type="number"
            min={1}
            max={5000}
            defaultValue={200}
            required
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 mt-1 w-full rounded-xl border border-line px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-ink-soft">備註</span>
          <input
            name="note"
            placeholder="印在名片卡"
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 mt-1 w-full rounded-xl border border-line px-3 py-2"
          />
        </label>

        <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-ink-soft">
          序號會全部產生為「未啟用」，另外按啟用才能使用。
          有效期 {validDays} 天。
          分批啟用的用意是把整疊卡被偷的損失上限，
          控制在「已啟用未使用」的數量。
        </p>

        {state && 'error' in state && state.error ? (
          <p className="text-sm font-medium text-bad">{state.error}</p>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending ? '產生中⋯' : '產生'}
        </Button>
      </form>
    </Card>
  );
}

function BatchCard({ batch }: { batch: BatchRow }) {
  const [state, action, pending] = useActionState(activateAction, null);
  const used = batch.counts.drawn + batch.counts.claimed;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">{batch.name}</h2>
        <span className="text-xs text-ink-faint">
          {new Date(batch.created_at).toLocaleDateString('zh-TW')}
          {batch.note ? ` ‧ ${batch.note}` : ''}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell label="總數" value={batch.quantity} />
        <Cell label="未啟用" value={batch.counts.inactive} />
        <Cell label="可用" value={batch.counts.active} highlight />
        <Cell label="已使用" value={used} />
      </dl>

      <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="batchId" value={batch.id} />
        <label className="block">
          <span className="text-xs text-ink-soft">一次啟用</span>
          <input
            name="count"
            type="number"
            min={1}
            defaultValue={100}
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 tabular mt-1 w-24 rounded-xl border border-line px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={pending || batch.counts.inactive === 0}
          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-(--color-brand-on) disabled:opacity-40"
        >
          {pending ? '啟用中⋯' : '啟用'}
        </button>

        <a
          href={`/api/admin/tokens/${batch.id}/print`}
          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded-xl border border-line px-5 py-2.5 text-sm font-bold"
        >
          下載列印清單
        </a>
      </form>

      {state && 'error' in state && state.error ? (
        <p className="mt-2 text-sm text-bad">{state.error}</p>
      ) : null}
      {state && 'activated' in state && state.activated ? (
        <p className="mt-2 text-sm text-good">
          已啟用 {state.activated} 組
        </p>
      ) : null}
    </Card>
  );
}

function Cell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd
        className={`tabular mt-0.5 text-xl font-black ${
          highlight ? 'text-brand-600' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
