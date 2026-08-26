'use client';

import { useActionState, useRef, useState } from 'react';

import { removeLogoAction, uploadLogoAction } from './actions';
import { IconAlert, IconCamera } from '@/components/icons';
import { Spinner } from '@/components/ui';

/**
 * 店家大頭貼上傳。
 *
 * 獨立成自己的表單，不跟設定頁那張大表單混在一起。上傳是即時生效的
 * 動作，而設定要按「儲存設定」才送出，兩者混在一起會讓人不確定
 * 圖到底存了沒。
 *
 * 選檔之後先在本地預覽再上傳，老闆可以確認裁切與清晰度。
 */
export function LogoUploader({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState(uploadLogoAction, null);
  const [removeState, removeAction, removing] = useActionState(
    removeLogoAction,
    null,
  );

  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = preview ?? current;
  const error =
    (state && 'error' in state ? state.error : null) ??
    (removeState && 'error' in removeState ? removeState.error : null);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {/*
          圓形預覽，跟客人在登入頁與 LINE 分享時看到的形狀一致。
          背景給淺色底，才看得出透明背景的 PNG 邊緣在哪裡。
        */}
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-brand-50">
          {shown ? (
            // 這是老闆自己上傳的圖，來源固定為我們的 storage
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown}
              alt="店家大頭貼預覽"
              className="size-full object-cover"
            />
          ) : (
            <IconCamera className="size-8 text-brand-300" />
          )}
        </div>

        <form action={action} className="flex-1 space-y-2">
          <input
            ref={inputRef}
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
            className="block w-full cursor-pointer text-sm file:mr-3 file:cursor-pointer file:rounded-xl file:border-0 file:bg-brand-100 file:px-4 file:py-2 file:text-sm file:font-bold file:text-brand-700 hover:file:bg-brand-200"
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending || !preview}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-sm font-bold text-(--color-brand-on) transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
            >
              {pending ? <Spinner className="size-4" /> : null}
              {pending ? '上傳中' : '上傳'}
            </button>

            {current ? (
              <button
                type="button"
                disabled={removing}
                onClick={() => {
                  setPreview(null);
                  if (inputRef.current) inputRef.current.value = '';
                  removeAction();
                }}
                className="cursor-pointer rounded-xl border border-line px-4 py-2 text-sm font-bold text-ink-soft transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
              >
                {removing ? '移除中' : '移除'}
              </button>
            ) : null}
          </div>
        </form>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-bad"
        >
          <IconAlert className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {state && 'saved' in state && state.saved ? (
        <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-good">
          已上傳。客人在登入頁與分享預覽會看到這張圖。
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-ink-faint">
        建議正方形、至少 400×400，PNG 或 JPG，2 MB 以內。
        會以圓形裁切顯示，重要內容不要放在角落。
      </p>
    </div>
  );
}
