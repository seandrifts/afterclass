'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireOwner } from '@/lib/auth-guard';
import { db } from '@/lib/supabase';
import type { Prize } from '@/lib/types';

const prizeSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(1, '請填寫獎項名稱').max(40),
    type: z.enum(['credit', 'item', 'cash', 'free_meal']),
    credit_amount: z.coerce.number().int().min(1).nullable(),
    face_value: z.coerce.number().int().min(0),
    cost: z.coerce.number().int().min(0),
    discount_amt: z.coerce.number().int().min(0).nullable(),
    min_spend: z.coerce.number().int().min(0),
    max_discount: z.coerce.number().int().min(0).nullable(),
    weight: z.coerce.number().int().min(0),
    stock: z.coerce.number().int().min(0).nullable(),
    valid_days: z.coerce.number().int().min(1).nullable(),
    terms: z.string().max(200).nullable(),
    color: z.string().max(20).nullable(),
    sort_order: z.coerce.number().int(),
  })
  // 這些檢查資料庫層也有 constraint。這裡再做一次是為了給出人看得懂的訊息
  .refine((v) => v.type !== 'credit' || v.credit_amount !== null, {
    message: '儲值金必須填入帳金額',
    path: ['credit_amount'],
  })
  .refine((v) => v.type !== 'free_meal' || v.max_discount !== null, {
    message: '免單必須設折抵上限，否則會有人揪團賭免單',
    path: ['max_discount'],
  })
  .refine(
    (v) =>
      v.type !== 'cash' ||
      (v.discount_amt !== null && v.min_spend >= v.discount_amt),
    {
      message: '現金券的使用門檻不可小於折抵金額',
      path: ['min_spend'],
    },
  );

export async function savePrizeAction(_prev: unknown, formData: FormData) {
  const owner = await requireOwner();

  const raw = Object.fromEntries(formData.entries());
  const normalized = {
    ...raw,
    credit_amount: emptyToNull(raw.credit_amount),
    discount_amt: emptyToNull(raw.discount_amt),
    max_discount: emptyToNull(raw.max_discount),
    stock: emptyToNull(raw.stock),
    valid_days: emptyToNull(raw.valid_days),
    terms: emptyToNull(raw.terms),
    color: emptyToNull(raw.color),
    id: raw.id ? String(raw.id) : undefined,
  };

  const parsed = prizeSchema.safeParse(normalized);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? '欄位有誤' };
  }

  const values = parsed.data;

  // 儲值金的成本就是面額全額，折抵時直接減少收入。
  // 不讓使用者自己填，避免填錯導致整份成本報表失真
  if (values.type === 'credit') {
    values.cost = values.credit_amount!;
    values.face_value = values.credit_amount!;
  }

  const { id, ...fields } = values;

  if (id) {
    const { data: before } = await db()
      .from('prizes')
      .select('*')
      .eq('id', id)
      .single();

    const { error } = await db()
      .from('prizes')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) return { error: dbMessage(error.message) };

    await logChange(id, owner.sid, before, fields);
  } else {
    const { data, error } = await db()
      .from('prizes')
      .insert(fields)
      .select('id')
      .single();

    if (error) return { error: dbMessage(error.message) };

    await logChange(data.id, owner.sid, null, fields);
  }

  revalidatePath('/admin/prizes');
  return { saved: true };
}

/**
 * 批次儲存權重。
 *
 * 改一個權重會影響所有獎項的百分比，所以是一起送出、一起寫入。
 * 逐個儲存會讓中間狀態的機率分佈是錯的。
 */
export async function saveWeightsAction(_prev: unknown, formData: FormData) {
  const owner = await requireOwner();

  const raw = String(formData.get('weights') ?? '');
  let entries: { id: string; weight: number }[];

  try {
    entries = z
      .array(
        z.object({
          id: z.string().uuid(),
          weight: z.number().int().min(0),
        }),
      )
      .parse(JSON.parse(raw));
  } catch {
    return { error: '權重格式有誤' };
  }

  if (entries.length === 0) return { saved: true };

  // 不能讓所有啟用中的獎項權重都變成 0，那會讓抽獎爆掉
  const { data: current } = await db()
    .from('prizes')
    .select('id, weight, is_active');

  const merged = (current ?? []).map((p) => {
    const override = entries.find((e) => e.id === p.id);
    return { ...p, weight: override ? override.weight : p.weight };
  });

  if (!merged.some((p) => p.is_active && p.weight > 0)) {
    return { error: '至少要有一個啟用中且權重大於 0 的獎項' };
  }

  for (const entry of entries) {
    const before = (current ?? []).find((p) => p.id === entry.id);

    const { error } = await db()
      .from('prizes')
      .update({ weight: entry.weight, updated_at: new Date().toISOString() })
      .eq('id', entry.id);

    if (error) return { error: '儲存失敗' };

    await logChange(
      entry.id,
      owner.sid,
      before ?? null,
      { weight: entry.weight },
    );
  }

  revalidatePath('/admin/prizes');
  return { saved: true };
}

/**
 * 停用獎項。
 *
 * 刻意沒有真正的刪除。已發出的券會參照獎項做報表分組，
 * 硬刪會造成孤兒資料與報表斷裂。
 */
export async function togglePrizeAction(_prev: unknown, formData: FormData) {
  const owner = await requireOwner();

  const id = String(formData.get('id') ?? '');
  const next = formData.get('active') === 'true';

  if (!id) return { error: '缺少獎項' };

  // 不能把最後一個可抽的獎項停掉，那會讓抽獎整個爆掉
  if (!next) {
    const { count } = await db()
      .from('prizes')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .gt('weight', 0)
      .neq('id', id);

    if ((count ?? 0) === 0) {
      return { error: '至少要保留一個啟用中且權重大於 0 的獎項' };
    }
  }

  const { error } = await db()
    .from('prizes')
    .update({ is_active: next, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return { error: '更新失敗' };

  await logChange(id, owner.sid, null, { is_active: next });

  revalidatePath('/admin/prizes');
  return { saved: true };
}

async function logChange(
  prizeId: string,
  staffId: string,
  before: unknown,
  after: unknown,
) {
  await db().from('prize_change_log').insert({
    prize_id: prizeId,
    changed_by: staffId,
    before: before as Prize | null,
    after: after as Record<string, unknown>,
  });
}

function emptyToNull(v: FormDataEntryValue | undefined): string | null {
  if (v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function dbMessage(raw: string): string {
  if (raw.includes('prizes_credit_shape')) {
    return '儲值金的成本與面額必須等於入帳金額';
  }
  if (raw.includes('prizes_free_meal_shape')) {
    return '免單必須設折抵上限';
  }
  if (raw.includes('prizes_cash_shape')) {
    return '現金券的使用門檻不可小於折抵金額';
  }
  return '儲存失敗';
}
