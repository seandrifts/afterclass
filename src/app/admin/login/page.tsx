import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/app/staff/login/login-form';
import { IconRules } from '@/components/icons';
import { Screen } from '@/components/ui';
import { getStaffSession } from '@/lib/session';
import { listActiveStaff } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export const metadata = { title: '後台登入' };

/**
 * 老闆登入。
 *
 * 跟店員登入分開的理由不只是動線：後台看得到成本、機率、會員名單
 * 與報表，那些是商業機密。店員知道機率之後可以幫親友挑時機，
 * 所以連「有這個入口」都不該出現在店員的日常畫面裡。
 */
export default async function AdminLoginPage() {
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
          <h1 className="mt-4 text-2xl font-black">後台登入</h1>
          <p className="mt-1 text-sm text-ink-soft">獎項、成本與報表</p>
        </div>

        <LoginForm staff={owners} role="owner" />

        <div className="mt-10 text-center">
          <Link
            href="/staff/login"
            className="cursor-pointer rounded px-3 py-2 text-sm text-ink-faint underline underline-offset-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
          >
            我是店員
          </Link>
        </div>
      </div>
    </Screen>
  );
}
