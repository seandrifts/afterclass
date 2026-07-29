import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LoginForm } from './login-form';
import { getStaffSession } from '@/lib/session';
import { listActiveStaff } from '@/lib/staff';
import { Screen } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: '店員登入' };

export default async function StaffLoginPage() {
  const session = await getStaffSession();
  if (session) redirect(session.role === 'owner' ? '/admin' : '/staff');

  // 只列店員。店員不需要知道老闆帳號叫什麼，也不會誤點
  const staff = await listActiveStaff('staff');

  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center">
        <h1 className="mb-6 text-center text-2xl font-black">店員登入</h1>
        <LoginForm staff={staff} role="staff" />

        <div className="mt-10 text-center">
          <Link
            href="/admin/login"
            className="cursor-pointer rounded px-3 py-2 text-sm text-ink-faint underline underline-offset-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
          >
            我是老闆，要進後台
          </Link>
        </div>
      </div>
    </Screen>
  );
}
