import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { consumeOAuthState, setUserSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { upsertLineUser } from '@/lib/users';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // 客人在 LINE 的授權畫面按了取消
  const lineError = url.searchParams.get('error');
  if (lineError) {
    return redirectWithError(
      lineError === 'access_denied' ? 'cancelled' : 'line_failed',
    );
  }

  if (!code || !state) return redirectWithError('missing_params');

  const stored = await consumeOAuthState(state);
  if (!stored) return redirectWithError('bad_state');

  // 失敗時要能回到原本那組序號，不然客人重試也領不到獎
  const next = stored.next;

  try {
    const token = await exchangeCode(code);
    const profile = await fetchProfile(token.access_token);
    const user = await upsertLineUser(profile);

    if (user.is_blocked) return redirectWithError('blocked', next);

    await setUserSession(user.id);

    // cookie 遺失時仍然放行（見 consumeOAuthState 的說明），
    // 但留下紀錄。如果這個數字異常地高，代表有值得查的事
    if (!stored.bound) {
      await db()
        .from('audit_logs')
        .insert({
          actor_type: 'user',
          actor_id: user.id,
          action: 'login_unbound_state',
          target_type: 'user',
          target_id: user.id,
          detail: { reason: 'oauth state cookie 遺失，僅驗證簽章' },
        })
        .then(
          () => undefined,
          () => undefined, // 記錄失敗不該擋住登入
        );
    }

    return NextResponse.redirect(new URL(next, env.siteUrl));
  } catch {
    return redirectWithError('line_failed', next);
  }
}

async function exchangeCode(code: string): Promise<{ access_token: string }> {
  const res = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${env.siteUrl}/auth/line/callback`,
      client_id: env.lineChannelId(),
      client_secret: env.lineChannelSecret(),
    }),
  });

  if (!res.ok) throw new Error('LINE token exchange failed');
  return res.json();
}

async function fetchProfile(accessToken: string): Promise<{
  userId: string;
  displayName?: string;
  pictureUrl?: string;
}> {
  const res = await fetch('https://api.line.me/v2/profile', {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error('LINE profile fetch failed');
  return res.json();
}

/**
 * 導回登入頁。
 *
 * 一定要把 next 帶回去。客人抽完獎在登入時失敗，如果這裡把返回位置
 * 弄丟了，他重新登入之後會被丟到錢包頁，那組已經抽出結果的序號
 * 就領不到了。
 */
function redirectWithError(reason: string, next?: string) {
  const target = new URL('/login', env.siteUrl);
  target.searchParams.set('error', reason);
  if (next) target.searchParams.set('next', next);
  return NextResponse.redirect(target);
}
