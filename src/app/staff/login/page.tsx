import { redirect } from 'next/navigation';

import { LoginForm } from './login-form';
import { getStaffSession } from '@/lib/session';
import { listActiveStaff } from '@/lib/staff';
import { Screen } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function StaffLoginPage() {
  const session = await getStaffSession();
  if (session) redirect('/staff');

  const staff = await listActiveStaff();

  return (
    <Screen>
      <div className="flex flex-1 flex-col justify-center">
        <h1 className="mb-6 text-center text-2xl font-black">店員登入</h1>
        <LoginForm staff={staff} />
      </div>
    </Screen>
  );
}
