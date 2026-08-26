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
 * 未登入一律導到店員登入頁，不導向後台入口。後台的網址帶一段
 * 秘密字串（見 /enter/[key]），如果這裡把它轉出去，等於自己
 * 把入口公告出來。老闆用書籤進入。
 */
export async function requireOwner(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) redirect('/staff/login');
  if (session.role !== 'owner') redirect('/staff');
  return session;
}
