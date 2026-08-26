import { redirect } from 'next/navigation';

import { LoginForm } from './login-form';
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
        {/*
          刻意不放通往後台的連結。後台入口是一段只有老闆知道的
          秘密網址，在這裡放切換鍵等於把它公告出來。
        */}
        <h1 className="mb-6 text-center text-2xl font-black">店員登入</h1>

        <LoginForm staff={staff} role="staff" />
      </div>
    </Screen>
  );
}
