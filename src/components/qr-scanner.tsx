'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { IconCamera, IconKeyboard } from './icons';
import { playScanSound } from '@/lib/sound';
import { Spinner } from './ui';

type State = 'idle' | 'starting' | 'scanning' | 'denied' | 'unsupported';

/**
 * 掃碼輸入。同時支援三種方式：
 *
 * 1. 條碼槍 / 掃描器（USB 或藍牙）
 *    這類裝置在作業系統眼中就是一個鍵盤，掃到之後把內容「打」出來
 *    再送出一個 Enter。所以只要輸入框保持焦點就能直接用，不需要
 *    任何驅動或設定。輸入框預設 autofocus，送出後也會自動搶回焦點，
 *    店員可以連續掃下一位客人而不用碰螢幕。
 *
 * 2. 手機相機
 *    尖峰時段店員手動輸入 10 碼會員碼大約要 10 秒，掃描只要 2 秒。
 *
 * 3. 手動輸入
 *    權限被拒、桌機沒鏡頭、iOS 在非 HTTPS 下直接不給用。
 *    手動輸入永遠保留，不是備援而是對等的選項。
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
  const inputRef = useRef<HTMLInputElement>(null);

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
        setHint('這台裝置找不到可用的相機，請用條碼槍或手動輸入。');
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      const scanner = new QrScanner(
        video,
        (result) => {
          const text = extractCode(result.data);

          /*
            這裡一定要用 flushSync。

            這個 callback 來自 qr-scanner 函式庫，不在 React 的事件系統
            裡，所以 setValue 會被排到之後才提交。原本是用
            requestAnimationFrame 等一幀再送出，但那不保證 React 已經把
            新值寫進 DOM —— 表單送出時讀到的是**舊值**，第一次掃就是
            空字串，畫面顯示「請掃描客人的會員碼」，明明就掃到了。
            第二次掃才會過，因為欄位裡還留著上一次的值。

            flushSync 強制在這一行就把狀態提交完，下一行讀到的 DOM
            必定是新值。
          */
          flushSync(() => {
            setValue(text);
            setState('idle');
          });

          scanner.stop();

          // 掃到就震一下並嗶一聲。店員在吵雜環境看不到也聽不到螢幕變化
          navigator.vibrate?.(60);
          playScanSound();

          /*
            掃到空字串就不要送出。

            送出去只會換來「請掃描客人的會員碼」，店員明明掃到了卻看到
            這句話，只會以為機器壞了。寧可什麼都不做讓他再掃一次。
          */
          if (autoSubmit && text) inputRef.current?.form?.requestSubmit();
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
          ? '相機權限被拒絕。到瀏覽器的網站設定允許相機，或用條碼槍與手動輸入。'
          : '相機啟動失敗，請用條碼槍或手動輸入。',
      );
    }
  }

  function stop() {
    scannerRef.current?.stop();
    setState('idle');
    inputRef.current?.focus();
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
          // 條碼槍會把按鍵送到目前焦點的元素。這顆按鈕不該搶走焦點，
          // 否則掃出來的字元就落在按鈕上而不是輸入框
          tabIndex={-1}
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
              用相機掃描
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
        ref={inputRef}
        id={name}
        name={name}
        value={value}
        // 條碼槍靠這個接收按鍵。沒有 autofocus 的話掃出來的字元會落空
        autoFocus
        onChange={(e) => {
          const raw = e.target.value;
          // 有些條碼槍會在結尾補上換行而不是送 Enter，一併清掉
          const cleaned = numeric
            ? raw.replace(/\D/g, '')
            : raw.replace(/[\r\n\t]/g, '');
          setValue(cleaned);
        }}
        onKeyDown={(e) => {
          // 部分機型送的是 Tab 而不是 Enter，兩種都當成「掃完了」
          if (e.key === 'Tab' && value.length > 0 && autoSubmit) {
            e.preventDefault();
            inputRef.current?.form?.requestSubmit();
          }
        }}
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

      <p className="text-center text-xs text-ink-faint">
        可用條碼槍直接掃描，或按上方按鈕用相機
      </p>
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
