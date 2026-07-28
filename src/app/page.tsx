import { redirect } from 'next/navigation';

import { getUserSession } from '@/lib/session';

/**
 * 首頁沒有獨立內容。客人只會透過掃 QR（/d/[code]）或書籤（/wallet）進來，
 * 所以直接依登入狀態導向對的地方。
 */
export default async function Home() {
  const session = await getUserSession();
  redirect(session ? '/wallet' : '/login');
}
