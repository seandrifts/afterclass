'use client';

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  IconAlert,
  IconGift,
  IconLine,
  IconSound,
  IconSoundOff,
  IconSparkle,
} from '@/components/icons';
import { PrizeStrip } from './prize-strip';
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

/*
  轉軸分成兩段：spinning 是還不知道結果的空轉，landing 是知道了之後
  減速到定位。

  一開始是一段式的：按下去就朝著落點滑過去。但那時候 API 還沒回來，
  落點只能先給預設值 0，而排序第一的正好是最大獎，客人就會看到轉軸
  慢慢停在「免單」上，等結果回來才硬跳成真正抽中的獎。中了又被抽走
  是最傷的觀感，寧可多轉半秒也不能發生。
*/
const ITEM_H = 132;
const SPIN_MIN_MS = 900; // 最短空轉。網路太快時也要有「真的在轉」的感覺
const SPIN_SET_MS = 520; // 空轉繞完一圈的時間，決定等速階段的速度
const LAND_MS = 2200; // 減速到定位
const LAND_MIN_LOOPS = 3; // 減速期間至少再繞幾圈，才有慣性

/*
  減速曲線。

  重點不只是「慢下來」，而是**整段的最高速度不能超過空轉速度太多**，
  否則交棒的瞬間會突然衝一下。之前用 (0.16, 0.84, 0.24, 1)，起始速度
  是平均的 5.25 倍，換算成畫面就是空轉 34px/幀、一交棒變成 142px/幀，
  很明顯的頓挫。

  這條的峰值是平均的 1.36 倍（約 37px/幀），接得上空轉；而且九成九的
  距離在 2030ms 就走完，最後那一點只花 170ms，不會有停不下來的拖尾。
*/
const LAND_EASE = 'cubic-bezier(0.33, 0.4, 0.66, 1)';

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

/**
 * 大獎判定。
 *
 * 用「面額是否在前三分之一」而不是寫死某個獎項名稱，這樣老闆在
 * 後台調整獎項之後，慶祝效果會自動跟著新的獎項結構走。
 */
function isBig(prize: PrizeSnapshot, prizes: Prize[]): boolean {
  const values = prizes
    .filter((p) => p.weight > 0)
    .map((p) => p.face_value)
    .sort((a, b) => b - a);

  if (values.length === 0) return false;
  const threshold = values[Math.floor(values.length / 3)] ?? values[0];
  return prize.face_value >= threshold && values.length > 1;
}

/**
 * 轉軸動畫。
 *
 * 結果由後端決定，這裡只負責演出來。關鍵是分兩段：
 *
 *   spinning  還不知道結果，等速空轉，沒有落點
 *   landing   結果到了，從當下位置減速滑到該停的地方
 *
 * 兩段之間要接得看不出來。移除 CSS 動畫的瞬間元素會彈回原點，所以
 * 交棒時先把動畫當下的位置讀出來寫成 inline transform，強制回流之後
 * 再開始過渡，這樣起點就是眼睛看到的位置。
 */
