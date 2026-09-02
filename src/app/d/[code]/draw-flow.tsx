'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  IconAlert,
  IconLine,
  IconSound,
  IconSoundOff,
  IconSparkle,
} from '@/components/icons';
import { PrizeStrip } from './prize-strip';
import { isBig, Reel } from '@/components/reel';
import { Button, Card, Screen, Spinner } from '@/components/ui';
import { formatForCustomer, progressToward } from '@/lib/points';
import {
  isSoundEnabled,
  playSpinSound,
  playWinSound,
  setSoundEnabled,
  soundServerSnapshot,
  subscribeSound,
  unlockAudio,
} from '@/lib/sound';
import type { Prize, PrizeSnapshot, Settings } from '@/lib/types';

type Phase =
  | 'idle'
  | 'spinning'
  | 'landing'
  | 'revealed'
  | 'claiming'
  | 'claimed'
  | 'error';

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

    // 必須在使用者手勢的當下解鎖音訊，實際發聲是三秒後轉盤停下來時
    unlockAudio();
    playSpinSound();

    // 觸覺回饋。手機轉靜音時聽不到聲音，震動仍然有感
    navigator.vibrate?.(30);

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

      // 拿到結果才給落點，轉軸這時候才開始減速。揭曉由 Reel 在
      // 減速結束時回呼，兩者用同一個時間軸，不會各算各的
      setPrize(json.prize as PrizeSnapshot);
      setPhase('landing');
    } catch {
      setPhase('error');
      setMessage('連線不穩，請確認網路後再試一次。');
    }
  }

  /*
    轉軸停穩的那一刻才揭曉。

    聲音、震動、文案都掛在這裡，跟畫面用同一個時間軸。之前是各自
    setTimeout，網路慢的時候動畫還在跑就先響了。
  */
  const handleLanded = useCallback(() => {
    setPhase('revealed');
    if (prize) {
      playWinSound(isBig(prize, prizes));
      navigator.vibrate?.([40, 60, 120]);
    }
  }, [prize, prizes]);

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

  // 已登入的人抽完就直接入帳，不需要多按一次
  useEffect(() => {
    if (phase !== 'revealed' || !user || claimed.current) return;
    claimed.current = true;
    void claim();
  }, [phase, user, claim]);

  if (phase === 'error') {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex size-24 items-center justify-center rounded-full bg-amber-50 text-warn">
            <IconAlert className="size-12" />
          </div>
          <h1 className="mt-6 text-2xl font-bold">沒抽成功</h1>
          <p className="mt-3 text-pretty text-ink-soft">{message}</p>
        </div>
      </Screen>
    );
  }

  const spinning = phase === 'spinning' || phase === 'landing';
  const revealed = phase !== 'idle' && !spinning;
  const isBigWin = prize ? isBig(prize, prizes) : false;

  return (
    <Screen>
      {/*
        抽獎前的內容集中在畫面中段。原本整頁靠上對齊，手機下方會空掉
        一大片，看起來像沒載完
      */}
      <div className={phase === 'idle' ? 'flex flex-1 flex-col justify-center' : ''}>
        <header className="relative mb-6 text-center">
          {phase === 'idle' ? <SoundToggle /> : null}
          <p className="text-sm font-medium text-brand-600">
            {settings.shop_name || '消費抽獎'}
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-balance">
            {phase === 'idle' ? '來抽一次吧' : null}
            {spinning ? '抽獎中' : null}
            {phase === 'revealed' || phase === 'claiming' ? '恭喜！' : null}
            {phase === 'claimed' ? '已存進你的帳戶' : null}
          </h1>
        </header>

        <Reel
          prizes={prizes}
          target={prize}
          spinning={spinning}
          landing={phase === 'landing'}
          settled={revealed}
          instant={alreadyDrawn !== null}
          celebrate={revealed && isBigWin}
          onLanded={handleLanded}
        />

        {phase === 'idle' ? (
          <>
            <PrizeStrip prizes={prizes} settings={settings} />

            <div className="mt-8">
              <Button size="lg" onClick={draw}>
                <IconSparkle className="size-6" />
                開始抽獎
              </Button>
              <p className="mt-4 text-center text-sm text-ink-faint">
                每組序號只能抽一次
              </p>
            </div>
          </>
        ) : null}

        {spinning ? (
          <p
            className="mt-8 text-center text-ink-soft"
            role="status"
            aria-live="polite"
          >
            結果揭曉中
          </p>
        ) : null}
      </div>

      {revealed && prize ? (
        <Outcome
          prize={prize}
          settings={settings}
          user={user}
          balance={balance}
          phase={phase}
          code={code}
          isBigWin={isBigWin}
        />
      ) : null}
    </Screen>
  );
}

/**
 * 靜音開關。
 *
 * 客人可能在安靜的場合開這一頁（辦公室、大眾運輸），突然發出聲音
 * 會很尷尬。設定存在 localStorage，下次進來會記得。
 */
