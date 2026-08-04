import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { consumeOAuthState, setUserSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { upsertLineUser } from '@/lib/users';

/**
 * 診斷紀錄。
 *
 * 原本只有「成功但 cookie 遺失」會留紀錄，失敗完全沒有伺服器端痕跡，
 * 客人回報登不進去時只能靠猜。現在每一種失敗都記下發生在哪一步，
 * 後台的 audit log 就能直接指出問題。
 *
 * 刻意不記錄 code、access token、state 的內容，那些是憑證。
 * 只記錄「有沒有」與「哪一步失敗」。
 */
async function trace(
  step: string,
  detail: Record<string, unknown>,
  userId?: string,
) {
  try {
    await db().from('audit_logs').insert({
      actor_type: userId ? 'user' : 'system',
      actor_id: userId ?? null,
      action: `login_${step}`,
      target_type: 'login',
      detail,
    });
  } catch {
    // 記錄失敗不該擋住登入流程
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // LINE 端就先失敗了（客人按取消、Channel 未發布、權限不足⋯）
  const lineError = url.searchParams.get('error');
  if (lineError) {
    await trace('rejected_by_line', {
      error: lineError,
      description: url.searchParams.get('error_description'),
      提示:
        lineError === 'access_denied'
          ? '客人按了取消，或 Channel 還在 Developing 狀態只允許管理員登入'
          : 'LINE 端拒絕了這次授權',
    });
    return redirectWithError(
      lineError === 'access_denied' ? 'cancelled' : 'line_failed',
    );
  }

  if (!code || !state) {
    await trace('missing_params', {
      有code: Boolean(code),
      有state: Boolean(state),
    });
    return redirectWithError('missing_params');
  }

  const stored = await consumeOAuthState(state);
  if (!stored) {
    await trace('bad_state', {
      提示: 'state 簽章驗證失敗或已過期。可能是 SESSION_SECRET 變更過，或超過 15 分鐘',
    });
    return redirectWithError('bad_state');
  }

  const next = stored.next;

  let profile: Awaited<ReturnType<typeof fetchProfile>>;

  try {
    const token = await exchangeCode(code);
    profile = await fetchProfile(token.access_token);
  } catch (e) {
    await trace('line_api_failed', {
      訊息: e instanceof Error ? e.message : String(e),
      提示: '向 LINE 換 token 或取 profile 失敗。檢查 Channel secret 與 Callback URL',
    });
    return redirectWithError('line_failed', next);
  }

  try {
    const user = await upsertLineUser(profile);

    if (user.is_blocked) {
      await trace('blocked', {}, user.id);
      return redirectWithError('blocked', next);
    }

    await setUserSession(user.id);

    await trace(
      'success',
      {
        新帳號: user.visit_count === 0 && user.balance === 0,
        cookie綁定: stored.bound,
        返回: next,
      },
      user.id,
    );

    return NextResponse.redirect(new URL(next, env.siteUrl));
  } catch (e) {
    await trace('user_upsert_failed', {
      訊息: e instanceof Error ? e.message : String(e),
      提示: '建立或更新會員資料失敗，多半是資料庫問題',
    });
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

  if (!res.ok) {
    // LINE 的錯誤訊息很具體，直接帶進紀錄裡才查得出原因
    const body = await res.text();
    throw new Error(`token 交換失敗 HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`profile 取得失敗 HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

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
