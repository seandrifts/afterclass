import 'server-only';

import { db } from './supabase';

const PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

function token(): string {
  const value = process.env.LINE_MESSAGING_TOKEN;
  if (!value) throw new Error('缺少 LINE_MESSAGING_TOKEN');
  return value;
}

export type PushOutcome =
  | { ok: true }
  | { ok: false; unreachable: boolean; error: string };

/**
 * 推播一則訊息給指定使用者。
 *
 * 403 代表客人封鎖了官方帳號或根本沒加好友。這種情況要標記起來
 * 不再重試，否則每天的排程都會浪費一次額度去撞同一道牆。
 */
export async function pushMessage(
  lineUserId: string,
  messages: unknown[],
): Promise<PushOutcome> {
  let res: Response;

  try {
    res = await fetch(PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify({ to: lineUserId, messages }),
    });
  } catch (e) {
    return {
      ok: false,
      unreachable: false,
      error: e instanceof Error ? e.message : '網路錯誤',
    };
  }

  if (res.ok) return { ok: true };

  const body = await res.text();

  return {
    ok: false,
    // 403 = 對方封鎖或未加好友，重試沒有意義
    unreachable: res.status === 403,
    error: `HTTP ${res.status} ${body.slice(0, 200)}`,
  };
}

/** 本月剩餘額度。免費方案每月 200 則 */
export async function fetchQuota(): Promise<{
  limit: number | null;
  used: number;
} | null> {
  try {
    const headers = { authorization: `Bearer ${token()}` };

    const [quotaRes, usageRes] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers }),
    ]);

    if (!quotaRes.ok || !usageRes.ok) return null;

    const quota = await quotaRes.json();
    const usage = await usageRes.json();

    return {
      limit: quota.type === 'limited' ? quota.value : null,
      used: usage.totalUsage ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * 到期提醒的訊息內容。
 *
 * 三個刻意的措辭選擇：
 *
 * 1. 說「來店消費即可延長」而不是「快來把點數花掉」。前者是給客人
 *    好處，後者是催促，讀起來像在追債
 * 2. 點數與金額並列。「470 點」有份量感，「可折抵 47 元」才具體
 * 3. 附上錢包連結。客人不用回想自己有多少，點開就看得到
 */
export function expiryWarningMessage(params: {
  shopName: string;
  points: number;
  dollars: number;
  days: number;
  usePoints: boolean;
  walletUrl: string;
  extendDays: number;
}) {
  const amount = params.usePoints
    ? `${params.points} 點（可折抵 ${params.dollars} 元）`
    : `${params.dollars} 元`;

  const deadline =
    params.days <= 0 ? '今天就要到期了' : `還有 ${params.days} 天就要到期了`;

  return [
    {
      type: 'text',
      text:
        `${params.shopName}\n\n` +
        `你的回饋點數 ${amount}\n` +
        `${deadline}\n\n` +
        `來店消費或使用點數，\n` +
        `有效期會自動延長 ${params.extendDays} 天\n\n` +
        `查看我的點數 👉 ${params.walletUrl}`,
    },
  ];
}

/** 推播被拒時標記，之後的排程就會跳過這個人 */
export async function markUnreachable(userId: string) {
  await db()
    .from('users')
    .update({ line_unreachable_at: new Date().toISOString() })
    .eq('id', userId);
}

/** 推播成功代表對方又加回來了，把標記清掉 */
export async function clearUnreachable(userId: string) {
  await db()
    .from('users')
    .update({ line_unreachable_at: null })
    .eq('id', userId);
}
