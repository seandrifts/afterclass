'use client';

import { useActionState, useState } from 'react';

import { activateAction, createBatchAction } from './actions';
import { BluetoothPrint } from './bluetooth-print';
import type { BatchRow } from './page';
import { Button, Card } from '@/components/ui';
import { formatDate } from '@/lib/time';

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
          {formatDate(batch.created_at)}
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
          A4 列印清單
        </a>
      </form>

      {/*
        58mm 熱感紙。

        分段印是為了配合出單機的紙卷：一卷印不完 200 張，中途換紙或
        卡紙時也只要從斷掉的那一張接著印，不用整批重來。

        張數是這個批次裡固定的順序，不會因為有卡被抽掉而往前遞補，
        所以「上次印到第 80 張，這次從 81 開始」永遠對得上。範圍內
        已經用過的卡會自動略過。

        用一般的 GET 表單而不是 server action：按下去瀏覽器直接下載
        檔案，在 iPad 上會存進「檔案」。
      */}
      <form
        method="get"
        action={`/api/admin/tokens/${batch.id}/print`}
        className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"
      >
        <input type="hidden" name="paper" value="58" />
        <label className="block">
          <span className="text-xs text-ink-soft">從第幾張</span>
          <input
            name="from"
            type="number"
            inputMode="numeric"
            min={1}
            max={batch.quantity}
            // 接著上次印到的地方。全部印完了就回到第 1 張
            defaultValue={
              batch.lastPrinted && batch.lastPrinted.last < batch.quantity
                ? batch.lastPrinted.last + 1
                : 1
            }
            required
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 tabular mt-1 w-24 rounded-xl border border-line px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-xs text-ink-soft">到第幾張</span>
          <input
            name="to"
            type="number"
            inputMode="numeric"
            min={1}
            max={batch.quantity}
            defaultValue={batch.quantity}
            required
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 tabular mt-1 w-24 rounded-xl border border-line px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded-xl border border-line px-5 py-2.5 text-sm font-bold"
        >
          下載 58mm 熱感紙 PDF
        </button>

        {/*
          不經過列印 App，由瀏覽器用藍牙直接把文字指令送給出單機。
          App 印 PDF 會中途斷線時用這個（原因見 bluetooth-print.tsx）。
        */}
        <BluetoothPrint
          batchId={batch.id}
          className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded-xl border border-line px-5 py-2.5 text-sm font-bold"
        />
        <span className="basis-full text-xs text-ink-faint">
          這個批次共 {batch.quantity} 張。已經用過的卡不會印。
          {batch.lastPrinted
            ? ` 上次藍牙列印：第 ${batch.lastPrinted.range.replace('-', ' 到 ')} 張（${formatDate(batch.lastPrinted.at)}）${
                batch.lastPrinted.last < batch.quantity
                  ? `，下一張是第 ${batch.lastPrinted.last + 1} 張。`
                  : '，已印到最後一張。'
              }`
            : ''}
        </span>
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
