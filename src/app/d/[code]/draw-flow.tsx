'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Card, Screen } from '@/components/ui';
import { formatForCustomer, progressToward } from '@/lib/points';
import type { Prize, PrizeSnapshot, Settings } from '@/lib/types';

type Phase =
  | 'idle'
  | 'spinning'
  | 'revealed'
  | 'claiming'
  | 'claimed'
  | 'error';

const REEL_LOOPS = 6;
const SPIN_MS = 3200;

export function DrawFlow({
  code,
  settings,
  prizes,
  user,
  alreadyDrawn,
}: {
  code: string;
  settings: Settings;
  prizes: Prize[];
  user: { displayName: string | null; balance: number } | null;
  alreadyDrawn: PrizeSnapshot | null;
}) {
  const [phase, setPhase] = useState<Phase>(alreadyDrawn ? 'revealed' : 'idle');
  const [prize, setPrize] = useState<PrizeSnapshot | null>(alreadyDrawn);
  const [balance, setBalance] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const claimed = useRef(false);

  async function draw() {
    setPhase('spinning');
    setMessage(null);

    try {
      const res = await fetch('/api/draw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();

      if (!res.ok) {
        setPhase('error');
        setMessage(describeDrawError(json.error, json.reason));
        return;
      }

      setPrize(json.prize as PrizeSnapshot);

      // 等轉盤停下來才揭曉。結果早就決定好了，動畫只是把它演出來
      window.setTimeout(() => setPhase('revealed'), SPIN_MS);
    } catch {
      setPhase('error');
      setMessage('連線不穩，請確認網路後再試一次。');
    }
  }

  const claim = useCallback(async () => {
    setPhase('claiming');

    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();

      if (!res.ok) {
        setPhase('error');
        setMessage(
          json.error === 'TOKEN_NOT_CLAIMABLE'
            ? '超過領取時限了，這次的獎品沒有存進帳戶。'
            : '領取失敗，請重新整理再試一次。',
        );
        return;
      }

      if (typeof json.newBalance === 'number') setBalance(json.newBalance);
      setPhase('claimed');
    } catch {
      setPhase('error');
      setMessage('連線不穩，請確認網路後再試一次。');
    }
  }, [code]);

  // 已登入的人抽完就直接入帳，不需要多按一次。
  // claimed ref 確保嚴格模式下的重複掛載不會領兩次
  useEffect(() => {
    if (phase !== 'revealed' || !user || claimed.current) return;
    claimed.current = true;
    void claim();
  }, [phase, user, claim]);

  if (phase === 'error') {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="text-6xl" aria-hidden>
            😵
          </div>
          <h1 className="mt-5 text-2xl font-bold">沒抽成功</h1>
          <p className="mt-3 text-ink-soft">{message}</p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <header className="mb-6 text-center">
        <p className="text-sm font-medium text-brand-600">
          {settings.shop_name || '消費抽獎'}
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">
          {phase === 'idle' ? '來抽一次吧' : null}
          {phase === 'spinning' ? '抽獎中⋯' : null}
          {phase === 'revealed' || phase === 'claiming' ? '恭喜！' : null}
          {phase === 'claimed' ? '已存進你的帳戶' : null}
        </h1>
      </header>

      <Reel
        prizes={prizes}
        target={prize}
        spinning={phase === 'spinning'}
        revealed={phase !== 'idle' && phase !== 'spinning'}
      />

      {phase === 'idle' ? (
        <div className="mt-8">
          <Button size="lg" onClick={draw}>
            開始抽獎
          </Button>
          <p className="mt-4 text-center text-sm text-ink-faint">
            每組序號只能抽一次
          </p>
        </div>
      ) : null}

      {(phase === 'revealed' || phase === 'claiming' || phase === 'claimed') &&
      prize ? (
        <Outcome
          prize={prize}
          settings={settings}
          user={user}
          balance={balance}
          phase={phase}
          code={code}
        />
      ) : null}
    </Screen>
  );
}

/**
 * 轉軸動畫。
 *
 * 結果早就由後端決定了，這裡只負責把它演出來。用單純的 CSS transform
 * 搭配 ease-out 曲線，比 canvas 轉盤輕量，在老舊手機上也順。
 */
