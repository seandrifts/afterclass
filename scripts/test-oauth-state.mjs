/**
 * OAuth state 的回歸測試。
 *
 *   node --env-file=.env.local scripts/test-oauth-state.mjs
 *
 * 守的是一個真的發生過的問題：客人從 LINE 聊天室點進來（LINE 內建
 * 瀏覽器），授權完成後回到全新的 webview，cookie 不見了，於是
 * 「登入連結已失效」，而且回不到原本抽獎的那組序號。
 *
 * 這裡直接驗 session.ts 用的那套簽章邏輯，重現三種情境。
 */
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';

const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
if (!process.env.SESSION_SECRET) {
  console.error('缺少 SESSION_SECRET');
  process.exit(1);
}

let failed = 0;
const ok = (m, d = '') => console.log(`  ✓ ${m}${d ? `  ${d}` : ''}`);
const bad = (m, d = '') => {
  failed += 1;
  console.log(`  ✗ ${m}${d ? `  ${d}` : ''}`);
};

const sign = (payload, ttl) =>
  new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secret);

async function consume(state, cookieNonce) {
  let payload;
  try {
    payload = (await jwtVerify(state, secret)).payload;
  } catch {
    return null;
  }
  if (!payload?.n || typeof payload.next !== 'string') return null;
  return { next: payload.next, bound: cookieNonce === payload.n };
}

console.log('\nOAuth state');

// 正常瀏覽器：cookie 存活
{
  const nonce = randomBytes(16).toString('hex');
  const state = await sign({ n: nonce, next: '/d/A7K2M9P4' }, 900);
  const r = await consume(state, nonce);

  r?.next === '/d/A7K2M9P4'
    ? ok('一般瀏覽器：取回返回位置', r.next)
    : bad('取不回返回位置', JSON.stringify(r));
  r?.bound ? ok('一般瀏覽器：cookie 綁定成立') : bad('cookie 應該要綁定成功');
}

// LINE 內建瀏覽器：cookie 遺失（客人實際遇到的情境）
{
  const nonce = randomBytes(16).toString('hex');
  const state = await sign({ n: nonce, next: '/d/A7K2M9P4' }, 900);
  const r = await consume(state, undefined);

  r?.next === '/d/A7K2M9P4'
    ? ok('cookie 遺失：仍取得返回位置', r.next)
    : bad('cookie 遺失時應該仍能取回返回位置', JSON.stringify(r));
  r && r.bound === false
    ? ok('cookie 遺失：標記為未綁定')
    : bad('應標記為未綁定');
}

// 偽造的 state 必須被擋下
{
  const forged = await new SignJWT({ n: 'x'.repeat(32), next: '/wallet' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('900s')
    .sign(new TextEncoder().encode('a-completely-different-secret-key-32b'));

  (await consume(forged, undefined)) === null
    ? ok('別的金鑰簽的 state 被擋下')
    : bad('偽造的 state 竟然通過了');
}

// 過期的 state 必須被擋下
{
  const nonce = randomBytes(16).toString('hex');
  const expired = await new SignJWT({ n: nonce, next: '/wallet' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(secret);

  (await consume(expired, nonce)) === null
    ? ok('過期的 state 被擋下')
    : bad('過期的 state 竟然通過了');
}

// 亂填的字串
{
  (await consume('not-a-jwt', undefined)) === null
    ? ok('非 JWT 的字串被擋下')
    : bad('亂填的字串竟然通過了');
}

// 長度要在網址可接受的範圍
{
  const state = await sign(
    { n: randomBytes(16).toString('hex'), next: '/d/ABCDEFGH' },
    900,
  );
  state.length < 500
    ? ok('state 長度合理', `${state.length} 字元`)
    : bad('state 太長，可能超出網址限制', `${state.length}`);
}

console.log(failed === 0 ? '\n全部通過。\n' : `\n有 ${failed} 項失敗。\n`);
process.exit(failed === 0 ? 0 : 1);
