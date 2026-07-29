import { Screen, Skeleton } from '@/components/ui';

/**
 * 全域載入骨架。
 *
 * 所有頁面都是動態渲染（要讀資料庫），沒有這個的話換頁時會出現
 * 短暫白畫面。客人在店門口網路不好時那個白畫面可能持續好幾秒，
 * 很容易讓人以為壞掉而直接關掉。
 */
export default function Loading() {
  return (
    <Screen>
      <div className="space-y-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </Screen>
  );
}
