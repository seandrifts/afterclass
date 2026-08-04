import { redirect } from 'next/navigation';

import { getSettings } from '@/lib/settings';
import { getUserSession } from '@/lib/session';
import { IconBowl, IconLine } from '@/components/icons';
import { Card, Screen } from '@/components/ui';

/**
 * 錯誤訊息要告訴客人「現在該做什麼」，不是描述系統狀態。
 * 客人看到「登入連結已失效」只會困惑，看到「請再按一次下面的按鈕」
 * 才知道怎麼辦。
 */
const ERRORS: Record<string, string> = {
  bad_state: '登入逾時了，請再按一次下面的按鈕。',
  blocked: '這個帳號目前無法使用，請洽店家人員。',
  cancelled: '你取消了授權。要累積點數的話，請再按一次下面的按鈕。',
  line_failed: 'LINE 登入沒有完成，請再按一次下面的按鈕。',
  missing_params: '登入資訊不完整，請再按一次下面的按鈕。',
};

export default async function LoginPage(props: PageProps<'/login'>) {
  const session = await getUserSession();
  if (session) redirect('/wallet');

  const params = await props.searchParams;
  const settings = await getSettings();

  const nextRaw = typeof params.next === 'string' ? params.next : '/wallet';
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//')
    ? nextRaw
    : '/wallet';

  const errorKey = typeof params.error === 'string' ? params.error : null;

  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center">
        <div className="text-center">
          <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <IconBowl className="size-10" />
          </div>
          <h1 className="mt-4 text-2xl font-black">
            {settings.shop_name || '消費抽獎'}
          </h1>
          <p className="mt-2 text-ink-soft">登入後就能累積回饋點數</p>
        </div>

        {errorKey ? (
          <div
            role="alert"
            className="mt-6 rounded-2xl bg-red-50 px-4 py-3 text-center text-sm text-pretty text-bad"
          >
            <p>{ERRORS[errorKey] ?? '登入失敗，請再按一次下面的按鈕。'}</p>
            {next.startsWith('/d/') ? (
              <p className="mt-1 font-bold">
                你抽中的獎品還在，登入後就會存進帳戶。
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8">
          <a
            href={`/auth/line?next=${encodeURIComponent(next)}`}
            className="flex min-h-16 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#06C755] text-xl font-bold text-white shadow-md transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#06C755]/40"
          >
            <IconLine className="size-7" />
            用 LINE 登入
          </a>
        </div>

        <Card className="mt-8">
          <h2 className="text-sm font-bold text-ink">關於你的個人資料</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            登入後我們只會取得你的 LINE 名稱與大頭貼，用來顯示帳戶與
            寄送點數到期提醒。資料不會提供給第三方，你隨時可以要求刪除。
          </p>
        </Card>
      </div>
    </Screen>
  );
}
