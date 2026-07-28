'use client';

import { useActionState, useState } from 'react';

import {
  runExpiryPushAction,
  testPushAction,
  togglePushAction,
} from './actions';
import { Button, Card } from '@/components/ui';
import type { Settings } from '@/lib/types';

interface Recent {
  id: string;
  type: string;
  status: string;
  error: string | null;
  created_at: string;
  detail: { balance: number; days: number } | null;
  users: { display_name: string | null } | null;
}

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  sent: { text: '已送出', className: 'text-good' },
  blocked: { text: '推不到', className: 'text-warn' },
  failed: { text: '失敗', className: 'text-bad' },
};

export function PushBoard({
  settings,
  hasToken,
  quota,
  pendingCount,
  pendingSample,
  reachableCount,
  unreachableCount,
  preview,
  recent,
}: {
  settings: Settings;
  hasToken: boolean;
  quota: { limit: number | null; used: number } | null;
  pendingCount: number;
  pendingSample: { name: string; balance: number; days: number }[];
  reachableCount: number;
  unreachableCount: number;
  preview: string;
  recent: Recent[];
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-black">LINE 推播</h1>

      {!hasToken ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-bad">
          尚未設定 <code>LINE_MESSAGING_TOKEN</code>，推播功能無法運作。
          請到 Vercel 的環境變數補上官方帳號的 Channel access token。
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="待推送" value={pendingCount} unit="人" highlight />
        <Tile label="可推播好友" value={reachableCount} unit="人" />
        <Tile label="推不到" value={unreachableCount} unit="人" />
        <Tile
          label="本月已用"
          value={quota?.used ?? 0}
          unit={quota?.limit ? `/ ${quota.limit} 則` : '則'}
        />
      </div>

      <Toggles settings={settings} />

      <Card>
        <h2 className="text-sm font-bold text-ink-soft">訊息預覽</h2>
        <p className="mt-1 text-xs text-ink-faint">
          用第一位待推送對象的真實數字產生，客人收到的就是這個內容
        </p>
        <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-[#8CABD8] p-4 text-sm leading-relaxed text-ink">
          <span className="block rounded-2xl bg-white p-4">{preview}</span>
        </pre>
      </Card>

      <PendingList
        count={pendingCount}
        sample={pendingSample}
        warnDays={settings.expire_warn_days}
        enabled={settings.push_enabled && settings.push_expiry_enabled && hasToken}
      />

      <TestPush />

      <Card>
        <h2 className="text-sm font-bold text-ink-soft">最近推播紀錄</h2>
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">
            還沒有任何推播紀錄
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {recent.map((r) => {
              const s = STATUS_LABELS[r.status] ?? {
                text: r.status,
                className: '',
              };
              return (
                <li key={r.id} className="flex justify-between py-2">
                  <span>
                    {r.users?.display_name ?? '會員'}
                    {r.detail ? (
                      <span className="ml-2 text-xs text-ink-faint">
                        餘額 {r.detail.balance} 元 / 剩 {r.detail.days} 天
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right">
                    <span className={`font-medium ${s.className}`}>
                      {s.text}
                    </span>
                    <span className="ml-2 text-xs text-ink-faint">
                      {new Date(r.created_at).toLocaleString('zh-TW', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-bold text-ink-soft">運作方式</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>
            · 每日凌晨 4 點自動執行，找出 {settings.expire_warn_days}{' '}
            天內到期且還有餘額的客人
          </li>
          <li>
            · <strong>同一個到期日只會推一次</strong>
            ，不會連續幾天每天煩客人
          </li>
          <li>
            · 客人來店消費後到期日往後滾，下個週期到期前會再收到一次
          </li>
          <li>
            · 推播被拒（封鎖或沒加好友）會標記起來不再重試，不浪費額度
          </li>
          <li>· 沒有加官方帳號好友的客人推不到，登入不等於加好友</li>
        </ul>
      </Card>
    </div>
  );
}

function Toggles({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState(togglePushAction, null);

  return (
    <Card>
      <div className="space-y-4">
        <form action={action} className="flex items-center justify-between">
          <input type="hidden" name="field" value="push_enabled" />
          <input
            type="hidden"
            name="value"
            value={String(!settings.push_enabled)}
          />
          <div>
            <p className="font-bold">推播總開關</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              關閉時排程照跑但不會送出任何訊息
            </p>
          </div>
          <button
            type="submit"
            disabled={pending}
            className={`min-h-10 rounded-xl px-5 text-sm font-bold ${
              settings.push_enabled
                ? 'bg-good text-white'
                : 'border border-line bg-raised text-ink-soft'
            }`}
          >
            {settings.push_enabled ? '已開啟' : '已關閉'}
          </button>
        </form>

        <form action={action} className="flex items-center justify-between">
          <input type="hidden" name="field" value="push_expiry_enabled" />
          <input
            type="hidden"
            name="value"
            value={String(!settings.push_expiry_enabled)}
          />
          <div>
            <p className="font-bold">到期提醒</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              提前天數在「設定」頁調整，目前 {settings.expire_warn_days} 天
            </p>
          </div>
          <button
            type="submit"
            disabled={pending}
            className={`min-h-10 rounded-xl px-5 text-sm font-bold ${
              settings.push_expiry_enabled
                ? 'bg-good text-white'
                : 'border border-line bg-raised text-ink-soft'
            }`}
          >
            {settings.push_expiry_enabled ? '已開啟' : '已關閉'}
          </button>
        </form>
      </div>

      {state && 'error' in state && state.error ? (
        <p className="mt-3 text-sm text-bad">{state.error}</p>
      ) : null}
    </Card>
  );
}

function PendingList({
  count,
  sample,
  warnDays,
  enabled,
}: {
  count: number;
  sample: { name: string; balance: number; days: number }[];
  warnDays: number;
  enabled: boolean;
}) {
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof runExpiryPushAction>
  > | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setSummary(await runExpiryPushAction());
    setBusy(false);
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink-soft">
          {warnDays} 天內到期且尚未通知
        </h2>
        <span className="tabular text-2xl font-black text-brand-600">
          {count}
        </span>
      </div>

      {sample.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-ink-soft">
          {sample.map((s, i) => (
            <li key={i} className="flex justify-between">
              <span>{s.name}</span>
              <span className="tabular text-xs">
                {s.balance} 元 · 剩 {s.days} 天
              </span>
            </li>
          ))}
          {count > sample.length ? (
            <li className="text-xs text-ink-faint">
              還有 {count - sample.length} 人⋯
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-ink-soft">
          目前沒有需要提醒的人
        </p>
      )}

      {count > 0 ? (
        <div className="mt-4">
          <Button onClick={run} disabled={busy || !enabled}>
            {busy ? '推送中⋯' : `立即推送給這 ${count} 人`}
          </Button>
          {!enabled ? (
            <p className="mt-2 text-center text-xs text-ink-faint">
              推播開關未開啟或缺少 token
            </p>
          ) : (
            <p className="mt-2 text-center text-xs text-ink-faint">
              平常會由每日排程自動執行，這顆是要馬上推的時候用
            </p>
          )}
        </div>
      ) : null}

      {summary ? (
        <p className="mt-3 rounded-xl bg-brand-50 px-4 py-3 text-sm">
          {summary.skippedReason
            ? `未執行：${summary.skippedReason}`
            : `嘗試 ${summary.attempted} 人，成功 ${summary.sent}，推不到 ${summary.unreachable}，失敗 ${summary.failed}`}
        </p>
      ) : null}
    </Card>
  );
}

function TestPush() {
  const [state, action, pending] = useActionState(testPushAction, null);

  return (
    <Card>
      <h2 className="text-sm font-bold text-ink-soft">試推</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
        正式對客人推播之前，先推給自己看一次。後台這裡的預覽是純文字，
        實際在 LINE 裡的斷行與連結長相不一樣。試推不會寫進紀錄，
        也不影響防重複判斷。
      </p>

      <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block flex-1">
          <span className="text-xs text-ink-soft">會員碼</span>
          <input
            name="walletCode"
            required
            autoCapitalize="characters"
            placeholder="你自己的錢包碼"
            className="mt-1 w-full rounded-xl border border-line px-3 py-2 uppercase"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl border border-line px-5 py-2.5 text-sm font-bold"
        >
          {pending ? '推送中⋯' : '試推'}
        </button>
      </form>

      {state && 'error' in state && state.error ? (
        <p className="mt-3 text-sm text-bad">{state.error}</p>
      ) : null}
      {state && 'saved' in state && state.saved ? (
        <p className="mt-3 text-sm text-good">{state.message}</p>
      ) : null}
    </Card>
  );
}

function Tile({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: number;
  unit: string;
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
        <span className="ml-1 text-sm font-bold text-ink-soft">{unit}</span>
      </p>
    </div>
  );
}
