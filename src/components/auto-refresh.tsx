'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * 讓伺服器渲染的頁面在開著的時候保持新鮮。
 *
 * 針對的情境：客人把錢包頁開著出示 QR，店員折抵完成，
 * 客人螢幕上的餘額還是舊的。店員說扣了 30，客人低頭一看
 * 數字沒動，這在櫃檯就是爭議。
 *
 * 做法是輕量輪詢 + 切回分頁時立即更新：
 *   - 頁面可見時每隔幾秒 router.refresh()，重跑 server component
 *     重新查一次資料庫，client 端的 React 狀態不受影響
 *   - 切到背景就停，不浪費客人的電量與流量
 *   - 切回前景的瞬間立即刷一次，這涵蓋了「掃完收回手機看一眼」
 *     的最常見動線
 *
 * 刻意不用 WebSocket 或 Supabase Realtime。這個規模的店，
 * 為了幾秒的差距背一條長連線不划算，輪詢的行為也更好推理。
 */
export function AutoRefresh({ intervalMs = 8000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => router.refresh(), intervalMs);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh(); // 回到前景先立刻刷一次
        start();
      } else {
        stop();
      }
    };

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
