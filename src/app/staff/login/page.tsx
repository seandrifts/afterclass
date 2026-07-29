import { redirect } from 'next/navigation';

import { LoginForm } from './login-form';
import { RoleSwitch } from '@/components/role-switch';
import { Screen } from '@/components/ui';
import { getStaffSession } from '@/lib/session';
import { listActiveStaff } from '@/lib/staff';

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
        <RoleSwitch current="staff" />

        <h1 className="mt-6 mb-6 text-center text-2xl font-black">
          店員登入
        </h1>

        <LoginForm staff={staff} role="staff" />
      </div>
    </Screen>
  );
}
