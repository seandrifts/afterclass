import { NextResponse } from 'next/server';
import { z } from 'zod';

import { generateRedeemCode, normalizeCode } from '@/lib/codes';
import { getUserSession } from '@/lib/session';
import { db } from '@/lib/supabase';

const bodySchema = z.object({ code: z.string().min(1).max(32) });

/**
 * 登入後領取中獎結果。
 *
 * 依獎項類型分流：
 *   credit → 進 users.balance 並寫一筆 ledger，不產生券
 *   其他   → 產生一張 coupons，快照中獎當下的獎項內容
 *
 * 兩條路都在 claim_token() 這個 Postgres function 裡的同一個
 * transaction 完成，不會出現「token 標記已領取但錢沒進去」的狀態。
 */
export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const code = normalizeCode(parsed.data.code);

  const { data, error } = await db()
    .rpc('claim_token', {
      p_code: code,
      p_user_id: session.uid,
      p_redeem_code: generateRedeemCode(),
    })
    .single<{
      ok: boolean;
      reason: string | null;
      prize_type: string | null;
      credit_added: number | null;
      new_balance: number | null;
      coupon_id: string | null;
    }>();

  if (error) {
    return NextResponse.json({ error: 'CLAIM_FAILED' }, { status: 500 });
  }

  if (!data?.ok) {
    return NextResponse.json(
      { error: data?.reason ?? 'CLAIM_FAILED' },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    prizeType: data.prize_type,
    creditAdded: data.credit_added,
    newBalance: data.new_balance,
    couponId: data.coupon_id,
  });
}
