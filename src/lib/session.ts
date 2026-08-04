import 'server-only';

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

import { env } from './env';

const USER_COOKIE = 'ld_user';
const STAFF_COOKIE = 'ld_staff';

const USER_MAX_AGE = 60 * 60 * 24 * 180; // 半年。客人不該常常被登出
const STAFF_MAX_AGE = 60 * 60 * 12; // 一個班次。共用裝置不宜長期保持登入

function secret(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret());
}

async function sign(payload: Record<string, unknown>, maxAge: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(secret());
}

async function verify<T>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as T;
  } catch {
    return null;
  }
}

const baseCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

// ---------------------------------------------------------------
// 客人
// ---------------------------------------------------------------

export interface UserSession {
  uid: string;
}

export async function setUserSession(userId: string) {
  const token = await sign({ uid: userId }, USER_MAX_AGE);
  (await cookies()).set(USER_COOKIE, token, {
    ...baseCookie,
    maxAge: USER_MAX_AGE,
  });
}

export async function getUserSession(): Promise<UserSession | null> {
  const raw = (await cookies()).get(USER_COOKIE)?.value;
  if (!raw) return null;
  return verify<UserSession>(raw);
}

export async function clearUserSession() {
  (await cookies()).delete(USER_COOKIE);
}

// ---------------------------------------------------------------
// 店員 / 老闆
// ---------------------------------------------------------------

export interface StaffSession {
  sid: string;
  name: string;
  role: 'staff' | 'owner';
}

export async function setStaffSession(s: StaffSession) {
  const token = await sign({ ...s }, STAFF_MAX_AGE);
  (await cookies()).set(STAFF_COOKIE, token, {
    ...baseCookie,
    maxAge: STAFF_MAX_AGE,
  });
}

export async function getStaffSession(): Promise<StaffSession | null> {
  const raw = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!raw) return null;
  return verify<StaffSession>(raw);
}

export async function clearStaffSession() {
  (await cookies()).delete(STAFF_COOKIE);
}

/**
 * OAuth state。防 CSRF，並記住登入前想去的地方。
 *
 * 抽獎流程是「先抽獎後登入」，所以登入完成後必須回到原本那組序號
 * 才能領取獎品。這個 next 就是用來記住 /d/XXXX 的。
 */
const OAUTH_COOKIE = 'ld_oauth';
const OAUTH_TTL = 900;

/**
 * 建立授權用的 state。
 *
 * 回傳的字串會放進 OAuth 的 state 參數，LINE 授權完成後原封不動送回來。
 * 內容是一個簽了名的 JWT，帶著 nonce 與登入後要回去的位置。
 *
 * 為什麼不像以前那樣把 next 只存在 cookie 裡：
 *
 * LINE 的內建瀏覽器（客人從 LINE 聊天室點連結進來時就是這個）在
 * 完成授權後，經常會回到一個全新的 webview，原本設下的 cookie 就不見了。
 * 一旦 cookie 消失，舊的實作會同時失去 CSRF 綁定與返回目的地，
 * 客人就會看到「登入連結已失效」而且回不到原本那組抽獎序號。
 *
 * 把資料放進 state 之後，就算 cookie 掉了也還原得回來。cookie 仍然
 * 會設，但降級成「有就檢查、沒有也能過」的額外綁定。
 */
export async function createOAuthState(next: string): Promise<string> {
  const nonce = randomBytes(16).toString('hex');
  const state = await sign({ n: nonce, next }, OAUTH_TTL);

  (await cookies()).set(OAUTH_COOKIE, nonce, {
    ...baseCookie,
    maxAge: OAUTH_TTL,
  });

  return state;
}

export interface OAuthStateResult {
  next: string;
  /**
   * cookie 是否成功比對。
   *
   * true  = 完整的 CSRF 保護
   * false = cookie 遺失（多半是 LINE 內建瀏覽器），只驗證了簽章。
   *         簽章仍然擋得住偽造的 state，攻擊者無法自己生一個出來，
   *         但擋不住「誘導受害者用攻擊者的授權碼登入」這種情境。
   *         以本站的風險（點數會進錯帳戶）權衡，讓客人登不進去
   *         的代價更高，所以選擇放行並記錄下來。
   */
  bound: boolean;
}

export async function consumeOAuthState(
  state: string,
): Promise<OAuthStateResult | null> {
  const payload = await verify<{ n: string; next: string }>(state);

  // 簽章不符或已過期一律擋下，這是不可退讓的部分
  if (!payload?.n || typeof payload.next !== 'string') return null;

  const jar = await cookies();
  const nonce = jar.get(OAUTH_COOKIE)?.value;
  jar.delete(OAUTH_COOKIE);

  return { next: payload.next, bound: nonce === payload.n };
}
