'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import {
  issueTokenAction,
  logoutAction,
  lookupAction,
  redeemAction,
  redeemCouponAction,
  undoAction,
} from './actions';
import {
  IconAlert,
  IconCamera,
  IconCheck,
  IconUndo,
} from '@/components/icons';
import { ScanInput } from '@/components/qr-scanner';
import {
  playErrorSound,
  playRedeemSuccessSound,
  unlockAudio,
} from '@/lib/sound';
import { Button, Card } from '@/components/ui';

type Tab = 'redeem' | 'coupon' | 'issue';

interface LookedUpUser {
  id: string;
  name: string;
  balance: number;
  maxRedeem: number;
  minBalance: number;
  recentRedeem: {
    amount: number;
    minutesAgo: number;
    staffName: string | null;
  } | null;
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
          ? 'bg-brand-500 text-(--color-brand-on)'
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
  const redeemError = redeem && 'error' in redeem ? redeem.error : null;

  /*
    折抵結果的聲音回饋。

    店員在尖峰時段手上在處理食物或找零，眼睛不一定看著螢幕。
    一聲確認音讓他知道扣款成功，不用低頭確認。

    用 ref 記住已經播過的結果，避免 React 重繪時重複發聲。
  */
  const announced = useRef<string | null>(null);

  useEffect(() => {
    const key = success ? `ok:${success.txnId}` : redeemError ? `err:${redeemError}` : null;
    if (!key || announced.current === key) return;

    announced.current = key;
    if (success) playRedeemSuccessSound();
    else playErrorSound();
  }, [success, redeemError]);

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

        <Button
          type="submit"
          size="lg"
          loading={looking}
          onClick={unlockAudio}
        >
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

  // 只留比「全部」小的，等於全部的那顆會跟「全部」重複
  const quick = [5, 10, 20, 30].filter((v) => v < usable);

  /*
    金額用字串存，不用數字。

    店員清空欄位想重打時，數字型別沒有「空」這個狀態，只能塞 0，
    游標後面就一直卡著一個 0，要先刪掉才能打新的。尖峰時段這種
    多餘動作很煩人。
  */
  const [raw, setRaw] = useState(String(usable));
  const amount = raw === '' ? 0 : Number(raw);

  const [confirmRepeat, setConfirmRepeat] = useState(false);

  // 剛折抵過的話，要店員先確認過才解鎖折抵鍵
  const recent = user.recentRedeem;
  const [acknowledged, setAcknowledged] = useState(!recent);

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

      {/*
        剛折抵過就擋一下。最常見的誤扣情境是店員以為上一次沒成功，
        重新查詢又扣一次，客人平白少一筆錢。
      */}
      {recent && !acknowledged ? (
        <div
          role="alert"
          className="rounded-card border-2 border-warn bg-amber-50 p-4 text-center"
        >
          <IconAlert className="mx-auto size-8 text-warn" />
          <p className="mt-2 text-lg font-black text-warn">
            這位客人剛折抵過
          </p>
          <p className="mt-1 text-sm text-pretty text-ink-soft">
            {recent.minutesAgo === 0
              ? '不到 1 分鐘前'
              : `${recent.minutesAgo} 分鐘前`}
            已折抵 <strong className="text-ink">{recent.amount} 元</strong>
            {recent.staffName ? `（${recent.staffName}）` : ''}。
            確認不是重複操作再繼續。
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-14 cursor-pointer rounded-xl border-2 border-line bg-raised font-bold transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => setAcknowledged(true)}
              className="min-h-14 cursor-pointer rounded-xl bg-warn font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
            >
              確認要再折抵
            </button>
          </div>
        </div>
      ) : null}

      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="idempotencyKey" value={idemKey} />
      <input type="hidden" name="amount" value={amount} />

      <Card className={acknowledged ? '' : 'pointer-events-none opacity-40'}>
        <label
          htmlFor="redeem-amount"
          className="text-sm font-bold text-ink-soft"
        >
          本次折抵
        </label>

        <div className="my-3 flex items-baseline justify-center gap-2">
          <input
            id="redeem-amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={raw}
            /*
              超過可折抵金額當下就夾住，不等到按確認才報錯。
              店員看到數字停在上限，就知道這位客人只能折這麼多。
            */
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 5);
              setRaw(digits === '' ? '' : String(Math.min(usable, Number(digits))));
            }}
            // 點進去就全選，直接打新的數字，不必先刪
            onFocus={(e) => e.target.select()}
            /*
              吞掉 Enter。表單裡按 Enter 會直接送出，等於跳過「再按一次
              確認」那道保護 —— 而那道保護擋的是客人的錢。
            */
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            aria-describedby="redeem-max"
            className="tabular w-36 rounded-xl border-2 border-line bg-surface py-2 text-center text-5xl font-black text-ink transition-colors focus:border-brand-500 focus:outline-none"
          />
          <span className="text-2xl font-bold text-ink-soft">元</span>
        </div>

        <p id="redeem-max" className="mb-3 text-center text-sm text-ink-faint">
          最多可折 {usable} 元
        </p>

        {/*
          用 flex 而不是固定四欄。餘額小的時候快捷鍵會被濾掉，固定欄數
          會讓剩下的那一顆縮在左邊、右邊空一大片
        */}
        <div className="flex flex-wrap gap-2">
          {[...quick, usable].map((v, i) => (
            <button
              key={v}
              type="button"
              onClick={() => setRaw(String(v))}
              className={`min-h-14 flex-1 basis-18 cursor-pointer rounded-xl border-2 text-lg font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${
                amount === v
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-line bg-raised'
              }`}
            >
              {i === quick.length ? '全部' : v}
            </button>
          ))}
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
          disabled={pending || amount <= 0 || !acknowledged}
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
  const couponError = state && 'error' in state ? state.error : null;

  const announced = useRef<string | null>(null);

  useEffect(() => {
    const key = success
      ? `ok:${success.prizeName}`
      : couponError
        ? `err:${couponError}`
        : null;
    if (!key || announced.current === key) return;

    announced.current = key;
    if (success) playRedeemSuccessSound();
    else playErrorSound();
  }, [success, couponError]);

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

      <Button type="submit" size="lg" loading={pending} onClick={unlockAudio}>
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
