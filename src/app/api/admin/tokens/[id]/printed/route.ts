import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getStaffSession } from '@/lib/session';
import { db } from '@/lib/supabase';

/**
 * 記下「這個批次用藍牙印到第幾張」。
 *
 * 指令是瀏覽器送給出單機的，伺服器只知道有人來要過列印內容，不知道
 * 實際印出幾張 —— 藍牙中途斷線時，要了 30 張可能只印出 7 張。所以由
 * 瀏覽器在印完（或中斷）之後回報最後一張成功送出的編號。
 *
 * 後台靠這筆紀錄顯示「上次印到 No.xxx」，並把起始張數預設成下一張，
 * 不必靠人記。存在 audit_logs 裡，不另外開欄位。
 */
const schema = z.object({
  from: z.number().int().min(1),
  last: z.number().int().min(1),
  count: z.number().int().min(1),
});

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/admin/tokens/[id]/printed'>,
) {
  const session = await getStaffSession();
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: '沒有權限' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.last < parsed.data.from) {
    return NextResponse.json({ error: '內容不對' }, { status: 400 });
  }

  const { data: batch } = await db()
    .from('token_batches')
    .select('name, quantity')
    .eq('id', id)
    .maybeSingle();
  if (!batch) return NextResponse.json({ error: '找不到批次' }, { status: 404 });
  if (parsed.data.last > batch.quantity) {
    return NextResponse.json({ error: '內容不對' }, { status: 400 });
  }

  const { from, last, count } = parsed.data;
  await db().from('audit_logs').insert({
    actor_type: 'staff',
    actor_id: session.sid,
    action: 'ticket_printed',
    target_type: 'token_batch',
    target_id: id,
    detail: { 範圍: `${from}-${last}`, 最後一張: last, 張數: count, 批次: batch.name },
  });

  return NextResponse.json({ ok: true });
}
