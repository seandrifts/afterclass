import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { createOAuthState } from '@/lib/session';

/**
 * 導向 LINE 授權頁。
 *
 * next 參數記住登入前要回去的地方。抽獎流程是「先抽獎後登入」，
 * 登入完成後必須回到原本那組序號才能領取獎品。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));

  const state = await createOAuthState(next);

  const authorize = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.lineChannelId());
  authorize.searchParams.set(
    'redirect_uri',
    `${env.siteUrl}/auth/line/callback`,
  );
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('scope', 'profile openid');

  return NextResponse.redirect(authorize);
}

/**
 * 只接受站內相對路徑。
 *
 * 不擋的話，`?next=https://evil.example` 會讓這個端點變成開放轉址，
 * 可以拿去做釣魚。
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/wallet';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/wallet';
  return raw;
}
