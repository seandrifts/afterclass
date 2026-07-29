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

  // 兩個登入頁本身不能被擋，否則會無限轉址
  const isLoginPage =
    pathname === '/staff/login' || pathname === '/admin/login';
  if (isLoginPage) return NextResponse.next();

  const isStaffArea = pathname.startsWith('/staff');
  const isAdminArea = pathname.startsWith('/admin');

  if (!isStaffArea && !isAdminArea) return NextResponse.next();

  if (!request.cookies.get('ld_staff')) {
    // 未登入時導到對應的登入頁，讓老闆不用先進店員頁再切過去
    const target = isAdminArea ? '/admin/login' : '/staff/login';
    return NextResponse.redirect(new URL(target, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/staff/:path*', '/admin/:path*'],
};
