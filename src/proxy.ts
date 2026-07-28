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

  const isStaffArea =
    pathname.startsWith('/staff') && !pathname.startsWith('/staff/login');
  const isAdminArea = pathname.startsWith('/admin');

  if (!isStaffArea && !isAdminArea) return NextResponse.next();

  if (!request.cookies.get('ld_staff')) {
    const login = new URL('/staff/login', request.url);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/staff/:path*', '/admin/:path*'],
};
