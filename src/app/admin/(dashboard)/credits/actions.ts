'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/auth-guard';
import { generateDynamicCode, generateRedeemCode } from '@/lib/codes';
import { toSnapshot } from '@/lib/draw';
import { db } from '@/lib/supabase';
import { getUserByWalletCode } from '@/lib/users';
import type { Prize } from '@/lib/types';

const SINGLE_ADJUST_CAP = 500;

/** 送出面額超過這個數字的獎項要二次確認 */
const GRANT_CONFIRM_ABOVE = 20;

/**
 * 人工調整餘額。
 *
 * 一律走 adjust_balance() 這個 Postgres function，絕不直接
 * update users set balance。繞過 ledger 直接改餘額，會讓
 * check_balance_integrity() 失敗，而且那筆錢查不出去向。
 * 這是整份規格裡最不能妥協的一條。
 */
export async function adjustAction(_prev: unknown, formData: FormData) {
  const owner = await requireOwner();

  const walletCode = String(formData.get('walletCode') ?? '')
    .trim()
    .toUpperCase();
  const direction = String(formData.get('direction') ?? 'add');
  const magnitude = Number(formData.get('amount') ?? 0);
  const note = String(formData.get('note') ?? '').trim();
  const confirmed = formData.get('confirmed') === 'true';

  if (!walletCode) return { error: '請輸入會員碼' };
  if (!note) return { error: '請填寫調整原因' };
  if (!Number.isInteger(magnitude) || magnitude <= 0) {
    return { error: '金額不正確' };
  }

  // 防手滑多打一個零
  if (magnitude > SINGLE_ADJUST_CAP && !confirmed) {
    return {
      needsConfirm: true,
      error: `單次調整 ${magnitude} 元超過 ${SINGLE_ADJUST_CAP} 元，請再確認一次金額是否正確。`,
    };
  }

  const user = await getUserByWalletCode(walletCode);
  if (!user) return { error: '查不到這組會員碼' };

  const amount = direction === 'subtract' ? -magnitude : magnitude;

  const { data, error } = await db()
    .rpc('adjust_balance', {
      p_user_id: user.id,
      p_amount: amount,
      p_staff_id: owner.sid,
      p_note: note,
    })
    .single<{ new_balance: number; txn_id: string }>();

  if (error) {
    if (error.message.includes('INSUFFICIENT_BALANCE')) {
      return { error: `扣除後餘額會變成負數。目前餘額 ${user.balance} 元。` };
    }
    if (error.message.includes('NOTE_REQUIRED')) {
      return { error: '請填寫調整原因' };
    }
    return { error: '調整失敗' };
  }

  await db().from('audit_logs').insert({
    actor_type: 'staff',
    actor_id: owner.sid,
    action: 'adjust_balance',
    target_type: 'user',
    target_id: user.id,
    detail: { amount, note, new_balance: data.new_balance },
  });

  revalidatePath('/admin/credits');

  return {
    saved: true,
    message: `${user.display_name ?? '會員'} 的餘額已調整為 ${data.new_balance} 元`,
  };
}

export type GrantResult =
  | { error: string; needsConfirm?: boolean }
  | { saved: true; message: string; redeemCode: string | null };

/**
 * 指定獎項直接送給客人。
 *
 * 辦活動時用：不抽，直接把某個獎品放進客人的錢包，他之後再來換。
 *
 * 刻意放在後台而不是店員端。店員原本只能發動「隨機抽」，期望成本
 * 三塊多；能指定獎項的話就等於可以隨意送出免單（面額 150），濫用的
 * 天花板差了四十倍。活動是老闆在辦的，這個權限跟著老闆走。
 *
 * 走的是跟抽獎完全相同的路徑 —— 開一張 token、commit_draw 指定獎項、
 * claim_token 入帳。所以庫存會扣、快照會存、報表與流水帳都算得到，
 * 不會變成一筆帳面上找不到來源的錢。
 */
export async function grantPrizeAction(
  _prev: unknown,
  formData: FormData,
): Promise<GrantResult> {
  const owner = await requireOwner();

  const walletCode = String(formData.get('walletCode') ?? '')
    .trim()
    .toUpperCase();
  const prizeId = String(formData.get('prizeId') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  const confirmed = formData.get('confirmed') === 'true';

  if (!walletCode) return { error: '請輸入會員碼' };
  if (!prizeId) return { error: '請選擇要送出的獎項' };
  if (!note) return { error: '請填寫原因，之後對帳才知道這筆是哪個活動' };

  const user = await getUserByWalletCode(walletCode);
  if (!user) return { error: '查不到這組會員碼' };
  if (user.is_blocked) return { error: '這個帳號已被停用' };

  const { data: prize } = await db()
    .from('prizes')
    .select('*')
    .eq('id', prizeId)
    .maybeSingle();

  if (!prize) return { error: '找不到這個獎項' };

  // 高面額的要再確認一次。送錯免單跟送錯一元的代價差很多
  if (prize.face_value > GRANT_CONFIRM_ABOVE && !confirmed) {
    return {
      needsConfirm: true,
      error: `「${prize.name}」面額 ${prize.face_value} 元，請確認是要送給「${user.display_name ?? '這位會員'}」。`,
    };
  }

  const code = generateDynamicCode();
  const { error: tokenError } = await db().from('draw_tokens').insert({
    code,
    kind: 'dynamic',
    status: 'active',
    issued_by: owner.sid,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120_000).toISOString(),
  });

  if (tokenError) return { error: '建立失敗，請再試一次' };

  const { data: drawn, error: drawError } = await db()
    .rpc('commit_draw', {
      p_code: code,
      p_prize_id: prize.id,
      p_snapshot: toSnapshot(prize as Prize),
      p_ip_hash: null,
    })
    .single<{ ok: boolean; reason: string | null }>();

  if (drawError || !drawn?.ok) {
    return {
      error:
        drawn?.reason === 'PRIZE_OUT_OF_STOCK'
          ? `「${prize.name}」的庫存已經發完了`
          : '建立失敗，請再試一次',
    };
  }

  const redeemCode = generateRedeemCode();
  const { data: claim, error: claimError } = await db()
    .rpc('claim_token', {
      p_code: code,
      p_user_id: user.id,
      p_redeem_code: redeemCode,
    })
    .single<{
      ok: boolean;
      credit_added: number | null;
      new_balance: number | null;
      coupon_id: string | null;
    }>();

  if (claimError || !claim?.ok) {
    return { error: '獎項已扣庫存但入帳失敗，請重新整理確認後再處理' };
  }

  await db().from('audit_logs').insert({
    actor_type: 'staff',
    actor_id: owner.sid,
    action: 'grant_prize',
    target_type: 'user',
    target_id: user.id,
    detail: {
      prize: prize.name,
      face_value: prize.face_value,
      cost: prize.cost,
      note,
    },
  });

  revalidatePath('/admin/credits');

  return {
    saved: true,
    message: claim.credit_added
      ? `已送出「${prize.name}」，${user.display_name ?? '會員'} 目前 ${claim.new_balance} 元`
      : `已送出「${prize.name}」給 ${user.display_name ?? '會員'}`,
    redeemCode: claim.coupon_id ? redeemCode : null,
  };
}
