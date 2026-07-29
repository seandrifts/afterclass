'use client';

import { useEffect, useRef, useState } from 'react';

import { IconCamera, IconKeyboard } from './icons';
import { Spinner } from './ui';

type State = 'idle' | 'starting' | 'scanning' | 'denied' | 'unsupported';

/**
 * 掃碼輸入。
 *
 * 尖峰時段店員手動輸入 10 碼會員碼大約要 10 秒，掃描只要 2 秒。
 * 一小時出 60 碗麵的店，這個差距是真的會塞住結帳動線的。
 *
 * 但相機不是永遠可用：權限被拒、桌機沒鏡頭、iOS 在非 HTTPS 下
 * 直接不給用。所以手動輸入永遠保留，不是備援而是對等的選項。
 */
export function ScanInput({
  name,
  label,
  placeholder,
  numeric = false,
  maxLength,
  autoSubmit = true,
}: {
  name: string;
  label: string;
  placeholder?: string;
  /** 券核銷碼是 6 位數字，會員碼是英數 */
  numeric?: boolean;
  maxLength?: number;
  autoSubmit?: boolean;
}) {
  const [state, setState] = useState<State>('idle');
  const [value, setValue] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<{ stop: () => void; destroy: () => void } | null>(
    null,
  );
  const formRef = useRef<HTMLInputElement>(null);

  // 元件卸載時務必關掉相機，否則手機上的鏡頭指示燈會一直亮著
  useEffect(() => {
    return () => {
      scannerRef.current?.stop();
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  async function start() {
    setState('starting');
    setHint(null);

    try {
      const { default: QrScanner } = await import('qr-scanner');

      if (!(await QrScanner.hasCamera())) {
        setState('unsupported');
        setHint('這台裝置找不到可用的相機，請用手動輸入。');
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      const scanner = new QrScanner(
        video,
        (result) => {
          const text = extractCode(result.data);
          setValue(text);
          scanner.stop();
          setState('idle');

          // 掃到就震一下。店員在吵雜環境看不到也聽不到提示音
          navigator.vibrate?.(60);

          if (autoSubmit) {
            // 等 React 把值寫進 input 再送出
            requestAnimationFrame(() =>
              formRef.current?.form?.requestSubmit(),
            );
          }
        },
        {
          highlightScanRegion: true,
          highlightCodeOutline: true,
          // 後鏡頭。前鏡頭要店員把手機轉過來，動作多一倍
          preferredCamera: 'environment',
          maxScansPerSecond: 8,
        },
      );

      scannerRef.current = scanner;
      await scanner.start();
      setState('scanning');
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const denied = /denied|NotAllowed|Permission/i.test(message);

      setState(denied ? 'denied' : 'unsupported');
      setHint(
        denied
          ? '相機權限被拒絕。到瀏覽器的網站設定允許相機，或直接用手動輸入。'
          : '相機啟動失敗，請用手動輸入。',
      );
    }
  }

  function stop() {
    scannerRef.current?.stop();
    setState('idle');
  }

  const scanning = state === 'scanning' || state === 'starting';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label htmlFor={name} className="text-sm font-bold text-ink-soft">
          {label}
        </label>

        <button
          type="button"
          onClick={scanning ? stop : start}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold text-brand-600 transition-colors duration-200 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
        >
          {scanning ? (
            <>
              <IconKeyboard className="size-4" />
              改用手動輸入
            </>
          ) : (
            <>
              <IconCamera className="size-4" />
              掃描 QR
            </>
          )}
        </button>
      </div>

      {/* 影像區保持掛載但在非掃描時收合，避免每次啟動都重新建立 video 元素 */}
      <div
        className={`relative overflow-hidden rounded-2xl bg-ink transition-[height] duration-200 ${
          scanning ? 'h-64' : 'h-0'
        }`}
      >
        <video
          ref={videoRef}
          className="size-full object-cover"
          playsInline
          muted
        />
        {state === 'starting' ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-white">
            <Spinner />
            相機啟動中
          </div>
        ) : null}
        {state === 'scanning' ? (
          <p className="absolute inset-x-0 bottom-0 bg-black/60 py-2 text-center text-sm text-white">
            請對準客人畫面上的 QR
          </p>
        ) : null}
      </div>

      <input
        ref={formRef}
        id={name}
        name={name}
        value={value}
        onChange={(e) =>
          setValue(numeric ? e.target.value.replace(/\D/g, '') : e.target.value)
        }
        inputMode={numeric ? 'numeric' : 'text'}
        maxLength={maxLength}
        autoComplete="off"
        autoCapitalize="characters"
        placeholder={placeholder}
        className={`tabular w-full rounded-xl border-2 border-line px-4 py-4 text-center font-bold uppercase transition-colors duration-200 focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${
          numeric ? 'text-3xl tracking-[0.3em]' : 'text-2xl tracking-widest'
        }`}
      />

      {hint ? <p className="text-sm text-warn">{hint}</p> : null}
    </div>
  );
}

/**
 * 從掃到的內容取出序號。
 *
 * 客人的錢包 QR 內容就是純序號，但實物券的 QR 也可能被掃到，
 * 而抽獎序號的 QR 是完整網址。統一在這裡處理，讓呼叫端拿到的
 * 永遠是乾淨的序號。
 */
function extractCode(raw: string): string {
  const trimmed = raw.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const segments = new URL(trimmed).pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] ?? trimmed;
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

/** 給不需要掃描的地方用的一般輸入框，樣式與 ScanInput 一致 */
export function CodeInput({
  name,
  label,
  placeholder,
  numeric = false,
  maxLength,
  autoFocus,
}: {
  name: string;
  label: string;
  placeholder?: string;
  numeric?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-bold text-ink-soft">
        {label}
      </label>
      <input
        id={name}
        name={name}
        autoFocus={autoFocus}
        inputMode={numeric ? 'numeric' : 'text'}
        maxLength={maxLength}
        autoComplete="off"
        autoCapitalize="characters"
        placeholder={placeholder}
        className={`tabular w-full rounded-xl border-2 border-line px-4 py-4 text-center font-bold uppercase transition-colors duration-200 focus:border-brand-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${
          numeric ? 'text-3xl tracking-[0.3em]' : 'text-2xl tracking-widest'
        }`}
      />
    </div>
  );
}
