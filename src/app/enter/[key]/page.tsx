import { notFound, redirect } from 'next/navigation';

import { LoginForm } from '@/app/staff/login/login-form';
import { IconRules } from '@/components/icons';
import { Screen } from '@/components/ui';
import { entryRole } from '@/lib/entry';
import { getStaffSession } from '@/lib/session';
import { listActiveStaff } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '登入',
  robots: { index: false, follow: false },
};

/**
 * 登入入口。老闆與店員各有一段只有自己知道的網址。
 *
 * 金鑰對不上就回 404，跟不存在的頁面完全一樣（實際的攔截在 proxy，
 * 這裡再比一次是保險）。對上了，proxy 會順手把這台裝置登記起來，
 * 之後登入到期時可以直接回 /staff/login，不用再找這串網址。
 *
 * 這是縱深防禦的一層，不是唯一的防線。PIN 長度與登入失敗鎖定照舊；
 * 這一層讓外人看不到帳號清單，也就沒辦法靠故意打錯把店員鎖住。
 */
export default async function EntryPage(props: PageProps<'/enter/[key]'>) {
  const { key } = await props.params;

  const role = entryRole(key);
  if (!role) notFound();

  const session = await getStaffSession();
  if (session?.role === 'owner') redirect('/admin');
  if (session) redirect('/staff');

  // 各看各的。店員入口不列老闆帳號，反過來也一樣
  const people = await listActiveStaff(role);

  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center">
        {role === 'owner' ? (
          <div className="mb-6 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
              <IconRules className="size-8" />
            </div>
            <h1 className="mt-4 text-2xl font-black">老闆登入</h1>
            <p className="mt-1 text-sm text-ink-soft">
              登入後可管理獎項、成本與報表
            </p>
          </div>
        ) : (
          <h1 className="mb-6 text-center text-2xl font-black">店員登入</h1>
        )}

        <LoginForm staff={people} role={role} />
      </div>
    </Screen>
  );
}
