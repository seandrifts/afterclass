'use server';

import { revalidatePath } from 'next/cache';

import { generateCardCode } from '@/lib/codes';
import { requireOwner } from '@/lib/auth-guard';
import { getSettings } from '@/lib/settings';
import { db } from '@/lib/supabase';

/**
 * 產生一批序號。
 *
 * 全部預設 inactive。要另外按啟用才能用，這樣整疊卡被偷的損失
 * 上限就是「已啟用未使用」的數量，而不是整批。
 */
export async function createBatchAction(_prev: unknown, formData: FormData) {
  await requireOwner();

  const name = String(formData.get('name') ?? '').trim();
  const quantity = Number(formData.get('quantity') ?? 0);
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!name) return { error: '請填寫批次名稱' };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5000) {
    return { error: '數量請填 1 到 5000 之間' };
  }

  const settings = await getSettings();

  const { data: batch, error } = await db()
    .from('token_batches')
    .insert({ name, quantity, note })
    .select('id')
    .single();

  if (error) return { error: '建立批次失敗' };

  const expiresAt = new Date(
    Date.now() + settings.card_token_valid_days * 86_400_000,
  ).toISOString();

  // 序號有唯一索引。撞號時只補產生缺少的數量，不整批重來
  const codes = new Set<string>();
  while (codes.size < quantity) codes.add(generateCardCode());

  const rows = [...codes].map((code) => ({
    code,
    kind: 'card' as const,
    batch_id: batch.id,
    status: 'inactive' as const,
    expires_at: expiresAt,
  }));

  // 分批插入，避免單一請求 payload 過大
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await db()
      .from('draw_tokens')
      .insert(rows.slice(i, i + 500));

    if (insertError) {
      return { error: `插入失敗（已完成 ${i} 組）：${insertError.message}` };
    }
  }

  revalidatePath('/admin/tokens');
  return { saved: true };
}

/** 分批啟用。剩餘可用序號少於 50 組時儀表板會告警 */
export async function activateAction(_prev: unknown, formData: FormData) {
  await requireOwner();

  const batchId = String(formData.get('batchId') ?? '');
  const count = Number(formData.get('count') ?? 0);

  if (!batchId || !Number.isInteger(count) || count < 1) {
    return { error: '請填寫要啟用的數量' };
  }

  const { data: pending } = await db()
    .from('draw_tokens')
    .select('id')
    .eq('batch_id', batchId)
    .eq('status', 'inactive')
    .limit(count);

  if (!pending || pending.length === 0) {
    return { error: '這個批次沒有未啟用的序號了' };
  }

  const { error } = await db()
    .from('draw_tokens')
    .update({ status: 'active' })
    .in(
      'id',
      pending.map((p) => p.id),
    );

  if (error) return { error: '啟用失敗' };

  const { data: batch } = await db()
    .from('token_batches')
    .select('activated_qty')
    .eq('id', batchId)
    .single();

  await db()
    .from('token_batches')
    .update({ activated_qty: (batch?.activated_qty ?? 0) + pending.length })
    .eq('id', batchId);

  revalidatePath('/admin/tokens');
  return { saved: true, activated: pending.length };
}
