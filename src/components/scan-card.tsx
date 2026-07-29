'use client';

import { useEffect, useState } from 'react';

/**
 * 出示給店員掃描的 QR 區塊。
 *
 * 小吃店的環境對掃描很不友善：頭頂燈直射造成反光、櫃檯昏暗、
 * 客人手在抖、店員的手機鏡頭有油污。所以這裡做了幾件事：
 *
 * 1. 點一下可以放大到全螢幕。放大後 QR 佔滿寬度，容錯空間大很多
 * 2. 全螢幕時背景純白，把手機自動亮度調節推到最亮
 * 3. 螢幕亮度不足時給明確提示，而不是讓客人跟店員互相乾瞪眼
 * 4. 序號永遠用大字顯示在旁邊，掃不到就用念的
 */
export function ScanCard({
  svg,
  code,
  hint = '結帳時出示給店員',
}: {
  svg: string;
  code: string;
  hint?: string;
}) {
  const [zoomed, setZoomed] = useState(false);

  // 全螢幕時鎖住背景捲動，避免客人舉著手機時不小心滑掉
  useEffect(() => {
    if (!zoomed) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(false);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [zoomed]);

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="mx-auto mt-6 block cursor-pointer rounded-2xl bg-white p-3 shadow-inner ring-1 ring-line transition-transform duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
        aria-label={`放大顯示會員碼 ${code}`}
      >
        <span dangerouslySetInnerHTML={{ __html: svg }} />
      </button>

      <p className="tabular mt-3 text-lg font-bold tracking-widest text-ink">
        {code}
      </p>
      <p className="mt-1 text-sm text-ink-soft">{hint}</p>
      <p className="mt-1 text-xs text-ink-faint">點一下 QR 可放大</p>

      {zoomed ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-6"
          role="dialog"
          aria-modal="true"
          aria-label="放大的會員碼"
        >
          {/* 純白背景會讓手機的自動亮度調到最高，這是最容易被忽略的掃描技巧 */}
          <div
            className="w-full max-w-sm [&_svg]:w-full [&_svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svg }}
          />

          <p className="tabular mt-6 text-3xl font-black tracking-[0.2em] text-black">
            {code}
          </p>
          <p className="mt-3 text-center text-sm text-pretty text-stone-500">
            掃不到的話，可以直接把上面這組號碼念給店員輸入
          </p>

          <button
            type="button"
            onClick={() => setZoomed(false)}
            className="mt-10 min-h-14 w-full max-w-sm cursor-pointer rounded-2xl bg-stone-900 text-lg font-bold text-white transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-400"
          >
            關閉
          </button>
        </div>
      ) : null}
    </>
  );
}
