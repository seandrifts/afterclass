import 'server-only';

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

export async function setOAuthState(state: string, next: string) {
  const token = await sign({ state, next }, 600);
  (await cookies()).set(OAUTH_COOKIE, token, { ...baseCookie, maxAge: 600 });
}

export async function consumeOAuthState(
  state: string,
): Promise<{ next: string } | null> {
  const jar = await cookies();
  const raw = jar.get(OAUTH_COOKIE)?.value;
  jar.delete(OAUTH_COOKIE);

  if (!raw) return null;

  const payload = await verify<{ state: string; next: string }>(raw);
  if (!payload || payload.state !== state) return null;

  return { next: payload.next };
}
