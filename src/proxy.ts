import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 把 middleware 慣例改名為 proxy，runtime 固定為 nodejs。
 *
 * 這裡只做「有沒有 cookie」的粗篩，把未登入的人擋在門外少打一次資料庫。
 * 真正的權限驗證（簽章、角色）一律在頁面與 action 內做，因為
 * cookie 存在不代表有效，光靠這層擋是不夠的。
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 登入頁本身不能被擋，否則會無限轉址
  if (pathname === '/staff/login') return NextResponse.next();

  const isStaffArea = pathname.startsWith('/staff');
  const isAdminArea = pathname.startsWith('/admin');

  if (!isStaffArea && !isAdminArea) return NextResponse.next();

  if (!request.cookies.get('ld_staff')) {
    // 一律導到店員登入頁。後台入口是秘密網址，不能從這裡透露出去
    return NextResponse.redirect(new URL('/staff/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/staff/:path*', '/admin/:path*'],
};
