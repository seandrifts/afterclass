import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/*
  入口金鑰與裝置登記。

  proxy 也要用這個檔，所以不能引用 next/headers 或任何 server-only 的
  模組，只碰 process.env 與純運算。

  ── 為什麼登入頁要藏起來

  登入頁會列出帳號，而鎖定機制是照帳號算的：任何人只要打得開登入頁，
  就能一邊猜 PIN、一邊把店員鎖在門外。把登入頁放在一段猜不到的網址
  後面，外人連帳號是誰都看不到，也就無從下手。

  ── 為什麼還要「登記裝置」

  只藏網址的話，店員的登入每 12 小時到期一次，到期後會被導回登入頁，
  那個網址就得是固定、公開的。所以改成：用秘密網址打開過一次的裝置，
  會拿到一張長效的裝置憑證（cookie），之後 /staff/login 只對有憑證的
  裝置存在，其他人看到的是 404。店裡的 iPad 掃一次入口就好，平常
  到期重新登入不用再找那串網址。
*/

export const DEVICE_COOKIE = 'ld_device';

/** 一年。店裡的裝置不會常換，太短只會讓店員一直找入口網址 */
export const DEVICE_MAX_AGE = 60 * 60 * 24 * 365;

function sessionKey(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  return secret ? new TextEncoder().encode(secret) : null;
}

/**
 * 店員入口的金鑰。
 *
 * 有設 STAFF_ENTRY_KEY 就用它；沒設的話從 SESSION_SECRET 推導一組，
 * 這樣不必多設一個環境變數也能用。推導是單向的，知道這組金鑰推不回
 * SESSION_SECRET。
 *
 * 換掉 SESSION_SECRET 會讓推導出來的網址跟著變，已登記的裝置也會
 * 全部失效。想讓網址固定不受影響，就明確設定 STAFF_ENTRY_KEY。
 */
export function staffEntryKey(): string | null {
  const explicit = process.env.STAFF_ENTRY_KEY?.trim();
  if (explicit) return explicit;

  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  return createHmac('sha256', secret)
    .update('staff-entry-v1')
    .digest('hex')
    .slice(0, 24);
}

export function adminEntryKey(): string | null {
  return process.env.ADMIN_ENTRY_KEY?.trim() || null;
}

/** 定時比對。先雜湊成等長再比，長度本身也不會從回應時間洩漏 */
function sameKey(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** 這段網址上的金鑰對應哪一種入口。對不上回 null */
export function entryRole(key: string): 'owner' | 'staff' | null {
  const admin = adminEntryKey();
  const staff = staffEntryKey();

  // 兩個都比完才回傳，不因為先比中哪一個而有時間差
  const isAdmin = admin ? sameKey(key, admin) : false;
  const isStaff = staff ? sameKey(key, staff) : false;

  if (isAdmin) return 'owner';
  if (isStaff) return 'staff';
  return null;
}

export async function signDeviceToken(): Promise<string | null> {
  const key = sessionKey();
  if (!key) return null;

  return new SignJWT({ typ: 'device' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${DEVICE_MAX_AGE}s`)
    .sign(key);
}

/**
 * 這個裝置有沒有用入口網址登記過。
 *
 * 一定要檢查 typ。客人的登入 cookie 也是同一把金鑰簽的，只驗簽章的話
 * 任何一位會員都能把自己的 cookie 改個名字當成裝置憑證。
 */
export async function isEnrolledDevice(token?: string): Promise<boolean> {
  const key = sessionKey();
  if (!token || !key) return false;

  try {
    const { payload } = await jwtVerify(token, key);
    return payload.typ === 'device';
  } catch {
    return false;
  }
}

/** proxy 用的粗篩：這張店員 cookie 是不是我們簽的、而且確實是店員的 */
export async function looksLikeStaffSession(token?: string): Promise<boolean> {
  const key = sessionKey();
  if (!token || !key) return false;

  try {
    const { payload } = await jwtVerify(token, key);
    return typeof payload.sid === 'string';
  } catch {
    return false;
  }
}
