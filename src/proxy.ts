import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 把 middleware 慣例改名為 proxy，runtime 固定為 nodejs。
 *
 * 這裡只做「有沒有 cookie」的粗篩，把未登入的人擋在門外少打一次資料庫。
 * 真正的權限驗證（簽章、角色）一律在頁面與 action 內做，因為
 * cookie 存在不代表有效，光靠這層擋是不夠的。
 *
 * 例外是後台入口的金鑰比對：那個必須在這裡做，理由見下方。
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
    後台入口的金鑰比對。

    這件事本來在頁面裡用 notFound() 處理，但那樣狀態碼會是 200：
    頁面有靜態 metadata，head 先串流出去之後就改不了狀態碼了。
    畫面雖然不會渲染登入表單，但 200 與 404 的差異會告訴掃描者
    「/enter/ 是個真實存在的路由」，那段秘密路徑的意義就打折了。

    在 proxy 攔截可以在任何渲染發生前回傳真正的 404，
    跟站上任何一個不存在的網址完全一樣。
  */
  if (pathname.startsWith('/enter/')) {
    const key = pathname.slice('/enter/'.length).replace(/\/$/, '');
    const expected = process.env.ADMIN_ENTRY_KEY;

    if (!expected || !safeEqual(key, expected)) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }

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

/**
 * 定時比對。
 *
 * 一般的字串比較會在第一個不同的字元就返回，回應時間的細微差異
 * 理論上可以被用來逐字元推測金鑰。這裡不管內容是否相同都跑完全程。
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const config = {
  matcher: ['/staff/:path*', '/admin/:path*', '/enter/:path*'],
};
