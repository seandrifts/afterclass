'use client';

import { useActionState, useEffect, useState } from 'react';

import {
  issueTokenAction,
  logoutAction,
  lookupAction,
  redeemAction,
  redeemCouponAction,
  undoAction,
} from './actions';
import {
  IconCamera,
  IconCheck,
  IconUndo,
} from '@/components/icons';
import { ScanInput } from '@/components/qr-scanner';
import { Button, Card } from '@/components/ui';

type Tab = 'redeem' | 'coupon' | 'issue';

interface LookedUpUser {
  id: string;
  name: string;
  balance: number;
  maxRedeem: number;
  minBalance: number;
}

export function StaffPanel({
  staffName,
  isOwner,
  stats,
}: {
  staffName: string;
  isOwner: boolean;
  stats: {
    issued: number;
    drawn: number;
    redeemedCount: number;
    redeemedTotal: number;
  };
}) {
  const [tab, setTab] = useState<Tab>('redeem');

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 py-5">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-soft">店員</p>
          <h1 className="text-xl font-bold">{staffName}</h1>
        </div>
        <div className="flex items-center gap-3">
          {isOwner ? (
            <a href="/admin" className="text-sm text-brand-600 underline">
              後台
            </a>
          ) : null}
          <form action={logoutAction}>
            <button type="submit" className="cursor-pointer rounded text-sm text-ink-faint underline transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300">
              登出
            </button>
          </form>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label="今日發放" value={String(stats.issued)} />
        <Stat label="今日抽獎" value={String(stats.drawn)} />
        <Stat
          label="今日折抵"
          value={`${stats.redeemedTotal}`}
          suffix={`元 / ${stats.redeemedCount} 筆`}
        />
      </div>

      <nav className="mb-5 grid grid-cols-3 gap-2">
        <TabButton active={tab === 'redeem'} onClick={() => setTab('redeem')}>
          折抵點數
        </TabButton>
        <TabButton active={tab === 'coupon'} onClick={() => setTab('coupon')}>
          核銷券
        </TabButton>
        <TabButton active={tab === 'issue'} onClick={() => setTab('issue')}>
          發抽獎
        </TabButton>
      </nav>

      {tab === 'redeem' ? <RedeemTab /> : null}
      {tab === 'coupon' ? <CouponTab /> : null}
      {tab === 'issue' ? <IssueTab /> : null}
    </main>
  );
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-raised px-2 py-3 text-center">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="tabular mt-1 text-xl font-black">{value}</p>
      {suffix ? <p className="text-[11px] text-ink-faint">{suffix}</p> : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-12 cursor-pointer rounded-xl text-base font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${
        active
          ? 'bg-brand-500 text-white'
          : 'border border-line bg-raised text-ink-soft'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------
// 折抵
// ---------------------------------------------------------------

function RedeemTab() {
  const [lookup, lookupFn, looking] = useActionState(lookupAction, null);
  const [redeem, redeemFn, redeeming] = useActionState(redeemAction, null);
  const [undo, undoFn, undoing] = useActionState(undoAction, null);

  const user = lookup && 'user' in lookup ? (lookup.user as LookedUpUser) : null;
  const success = redeem && 'success' in redeem ? redeem.success : null;

  if (success && !undo?.undone) {
    return (
      <div className="rounded-card bg-good p-8 text-center text-white">
        <IconCheck className="mx-auto size-16" />
        <p className="mt-4 text-3xl font-black">已折抵 {success.amount} 元</p>
        <p className="mt-2 text-xl">剩餘 {success.newBalance} 元</p>
        {success.replayed ? (
          <p className="mt-3 text-sm opacity-80">
            （這筆先前已經扣過，沒有重複扣款）
          </p>
        ) : null}

        <div className="mt-8 space-y-3">
          <form action={undoFn}>
            <input type="hidden" name="txnId" value={success.txnId} />
            <button
              type="submit"
              disabled={undoing}
              className="min-h-12 w-full rounded-xl border-2 border-white/60 text-base font-bold"
            >
              {undoing ? '撤銷中⋯' : '扣錯了，撤銷這筆'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-14 w-full cursor-pointer rounded-xl bg-white text-lg font-black text-good transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
          >
            下一位
          </button>
        </div>

        {undo?.error ? (
          <p className="mt-3 text-sm font-medium">{undo.error}</p>
        ) : null}
      </div>
    );
  }

  if (undo?.undone) {
    return (
      <div className="rounded-card bg-warn p-8 text-center text-white">
        <IconUndo className="mx-auto size-14" />
        <p className="mt-4 text-2xl font-black">已撤銷，金額退回客人帳戶</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 min-h-14 w-full cursor-pointer rounded-xl bg-white text-lg font-black text-warn transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
        >
          回到折抵
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <form action={lookupFn} className="space-y-4">
        <Card>
          <ScanInput
            name="walletCode"
            label="會員碼"
            placeholder="掃描或輸入"
          />
        </Card>

        {lookup && 'error' in lookup && lookup.error ? (
          <p role="alert" className="text-center font-medium text-bad">
            {lookup.error}
          </p>
        ) : null}

        <Button type="submit" size="lg" loading={looking}>
          {looking ? '查詢中' : '查詢餘額'}
        </Button>
      </form>
    );
  }

  // 用 key 讓每查詢一位新客人就重建元件，金額與冪等鍵自然回到初始值。
  // 這比在 effect 裡 setState 乾淨，也不會有串場的殘留狀態
  return (
    <RedeemForm
      key={user.id}
      user={user}
      action={redeemFn}
      pending={redeeming}
      error={redeem && 'error' in redeem ? redeem.error : null}
    />
  );
}

function RedeemForm({
  user,
  action,
  pending,
  error,
}: {
  user: LookedUpUser;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: string | null;
}) {
  const usable = Math.min(user.balance, user.maxRedeem);
  const quick = [10, 20, 30].filter((v) => v <= usable);

  const [amount, setAmount] = useState(usable);
  const [confirmRepeat, setConfirmRepeat] = useState(false);

  // 冪等鍵在這筆折抵開始時就固定住。重送同一個 key 不會重複扣款，
  // 店員在收訊差的環境按了確認沒反應又按一次時就靠這個
  const [idemKey] = useState(() => crypto.randomUUID());

  return (
    <form action={action} className="space-y-4">
      <Card className="text-center">
        <p className="text-lg font-bold">{user.name}</p>
        <p className="tabular mt-3 text-5xl font-black text-brand-600">
          {user.balance}
        </p>
        <p className="mt-1 text-ink-soft">元可折抵</p>
        <p className="mt-2 text-sm text-ink-faint">
          單次上限 {user.maxRedeem} 元
        </p>
      </Card>

      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="idempotencyKey" value={idemKey} />
      <input type="hidden" name="amount" value={amount} />

      <Card>
        <p className="text-sm font-bold text-ink-soft">本次折抵</p>
        <p className="tabular my-3 text-center text-5xl font-black">
          {amount}
          <span className="ml-2 text-2xl font-bold text-ink-soft">元</span>
        </p>

        <div className="grid grid-cols-4 gap-2">
          {quick.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(v)}
              className={`min-h-14 cursor-pointer rounded-xl border-2 text-lg font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${
                amount === v
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-line bg-raised'
              }`}
            >
              {v}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAmount(usable)}
            className={`min-h-14 cursor-pointer rounded-xl border-2 text-lg font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${
              amount === usable
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-line bg-raised'
            }`}
          >
            全部
          </button>
        </div>
      </Card>

      {error ? (
        <p className="text-center font-medium text-bad">{error}</p>
      ) : null}

      {/* 誤觸的代價是客人的錢，所以確認鍵跟其他鍵拉開距離 */}
      <div className="pt-2">
        <Button
          type={confirmRepeat ? 'submit' : 'button'}
          size="lg"
          disabled={pending || amount <= 0}
          onClick={confirmRepeat ? undefined : () => setConfirmRepeat(true)}
        >
          {pending
            ? '處理中⋯'
            : confirmRepeat
              ? `確定要折抵 ${amount} 元`
              : `折抵 ${amount} 元`}
        </Button>
        {confirmRepeat && !pending ? (
          <button
            type="button"
            onClick={() => setConfirmRepeat(false)}
            className="mt-3 w-full cursor-pointer rounded text-center text-sm text-ink-faint underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
          >
            取消
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------
// 核銷實物券
// ---------------------------------------------------------------

function CouponTab() {
  const [state, action, pending] = useActionState(redeemCouponAction, null);
  const success = state && 'couponSuccess' in state ? state.couponSuccess : null;

  if (success) {
    return (
      <div className="rounded-card bg-good p-8 text-center text-white">
        <IconCheck className="mx-auto size-16" />
        <p className="mt-4 text-3xl font-black">{success.prizeName}</p>
        <p className="mt-2 text-lg">核銷成功</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 min-h-14 w-full rounded-xl bg-white text-lg font-black text-good"
        >
          下一位
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Card>
        <ScanInput
          name="redeemCode"
          label="核銷碼（6 位數字）"
          placeholder="掃描或輸入"
          numeric
          maxLength={6}
        />
      </Card>

      {state && 'error' in state && state.error ? (
        <p role="alert" className="text-center font-medium text-bad">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" loading={pending}>
        {pending ? '核銷中' : '核銷'}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------
// 發放動態 QR
// ---------------------------------------------------------------

function IssueTab() {
  const [issued, setIssued] = useState<{ code: string; svg: string } | null>(
    null,
  );
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 倒數只是給店員看的提示，真正的到期判定在伺服器端。
  // setState 放在 interval 的 callback 裡而不是 effect 本體，
  // 前者是允許的，後者會造成串聯重繪
  useEffect(() => {
    if (!issued) return;
    const timer = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [issued]);

  async function issue() {
    setBusy(true);
    setError(null);
    const result = await issueTokenAction();
    setBusy(false);

    if ('error' in result) {
      setError(result.error);
      return;
    }

    setIssued({ code: result.code, svg: result.svg });
    setLeft(result.ttl);
  }

  if (issued) {
    // 過期後不自動消失，改成顯示已失效。店員看到 QR 突然不見會困惑，
    // 明確告訴他要重新產生比較好
    return (
      <Card className="text-center">
        {left > 0 ? (
          <>
            <p className="text-sm text-ink-soft">請客人掃描</p>
            <div
              className="mx-auto mt-4 w-fit rounded-2xl bg-white p-2"
              dangerouslySetInnerHTML={{ __html: issued.svg }}
            />
            <p className="mt-4 text-2xl font-black text-brand-600">
              {left} 秒後失效
            </p>
            <p className="mt-1 text-sm text-ink-faint">只能被掃描一次</p>
          </>
        ) : (
          <>
            <p className="py-10 text-xl font-bold text-ink-faint">
              這組 QR 已失效
            </p>
            <Button type="button" onClick={issue} disabled={busy}>
              {busy ? '產生中⋯' : '重新產生'}
            </Button>
          </>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm leading-relaxed text-ink-soft">
          紙卡發完、外帶自取或客訴補償時使用。產生的 QR 只能用一次，
          過期就要重新產生。
        </p>
      </Card>
      {error ? (
        <p className="text-center font-medium text-bad">{error}</p>
      ) : null}
      <Button size="lg" onClick={issue} loading={busy}>
        <IconCamera className="size-5" />
        {busy ? '產生中' : '產生抽獎 QR'}
      </Button>
    </div>
  );
}
