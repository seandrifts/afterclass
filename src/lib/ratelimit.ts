import 'server-only';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';

/**
 * 記憶體版 rate limit。
 *
 * 對一間小吃店的流量而言這完全夠用，也省掉一個 Redis 依賴。
 * 限制是 serverless 環境下每個 instance 各自計數，所以實際容許量
 * 會是設定值乘上 instance 數。對「防暴力猜序號」這個目的來說，
 * 就算放寬幾倍仍然遠比沒有好。
 *
 * 如果之後流量成長到需要精確控管，換成 Upstash Redis 即可，
 * 呼叫端介面不用改。
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

// 避免長時間執行的 instance 無限累積 key
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export function hit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  return { ok: true, retryAfterSec: 0 };
}

/**
 * 取得請求來源 IP 的雜湊。
 *
 * 存雜湊而非原始 IP：IP 屬於個資，而我們只需要「能不能區分不同來源」
 * 這個能力，不需要知道實際位址。
 */
export async function clientIpHash(): Promise<string> {
  const h = await headers();
  const raw =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip') ??
    'unknown';

  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}
