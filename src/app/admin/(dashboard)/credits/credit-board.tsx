'use client';

import { useActionState, useState } from 'react';

import { adjustAction } from './actions';
import type { LedgerRow } from './page';
import { Button, Card } from '@/components/ui';

const TYPE_LABELS: Record<string, string> = {
  earn: '抽獎進帳',
  spend: '結帳折抵',
  expire: '到期歸零',
  adjust: '人工調整',
};

export function CreditBoard({
  ledger,
  query,
  matchedUsers,
  warnDays,
  summary,
}: {
  ledger: LedgerRow[];
  query: string;
  matchedUsers: {
    id: string;
    display_name: string | null;
    wallet_code: string;
    balance: number;
  }[];
  warnDays: number;
  summary: {
    outstanding: number;
    outstandingPeople: number;
    expiringSoon: number;
    expiringSoonPeople: number;
    expiredThisMonth: number;
    integrityBreaches: number;
  };
}) {
  const [adjusting, setAdjusting] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-black">點數管理</h1>
        <Button
          type="button"
          className="sm:w-auto sm:px-5"
          size="sm"
          onClick={() => setAdjusting((v) => !v)}
        >
          {adjusting ? '收起' : '人工調整'}
        </Button>
      </div>

      {summary.integrityBreaches > 0 ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-bad">
          餘額一致性檢查失敗：{summary.integrityBreaches} 個帳戶的餘額與
          流水帳對不上。這代表有人繞過流水帳直接改了餘額，那筆錢查不出去向。
          請立即暫停活動並聯繫工程人員。
        </p>
      ) : null}

      {adjusting ? <AdjustForm /> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="流通中（負債）"
          value={summary.outstanding}
          note={`${summary.outstandingPeople} 人持有`}
        />
        <Tile
          label={`${warnDays} 天內到期`}
          value={summary.expiringSoon}
          note={`${summary.expiringSoonPeople} 人`}
          highlight
        />
        <Tile label="本月到期歸零" value={summary.expiredThisMonth} />
        <Tile label="流水筆數" value={ledger.length} note="最近 100 筆" />
      </div>

      <Card>
        <p className="text-sm leading-relaxed text-ink-soft">
          「{warnDays} 天內到期」的名單是整個後台變現能力最強的東西。
          拿去 LINE 推播「你的點數再 {warnDays} 天就要歸零」，
          這一則訊息對回訪率的貢獻比抽獎本身還大。
        </p>
      </Card>

      {/*
        查單一客人的紀錄。客訴處理時這是最常用的功能：
        「某位客人說他的點數不見了」要能立刻把他的完整進出調出來。
      */}
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="block flex-1">
            <span className="text-sm font-bold text-ink-soft">
              查客人的點數紀錄
            </span>
            <input
              name="q"
              defaultValue={query}
              placeholder="會員碼或姓名"
              className="mt-1 w-full rounded-xl border border-line px-3 py-2 transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
            />
          </label>
          <button
            type="submit"
            className="cursor-pointer rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-(--color-brand-on) transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
          >
            查詢
          </button>
          {query ? (
            <a
              href="/admin/credits"
              className="cursor-pointer rounded-xl border border-line px-5 py-2.5 text-sm font-bold transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
            >
              清除
            </a>
          ) : null}
        </form>

        {query ? (
          matchedUsers.length === 0 ? (
            <p className="mt-4 text-sm text-bad">
              查不到符合「{query}」的客人
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {matchedUsers.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between rounded-xl bg-brand-50 px-4 py-2 text-sm"
                >
                  <span>
                    <strong>{u.display_name ?? '（無名）'}</strong>
                    <span className="ml-2 font-mono text-xs text-ink-faint">
                      {u.wallet_code}
                    </span>
                  </span>
                  <span className="tabular font-bold">目前 {u.balance} 元</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-bold text-ink-soft">
          {query ? `「${query}」的流水帳` : '流水帳'}
        </h2>

        {/* 手機：卡片。表格橫向捲動會讓「金額」跟「異動後」看不到 */}
        <ul className="space-y-2 md:hidden">
          {ledger.map((row) => (
            <li
              key={row.id}
              className="rounded-card border border-line bg-raised p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold">
                    {row.users?.display_name ?? '—'}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-ink-faint">
                    {row.users?.wallet_code}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`tabular text-lg font-bold ${
                      row.amount > 0 ? 'text-good' : 'text-ink'
                    }`}
                  >
                    {row.amount > 0 ? '+' : ''}
                    {row.amount}
                  </p>
                  <p className="tabular text-xs text-ink-faint">
                    餘 {row.balance_after}
                  </p>
                </div>
              </div>

              <p className="mt-2 text-xs text-ink-soft">
                {TYPE_LABELS[row.type] ?? row.type}
                {' ‧ '}
                {new Date(row.created_at).toLocaleString('zh-TW', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {row.staff?.name ? ` ‧ ${row.staff.name}` : ''}
                {row.note ? ` ‧ ${row.note}` : ''}
              </p>
            </li>
          ))}
          {ledger.length === 0 ? (
            <li className="rounded-card border border-line bg-raised py-10 text-center text-sm text-ink-soft">
              {query ? '這位客人還沒有任何紀錄' : '還沒有任何流水紀錄'}
            </li>
          ) : null}
        </ul>

        <div className="hidden overflow-x-auto rounded-card border border-line bg-raised md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-ink-soft">
              <tr>
                <th className="px-4 py-3">時間</th>
                <th className="px-3 py-3">會員</th>
                <th className="px-3 py-3">類型</th>
                <th className="px-3 py-3 text-right">金額</th>
                <th className="px-3 py-3 text-right">異動後</th>
                <th className="px-3 py-3">店員 / 備註</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id} className="border-b border-line/60">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-faint">
                    {new Date(row.created_at).toLocaleString('zh-TW', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.users?.display_name ?? '—'}
                    <span className="ml-1 font-mono text-xs text-ink-faint">
                      {row.users?.wallet_code}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {TYPE_LABELS[row.type] ?? row.type}
                  </td>
                  <td
                    className={`tabular px-3 py-2.5 text-right font-bold ${
                      row.amount > 0 ? 'text-good' : 'text-ink'
                    }`}
                  >
                    {row.amount > 0 ? '+' : ''}
                    {row.amount}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-soft">
                    {row.balance_after}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-faint">
                    {row.staff?.name ?? ''}
                    {row.note ? ` ${row.note}` : ''}
                  </td>
                </tr>
              ))}
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-ink-soft">
                    還沒有任何流水紀錄
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  highlight,
}: {
  label: string;
  value: number;
  note?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line bg-raised p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p
        className={`tabular mt-1 text-2xl font-black ${
          highlight ? 'text-brand-600' : ''
        }`}
      >
        {value}
        <span className="ml-1 text-sm font-bold text-ink-soft">元</span>
      </p>
      {note ? <p className="mt-1 text-xs text-ink-faint">{note}</p> : null}
    </div>
  );
}

function AdjustForm() {
  const [state, action, pending] = useActionState(adjustAction, null);
  const needsConfirm = state && 'needsConfirm' in state && state.needsConfirm;

  return (
    <Card>
      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-bold text-ink-soft">會員碼</span>
            <input
              name="walletCode"
              required
              autoCapitalize="characters"
              className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 mt-1 w-full rounded-xl border border-line px-3 py-2 uppercase"
            />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-ink-soft">方向</span>
            <select
              name="direction"
              className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 mt-1 w-full rounded-xl border border-line px-3 py-2"
            >
              <option value="add">增加</option>
              <option value="subtract">扣除</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-bold text-ink-soft">金額（元）</span>
          <input
            name="amount"
            type="number"
            min={1}
            required
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 tabular mt-1 w-full rounded-xl border border-line px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-ink-soft">
            原因（必填，會寫進流水帳）
          </span>
          <input
            name="note"
            required
            placeholder="店員誤扣，補回"
            className="transition-colors focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 mt-1 w-full rounded-xl border border-line px-3 py-2"
          />
        </label>

        <input
          type="hidden"
          name="confirmed"
          value={needsConfirm ? 'true' : 'false'}
        />

        {state && 'error' in state && state.error ? (
          <p
            className={`rounded-xl px-4 py-3 text-sm ${
              needsConfirm ? 'bg-amber-50 text-warn' : 'bg-red-50 text-bad'
            }`}
          >
            {state.error}
          </p>
        ) : null}

        {state && 'saved' in state && state.saved ? (
          <p className="rounded-xl bg-green-50 px-4 py-3 text-sm text-good">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending ? '處理中⋯' : needsConfirm ? '確認調整' : '調整'}
        </Button>

        <p className="text-xs leading-relaxed text-ink-faint">
          調整一律走跟店員端同一套資料庫函式，保證流水帳一定被寫入。
          後台不會、也不能直接改餘額數字。
        </p>
      </form>
    </Card>
  );
}