function Reel({
  prizes,
  target,
  spinning,
  landing,
  settled,
  instant,
  celebrate,
  onLanded,
}: {
  prizes: Prize[];
  target: PrizeSnapshot | null;
  spinning: boolean;
  landing: boolean;
  settled: boolean;
  /** 重新整理回到已抽過的頁面。直接定位，不重演一次 */
  instant: boolean;
  celebrate: boolean;
  onLanded: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const spinStart = useRef<number | null>(null);

  const found = target
    ? prizes.findIndex((p) => p.id === target.prize_id)
    : -1;
  const landIndex = found >= 0 ? found : 0;

  // 空轉一圈的距離。keyframe 靠這個值算，跑完接回開頭剛好無縫
  const setHeight = prizes.length * ITEM_H;

  useEffect(() => {
    if (spinning && spinStart.current === null) {
      spinStart.current = performance.now();
    }
  }, [spinning]);

  useEffect(() => {
    if (!landing || !target) return;
    const el = stripRef.current;
    if (!el) return;

    // 網路快的時候結果幾乎立刻回來，這時要讓它多轉一下，
    // 不然按下去就停等於沒有抽的過程
    const elapsed = performance.now() - (spinStart.current ?? performance.now());
    const wait = Math.max(0, SPIN_MIN_MS - elapsed);

    let settle = 0;
    const start = window.setTimeout(() => {
      // 空轉動畫此刻把元素帶到哪裡。不接手的話移除動畫會彈回 0
      const raw = getComputedStyle(el).transform;
      const at = raw && raw !== 'none' ? new DOMMatrixReadOnly(raw).m42 : 0;

      el.style.animation = 'none';
      el.style.transform = `translateY(${at}px)`;
      void el.offsetHeight; // 強制回流，讓上一行成為過渡的起點

      /*
        落點要往前找，不能寫死。

        寫死圈數的話，滑行距離會隨著「交棒時剛好轉到哪」以及抽中第幾
        個獎項而差到一整圈，同樣的 2.2 秒有時要滑 2100px 有時 4100px，
        速度差一倍，快慢不一致。

        改成從目前位置往前推至少三圈，再往上取到最近一個對得上落點的
        位置，滑行距離就穩定落在三到四圈之間。
      */
      const set = prizes.length * ITEM_H;
      const least = Math.abs(at) + LAND_MIN_LOOPS * set;
      const loops = Math.ceil((least - landIndex * ITEM_H) / set);
      const final = loops * set + landIndex * ITEM_H;

      el.style.transition = `transform ${LAND_MS}ms ${LAND_EASE}`;
      el.style.transform = `translateY(-${final}px)`;

      settle = window.setTimeout(onLanded, LAND_MS);
    }, wait);

    return () => {
      window.clearTimeout(start);
      window.clearTimeout(settle);
    };
  }, [landing, target, landIndex, prizes.length, onLanded]);

  /*
    交棒之後 transform 由上面的 effect 直接寫在元素上，React 不能再碰，
    否則會把減速中的位置蓋掉。所以這裡只在「從未轉過」的情況給 transform。
  */
  const style: CSSProperties = instant
    ? { transform: `translateY(-${landIndex * ITEM_H}px)` }
    : ({
        '--reel-set': `-${setHeight}px`,
        // 空轉速度寫在這裡，跟 SPIN_SET_MS 同一個來源。
        // 減速曲線是照這個速度配的，兩邊分開寫遲早會對不上
        ...(spinning
          ? { animation: `reel-spin ${SPIN_SET_MS}ms linear infinite` }
          : {}),
      } as CSSProperties);

  /*
    要備幾組才夠滑。

    交棒時最多已經走掉一整組，再往前推三組、往上取整最多又是一組，
    所以終點最遠不超過五組；加一組讓終點那格底下還有東西，不會滑到
    空白。
  */
  const sets = Array.from({ length: LAND_MIN_LOOPS + 3 }, (_, i) => i);

  return (
    <div className="relative">
      {celebrate ? <Confetti /> : null}

      {/* 機台外框。深色底讓中間的轉軸看起來是嵌進去的，不是貼上去的 */}
      <div
        className={`rounded-card p-3 shadow-lg transition-colors duration-500 ${
          celebrate ? 'bg-amber-400' : 'bg-brand-500'
        }`}
      >
        <div
          className="relative overflow-hidden rounded-2xl bg-raised"
          style={{ height: ITEM_H }}
          aria-live="polite"
          aria-label={settled && target ? `抽中 ${target.name}` : '抽獎轉盤'}
        >
          <div
            ref={stripRef}
            className="will-change-transform"
            style={style}
          >
            {sets.map((set) =>
              prizes.map((p) => (
                <div
                  key={`${set}-${p.id}`}
                  className="flex items-center justify-center px-4 text-center font-black"
                  style={{ height: ITEM_H, color: p.color ?? undefined }}
                >
                  <span className="text-3xl text-balance">{p.name}</span>
                </div>
              )),
            )}
          </div>

          {/* 沒抽之前遮一層，避免客人先看到獎項排列去猜順序 */}
          {!spinning && !settled ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-brand-50">
              <IconGift className="size-10 text-brand-400" />
              <span className="text-4xl font-black tracking-[0.25em] text-brand-500">
                ???
              </span>
            </div>
          ) : null}

          {/* 轉動時上下加陰影，強化「正在滾動」的視覺 */}
          {spinning ? (
            <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/20 via-transparent to-black/20" />
          ) : null}

          {/* 中獎線。兩側的短刻痕讓人知道停在哪裡才算中 */}
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center">
            <span
              className={`h-8 w-1.5 rounded-r-full transition-colors duration-500 ${
                celebrate ? 'bg-amber-400' : 'bg-brand-400'
              }`}
            />
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center">
            <span
              className={`h-8 w-1.5 rounded-l-full transition-colors duration-500 ${
                celebrate ? 'bg-amber-400' : 'bg-brand-400'
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 大獎的紙屑效果。
 *
 * 純 CSS，不引入動畫函式庫。12 片就夠營造氣氛，數量再多在舊手機上
 * 會掉幀，反而顯得廉價。
 *
 * prefers-reduced-motion 由 globals.css 的全域規則接管，會退化成靜止。
 */
function Confetti() {
  const pieces = Array.from({ length: 12 }, (_, i) => i);
  const colors = ['#E4572E', '#F4A261', '#E9C46A', '#2A9D8F', '#F77F00'];

  return (
    <div
      className="pointer-events-none absolute inset-x-0 -top-8 z-10 h-32 overflow-hidden"
      aria-hidden="true"
    >
      {pieces.map((i) => (
        <span
          key={i}
          className="absolute block size-2.5 rounded-[2px] animate-[confetti_1.4s_ease-out_forwards]"
          style={{
            left: `${(i * 8.5 + 4) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 5) * 90}ms`,
          }}
        />
      ))}
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
