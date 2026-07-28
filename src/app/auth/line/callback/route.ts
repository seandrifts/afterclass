import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { consumeOAuthState, setUserSession } from '@/lib/session';
import { upsertLineUser } from '@/lib/users';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return redirectWithError(request, 'missing_params');
  }

  // state 比對防 CSRF，順便取回登入前要去的地方
  const stored = await consumeOAuthState(state);
  if (!stored) {
    return redirectWithError(request, 'bad_state');
  }

  try {
    const token = await exchangeCode(code);
    const profile = await fetchProfile(token.access_token);
    const user = await upsertLineUser(profile);

    if (user.is_blocked) {
      return redirectWithError(request, 'blocked');
    }

    await setUserSession(user.id);

    return NextResponse.redirect(new URL(stored.next, env.siteUrl));
  } catch {
    return redirectWithError(request, 'line_failed');
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

function redirectWithError(request: Request, reason: string) {
  const target = new URL('/login', env.siteUrl);
  target.searchParams.set('error', reason);
  return NextResponse.redirect(target);
}
