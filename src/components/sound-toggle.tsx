'use client';

import { useSyncExternalStore } from 'react';

import { IconSound, IconSoundOff } from '@/components/icons';
import {
  isSoundEnabled,
  playSpinSound,
  setSoundEnabled,
  soundServerSnapshot,
  subscribeSound,
  unlockAudio,
} from '@/lib/sound';

/**
 * 靜音開關。
 *
 * 客人可能在安靜的場合開這一頁（辦公室、大眾運輸），突然發出聲音
 * 會很尷尬。店員端也需要 —— 轉盤一次會響四十幾下，打烊後盤點時
 * 不會想聽到。設定存在 localStorage，下次進來會記得。
 */
export function SoundToggle({ className = '' }: { className?: string }) {
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
      className={`cursor-pointer rounded-xl p-2 text-ink-faint transition-colors hover:bg-brand-50 hover:text-ink-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${className}`}
    >
      {on ? (
        <IconSound className="size-5" />
      ) : (
        <IconSoundOff className="size-5" />
      )}
    </button>
  );
}