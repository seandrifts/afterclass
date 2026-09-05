'use client';

import { type CSSProperties, useEffect, useRef } from 'react';

import { IconGift } from '@/components/icons';
import { playReelTick } from '@/lib/sound';
import type { Prize, PrizeSnapshot } from '@/lib/types';

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

/**
 * 大獎判定。
 *
 * 用「面額是否在前三分之一」而不是寫死某個獎項名稱，這樣老闆在
 * 後台調整獎項之後，慶祝效果會自動跟著新的獎項結構走。
 */
export function isBig(prize: PrizeSnapshot, prizes: Prize[]): boolean {
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
export function Reel({
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

  /*
    轉動的「喀喀」聲。

    刻意不用固定節拍，而是讀轉軸真正的位置，每經過一個獎項就響一聲。
    這樣減速時聲音會自己跟著慢下來 —— 喀喀喀…喀…喀……喀，最後停住。
    那個由密到疏的過程就是轉盤的張力所在，用固定節拍或一段錄好的音檔
    都做不出來，而且動畫時間一改就對不上。

    高速時大約每秒十五下，跟實體拉霸機差不多。
  */
  useEffect(() => {
    if (!spinning || instant) return;
    const el = stripRef.current;
    if (!el) return;

    let raf = 0;
    let lastSlot: number | null = null;

    const watch = () => {
      const raw = getComputedStyle(el).transform;
      const y = raw && raw !== 'none' ? new DOMMatrixReadOnly(raw).m42 : 0;
      const slot = Math.floor(Math.abs(y) / ITEM_H);

      // 第一幀只記位置不發聲，否則一進畫面就會多響一下
      if (lastSlot !== null && slot !== lastSlot) playReelTick();
      lastSlot = slot;

      raf = requestAnimationFrame(watch);
    };

    raf = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(raf);
  }, [spinning, instant]);

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
