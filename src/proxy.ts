import { NextResponse, type NextRequest } from 'next/server';

import {
  DEVICE_COOKIE,
  DEVICE_MAX_AGE,
  entryRole,
  isEnrolledDevice,
  looksLikeStaffSession,
  signDeviceToken,
} from '@/lib/entry';

/**
 * Next.js 16 把 middleware 慣例改名為 proxy，runtime 固定為 nodejs。
 *
 * 這裡做兩件事：
 *
 *   1. 入口金鑰比對（/enter/<金鑰>），對了就把這台裝置登記起來
 *   2. 店員端與後台只對「登記過的裝置」或「已登入的人」存在，
 *      其他人一律拿到 404，跟站上任何一個不存在的網址完全一樣
 *
 * 真正的權限驗證（帳號是否啟用、角色）仍然在頁面與 action 內做。
 * 這一層的目的是讓外人連登入頁都找不到。
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
    入口的金鑰比對。

    這件事本來在頁面裡用 notFound() 處理，但那樣狀態碼會是 200：
    頁面有靜態 metadata，head 先串流出去之後就改不了狀態碼了。
    畫面雖然不會渲染登入表單，但 200 與 404 的差異會告訴掃描者
    「/enter/ 是個真實存在的路由」，那段秘密路徑的意義就打折了。

    在 proxy 攔截可以在任何渲染發生前回傳真正的 404。
  */
  if (pathname.startsWith('/enter/')) {
    const key = pathname.slice('/enter/'.length).replace(/\/$/, '');

    if (!entryRole(key)) return notFound(request);

    const response = NextResponse.next();
    const token = await signDeviceToken();

    // 每次走入口都重簽一張，常用的裝置等於自動續期
    if (token) {
      response.cookies.set(DEVICE_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: DEVICE_MAX_AGE,
      });
    }
    return response;
  }

  const isStaffArea = pathname.startsWith('/staff');
  const isAdminArea = pathname.startsWith('/admin');

  if (!isStaffArea && !isAdminArea) return NextResponse.next();

  const enrolled = await isEnrolledDevice(
    request.cookies.get(DEVICE_COOKIE)?.value,
  );

  // 登入頁只看裝置。沒登記過的裝置不該知道這一頁存在
  if (pathname === '/staff/login') {
    return enrolled ? NextResponse.next() : notFound(request);
  }

  /*
    已經登入的人照常放行，就算裝置沒登記過。

    這條是為了上線當下還登入著的裝置：它們沒有裝置憑證，直接擋掉的話
    店員會在營業中突然看到 404。讓它用到這次登入到期為止，之後就得
    走一次入口網址。
  */
  const hasSession = await looksLikeStaffSession(
    request.cookies.get('ld_staff')?.value,
  );
  if (hasSession) return NextResponse.next();

  // 登記過的裝置導到登入頁；其他人看到的是「沒有這個網址」
  return enrolled
    ? NextResponse.redirect(new URL('/staff/login', request.url))
    : notFound(request);
}

/**
 * 回一個跟站上其他不存在網址一模一樣的 404。
 *
 * 不能自己回一個空的 404：正常打錯網址會看到站上的「找不到頁面」，
 * 空回應在瀏覽器裡是另一種錯誤畫面，兩者一比就知道這個網址被特別
 * 處理過。改寫到一個確定不存在的路徑，讓 Next 自己產生那一頁。
 */
function notFound(request: NextRequest) {
  return NextResponse.rewrite(new URL('/_/not-found', request.url));
}

export const config = {
  matcher: ['/staff/:path*', '/admin/:path*', '/enter/:path*'],
};
