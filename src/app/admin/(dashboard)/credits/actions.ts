'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/auth-guard';
import { db } from '@/lib/supabase';
import { getUserByWalletCode } from '@/lib/users';

const SINGLE_ADJUST_CAP = 500;

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