function SoundToggle() {
  // localStorage 是瀏覽器才有的外部狀態。用 useSyncExternalStore 訂閱
  // 才不會有伺服器渲染與客戶端不一致的問題，也不必在 effect 裡 setState
  const on = useSyncExternalStore(
    subscribeSound,
    isSoundEnabled,
    soundServerSnapshot,
  );

  return (
    <button
      type="button"
      onClick={() => {
        const next = !on;
        setSoundEnabled(next);
        if (next) {
          unlockAudio();
          playSpinSound(); // 開啟時給一聲，讓客人知道音量大小
        }
      }}
      aria-pressed={on}
      aria-label={on ? '關閉音效' : '開啟音效'}
      className="absolute top-0 right-0 cursor-pointer rounded-xl p-2 text-ink-faint transition-colors hover:bg-brand-50 hover:text-ink-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
    >
      {on ? (
        <IconSound className="size-5" />
      ) : (
        <IconSoundOff className="size-5" />
      )}
    </button>
  );
}

function Outcome({
  prize,
  settings,
  user,
  balance,
  phase,
  code,
  isBigWin,
}: {
  prize: PrizeSnapshot;
  settings: Settings;
  user: { displayName: string | null; balance: number } | null;
  balance: number | null;
  phase: Phase;
  code: string;
  isBigWin: boolean;
}) {
  const isCredit = prize.type === 'credit';
  const amount = prize.credit_amount ?? 0;

  const before = user?.balance ?? 0;
  const shown = balance ?? before;
  const progress = progressToward(shown, settings);

  return (
    <div className="mt-8 space-y-5">
      <Card
        className={`text-center transition-colors duration-500 ${
          isBigWin ? 'border-amber-400 bg-amber-50' : ''
        }`}
      >
        <p className="text-sm text-ink-soft">你抽中了</p>
        <p
          className={`mt-2 text-4xl font-black text-balance ${
            isBigWin ? 'text-amber-600' : 'text-brand-600'
          }`}
        >
          {isCredit ? `+${formatForCustomer(amount, settings)}` : prize.name}
        </p>
        {!isCredit ? (
          <p className="mt-2 text-sm text-ink-soft">
            價值 {prize.face_value} 元
          </p>
        ) : null}
        {isBigWin ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 px-3 py-1 text-sm font-bold text-amber-700">
            <IconSparkle className="size-4" />
            大獎
          </p>
        ) : null}
      </Card>

      {phase === 'claiming' ? (
        <div className="flex items-center justify-center gap-2 text-ink-soft">
          <Spinner />
          存入中
        </div>
      ) : null}

      {phase === 'claimed' && isCredit ? (
        <Card>
          {/*
            倍率只在「用點數顯示」時才乘。原本無條件乘上 points_per_dollar
            但單位跟著開關切換，關掉點數顯示時會變成「10 元」而不是「1 元」
          */}
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-soft">目前累積</span>
            <CountUp
              from={settings.points_display_enabled ? before * settings.points_per_dollar : before}
              to={settings.points_display_enabled ? shown * settings.points_per_dollar : shown}
              suffix={settings.points_display_enabled ? ' 點' : ' 元'}
            />
          </div>
          {settings.points_display_enabled ? (
            <p className="mt-1 text-right text-sm text-ink-soft">
              可折抵 {shown} 元
            </p>
          ) : null}

          <div
            className="mt-4 h-3 overflow-hidden rounded-full bg-brand-100"
            role="progressbar"
            aria-valuenow={Math.round(progress.ratio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="距離單次折抵上限的進度"
          >
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-1000 ease-out"
              style={{ width: `${progress.ratio * 100}%` }}
            />
          </div>
          <p className="mt-2 text-center text-sm font-medium text-pretty text-ink-soft">
            {progress.reached
              ? `已達單次折抵上限，來店即可折抵 ${progress.target} 元`
              : `再 ${formatForCustomer(progress.remaining, settings)} 達單次折抵上限`}
          </p>
        </Card>
      ) : null}

      {!user ? (
        <div className="space-y-3">
          <a
            href={`/auth/line?next=${encodeURIComponent(`/d/${code}`)}`}
            className="flex min-h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#06C755] text-xl font-bold text-white shadow-md transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#06C755]/40"
          >
            <IconLine className="size-7" />
            用 LINE 登入領取
          </a>
          <p className="text-center text-sm text-pretty text-ink-faint">
            需在 {settings.claim_window_minutes} 分鐘內登入，逾時視為放棄
          </p>
        </div>
      ) : null}

      {phase === 'claimed' ? (
        <a
          href="/wallet"
          className="block cursor-pointer rounded text-center text-base font-medium text-brand-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
        >
          查看我的點數
        </a>
      ) : null}
    </div>
  );
}

/**
 * 數字累加動畫。
 *
 * 「470 變成 500」這個過程要看得見。累積感是儲值金機制的全部價值，
 * 直接顯示終值等於把最有感的那一秒丟掉。
 */
function CountUp({
  from,
  to,
  suffix,
}: {
  from: number;
  to: number;
  suffix: string;
}) {
  const [value, setValue] = useState(from);

  useEffect(() => {
    // 所有的 setState 都在 rAF 的 callback 裡，不在 effect 本體。
    // 在 effect 本體直接 setState 會造成串聯重繪
    const reduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const duration = reduced || from === to ? 0 : 900;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      // ease-out：一開始快，接近終值時慢下來
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to]);

  return (
    <span className="tabular text-3xl font-black text-ink">
      {value}
      <span className="text-lg">{suffix}</span>
    </span>
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
