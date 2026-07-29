import 'server-only';

import { redirect } from 'next/navigation';

import { getStaffSession, type StaffSession } from './session';

/** 需要店員身分。proxy 只做粗篩，真正的驗證在這裡 */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect('/staff/login');
  return session;
}

/**
 * 需要老闆身分。
 *
 * 店員看不到成本、機率、報表與會員名單。那些是商業機密，
 * 而且店員知道機率之後可以幫親友挑時機。
 *
 * 未登入導到後台登入頁（而不是店員登入頁），已登入但不是老闆
 * 則導回店員端，不告訴他後台長什麼樣子。
 */
export async function requireOwner(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect('/admin/login');
  if (session.role !== 'owner') redirect('/staff');
  return session;
}
