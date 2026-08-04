import { IconSparkle } from '@/components/icons';
import type { Prize, Settings } from '@/lib/types';

/**
 * 獎項一覽。
 *
 * 抽獎前的畫面原本有一大半是空白，只有一條細長的轉軸跟一顆按鈕。
 * 那個留白沒有任何作用，客人也不知道自己在賭什麼。
 *
 * 這裡把最大獎與「100% 中獎」明確講出來。大獎看得到本身就是
 * 參與動機，即使機率只有 0.3%；而 100% 中獎則解除「會不會摸彩摸空」
 * 的疑慮，這兩件事都直接影響客人願不願意按下那顆按鈕。
 */
export function PrizeStrip({
  prizes,
  settings,
}: {
  prizes: Prize[];
  settings: Settings;
}) {
  const pool = prizes.filter((p) => p.weight > 0);
  if (pool.length === 0) return null;

  const top = pool.reduce((best, p) =>
    p.face_value > best.face_value ? p : best,
  );

  // 儲值金類的獎項用點數呈現，數字大比較有份量
  const tiers = pool
    .filter((p) => p.id !== top.id)
    .sort((a, b) => b.face_value - a.face_value)
    .slice(0, 4);

  return (
    <section className="mt-6" aria-label="獎項一覽">
      <div className="rounded-card border-2 border-amber-300 bg-linear-to-br from-amber-50 to-brand-50 p-4">
        {/*
          徽章跟「最大獎」放同一行，讓獎項名稱獨佔整行。

          原本兩者並排，中文沒有空格可斷，較長的獎項名稱會被擠成
          「免單（下次 / 消費全免）」，斷在括號中間很難讀。
        */}
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
            <IconSparkle className="size-3.5" />
            最大獎
          </p>
          <span className="shrink-0 rounded-full bg-good px-3 py-1 text-xs font-black text-white">
            100% 中獎
          </span>
        </div>

        <p className="mt-2 text-2xl font-black text-balance text-amber-700">
          {top.name}
        </p>
      </div>

      {tiers.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tiers.map((p) => (
            <span
              key={p.id}
              className="rounded-full border border-line bg-raised px-3 py-1.5 text-sm font-medium text-ink-soft"
            >
              {p.type === 'credit' && settings.points_display_enabled
                ? `${(p.credit_amount ?? 0) * settings.points_per_dollar} 點`
                : p.name}
            </span>
          ))}
          {pool.length - tiers.length - 1 > 0 ? (
            <span className="rounded-full px-3 py-1.5 text-sm text-ink-faint">
              等 {pool.length} 種獎項
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
