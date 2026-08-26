import { notFound, redirect } from 'next/navigation';

import { LoginForm } from '@/app/staff/login/login-form';
import { IconRules } from '@/components/icons';
import { Screen } from '@/components/ui';
import { getStaffSession } from '@/lib/session';
import { listActiveStaff } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '登入',
  robots: { index: false, follow: false },
};

/**
 * 後台入口。
 *
 * 網址帶一段只有老闆知道的隨機字串（環境變數 ADMIN_ENTRY_KEY），
 * 對不上就回 404，跟不存在的頁面完全一樣。
 *
 * 這是縱深防禦的一層，不是主要防線。真正擋住暴力破解的是 PIN 長度
 * 與登入失敗鎖定；這一層擋的是另一種東西：滿街掃描 /admin、/wp-admin
 * 這類常見路徑的自動化機器人。它們找不到入口就不會開始嘗試，
 * 連累積失敗次數的機會都沒有。
 *
 * 比對用 timingSafeEqual 而不是 ===。字串比較會在第一個不同的字元
 * 就返回，回應時間的差異理論上可以被用來逐字元推測金鑰。
 */
export default async function AdminEntryPage(
  props: PageProps<'/enter/[key]'>,
) {
  const { key } = await props.params;
  const expected = process.env.ADMIN_ENTRY_KEY;

  if (!expected || !safeEqual(key, expected)) notFound();

  const session = await getStaffSession();
  if (session?.role === 'owner') redirect('/admin');
  if (session) redirect('/staff');

  const owners = await listActiveStaff('owner');

  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <IconRules className="size-8" />
          </div>
          <h1 className="mt-4 text-2xl font-black">老闆登入</h1>
          <p className="mt-1 text-sm text-ink-soft">
            登入後可管理獎項、成本與報表
          </p>
        </div>

        <LoginForm staff={owners} role="owner" />
      </div>
    </Screen>
  );
}

/** 定時比對，避免從回應時間推測金鑰內容 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
