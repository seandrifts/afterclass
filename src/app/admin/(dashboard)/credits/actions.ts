'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/auth-guard';
import { grantPrize } from '@/lib/grant';
import { db } from '@/lib/supabase';
import { getUserByWalletCode } from '@/lib/users';

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

  // 老闆在後台送不設面額上限。上限是給店員端的
  const outcome = await grantPrize({
    walletCode: String(formData.get('walletCode') ?? ''),
    prizeId: String(formData.get('prizeId') ?? ''),
    note: String(formData.get('note') ?? ''),
    actorId: owner.sid,
    confirmed: formData.get('confirmed') === 'true',
    confirmAbove: GRANT_CONFIRM_ABOVE,
    maxFaceValue: null,
  });

  if (!outcome.ok) {
    return { error: outcome.error, needsConfirm: outcome.needsConfirm };
  }

  revalidatePath('/admin/credits');

  return {
    saved: true,
    message: outcome.message,
    redeemCode: outcome.redeemCode,
  };
}
