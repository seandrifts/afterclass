import { redirect } from 'next/navigation';

import { LoginForm } from '@/app/staff/login/login-form';
import { RoleSwitch } from '@/components/role-switch';
import { Screen } from '@/components/ui';
import { getStaffSession } from '@/lib/session';
import { listActiveStaff } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export const metadata = { title: '老闆登入' };

/**
 * 老闆登入。
 *
 * 跟店員登入分開的理由不只是動線：後台看得到成本、機率、會員名單
 * 與報表，那些是商業機密。店員知道機率之後可以幫親友挑時機。
 */
export default async function AdminLoginPage() {
  const session = await getStaffSession();

  if (session?.role === 'owner') redirect('/admin');
  if (session) redirect('/staff');

  const owners = await listActiveStaff('owner');

  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center">
        <RoleSwitch current="owner" />

        <div className="mt-6 mb-6 text-center">
          <h1 className="text-2xl font-black">老闆登入</h1>
          <p className="mt-1 text-sm text-ink-soft">
            登入後可管理獎項、成本與報表
          </p>
        </div>

        <LoginForm staff={owners} role="owner" />
      </div>
    </Screen>
  );
}