function Reel({
  prizes,
  target,
  spinning,
  revealed,
}: {
  prizes: Prize[];
  target: PrizeSnapshot | null;
  spinning: boolean;
  revealed: boolean;
}) {
  const itemHeight = 88;
  const targetIndex = target
    ? prizes.findIndex((p) => p.id === target.prize_id)
    : 0;
  const landing = targetIndex >= 0 ? targetIndex : 0;

  // 轉滿幾圈再停在目標項目上
  const offset =
    spinning || revealed
      ? (REEL_LOOPS * prizes.length + landing) * itemHeight
      : 0;

  const loops = Array.from({ length: REEL_LOOPS + 2 }, (_, i) => i);

  return (
    <div
      className="relative overflow-hidden rounded-card border-4 border-brand-500 bg-raised shadow-lg"
      style={{ height: itemHeight }}
      aria-live="polite"
      aria-label={revealed && target ? `抽中 ${target.name}` : '抽獎轉盤'}
    >
      <div
        className="will-change-transform"
        style={{
          transform: `translateY(-${offset}px)`,
          transition: spinning
            ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.75, 0.18, 1)`
            : 'none',
        }}
      >
        {loops.map((loop) =>
          prizes.map((p) => (
            <div
              key={`${loop}-${p.id}`}
              className="flex items-center justify-center gap-2 font-black"
              style={{ height: itemHeight, color: p.color ?? undefined }}
            >
              <span className="text-2xl">{p.name}</span>
            </div>
          )),
        )}
      </div>

      {/* 沒抽之前遮一層，避免客人先看到獎項排列去猜順序 */}
      {!spinning && !revealed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-brand-50">
          <span className="text-3xl font-black text-brand-500">🎁 ? ? ?</span>
        </div>
      ) : null}
    </div>
  );
}

function Outcome({
  prize,
  settings,
  user,
  balance,
  phase,
  code,
}: {
  prize: PrizeSnapshot;
  settings: Settings;
  user: { displayName: string | null; balance: number } | null;
  balance: number | null;
  phase: Phase;
  code: string;
}) {
  const isCredit = prize.type === 'credit';
  const amount = prize.credit_amount ?? 0;

  const shown = balance ?? user?.balance ?? 0;
  const progress = progressToward(shown, settings);

  return (
    <div className="mt-8 space-y-5">
      <Card className="text-center">
        <p className="text-sm text-ink-soft">你抽中了</p>
        <p className="mt-2 text-4xl font-black text-brand-600">
          {isCredit ? `+${formatForCustomer(amount, settings)}` : prize.name}
        </p>
        {!isCredit ? (
          <p className="mt-2 text-sm text-ink-soft">
            價值 {prize.face_value} 元
          </p>
        ) : null}
      </Card>

      {phase === 'claimed' && isCredit ? (
        <Card>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-soft">目前累積</span>
            <span className="tabular text-3xl font-black text-ink">
              {formatForCustomer(shown, settings)}
            </span>
          </div>
          <p className="mt-1 text-right text-sm text-ink-soft">
            可折抵 {shown} 元
          </p>

          <div className="mt-4 h-3 overflow-hidden rounded-full bg-brand-100">
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-700"
              style={{ width: `${progress.ratio * 100}%` }}
            />
          </div>
          <p className="mt-2 text-center text-sm font-medium text-ink-soft">
            {progress.reached
              ? `已達單次折抵上限，來店即可折抵 ${progress.target} 元`
              : `再 ${formatForCustomer(progress.remaining, settings)} 達單次折抵上限`}
          </p>
        </Card>
      ) : null}

      {phase === 'claiming' ? (
        <p className="text-center text-ink-soft">存入中⋯</p>
      ) : null}

      {!user ? (
        <div className="space-y-3">
          <a
            href={`/auth/line?next=${encodeURIComponent(`/d/${code}`)}`}
            className="flex min-h-16 w-full items-center justify-center rounded-2xl bg-[#06C755] text-xl font-bold text-white shadow-md active:scale-[0.98]"
          >
            用 LINE 登入領取
          </a>
          <p className="text-center text-sm text-ink-faint">
            需在 {settings.claim_window_minutes} 分鐘內登入，逾時視為放棄
          </p>
        </div>
      ) : null}

      {phase === 'claimed' ? (
        <a
          href="/wallet"
          className="block text-center text-base font-medium text-brand-600 underline"
        >
          查看我的點數
        </a>
      ) : null}
    </div>
  );
}

function describeDrawError(error: string, reason?: string): string {
  switch (error) {
    case 'RATE_LIMITED':
      return '操作太頻繁，請稍等一下再試。';
    case 'CAMPAIGN_CLOSED':
      return reason ?? '活動目前暫停中。';
    case 'TOKEN_NOT_AVAILABLE':
      return '這組序號已經被使用過，或已經失效。';
    case 'PRIZE_OUT_OF_STOCK':
      return '剛好有人抽走了最後一個獎項，請重新整理再試一次。';
    case 'NO_PRIZES':
      return '目前沒有可抽的獎項，請洽店家人員。';
    default:
      return '發生問題，請重新整理再試一次。';
  }
}
