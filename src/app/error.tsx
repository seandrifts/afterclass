'use client';

import { useEffect } from 'react';

import { IconAlert } from '@/components/icons';
import { Button, Screen } from '@/components/ui';

/**
 * 全域錯誤邊界。
 *
 * 沒有這個的話，任何未預期的例外都會顯示 Next.js 的預設錯誤頁，
 * 那是英文的、有堆疊資訊的、對客人完全沒有意義的畫面。
 *
 * 不顯示技術細節給客人看，但保留 digest 讓你回報問題時有東西可查。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[lucky-draw]', error);
  }, [error]);

  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex size-24 items-center justify-center rounded-full bg-amber-50 text-warn">
          <IconAlert className="size-12" />
        </div>

        <h1 className="mt-6 text-2xl font-bold">系統出了點問題</h1>
        <p className="mt-3 text-pretty text-ink-soft">
          剛才的操作沒有完成。請重試一次，如果一直失敗請洽店家人員。
        </p>

        <div className="mt-8 w-full space-y-3">
          <Button onClick={reset}>重新試一次</Button>
          <a
            href="/wallet"
            className="block cursor-pointer rounded py-2 text-sm text-ink-faint underline underline-offset-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
          >
            回到我的點數
          </a>
        </div>

        {error.digest ? (
          <p className="mt-8 font-mono text-xs text-ink-faint">
            錯誤代碼 {error.digest}
          </p>
        ) : null}
      </div>
    </Screen>
  );
}
