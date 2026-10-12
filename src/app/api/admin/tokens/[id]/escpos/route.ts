import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { getStaffSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { ticketCommands, unprintable } from '@/lib/ticket-escpos';
import { formatDate } from '@/lib/time';

/**
 * 給「藍牙直接列印」用的列印指令。
 *
 * 回傳每一張卡的 ESC/POS 指令（base64）。真正把指令送給出單機的是
 * 瀏覽器（Web Bluetooth），伺服器碰不到店裡的藍牙裝置。
 *
 * 範圍與編號的規則跟 PDF 那支路由一樣：張數是批次內固定的順序，
 * 先切範圍、再濾掉用過的。
 */
export async function GET(
  request: Request,
  ctx: RouteContext<'/api/admin/tokens/[id]/escpos'>,
) {
  const session = await getStaffSession();
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: '沒有權限' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const params = new URL(request.url).searchParams;

  const [{ data: batch }, { data: tokens }, settings] = await Promise.all([
    db().from('token_batches').select('name').eq('id', id).maybeSingle(),
    db()
      .from('draw_tokens')
      .select('code, status, expires_at')
      .eq('batch_id', id)
      .order('created_at')
      .order('code'),
    getSettings(),
  ]);

  if (!batch) return NextResponse.json({ error: '找不到批次' }, { status: 404 });

  const all = tokens ?? [];
  const from = Number(params.get('from') ?? 1);
  const to = Number(params.get('to') ?? all.length);

  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1 ||
    to > all.length ||
    from > to
  ) {
    return NextResponse.json(
      { error: `範圍不對。這個批次只有第 1 到第 ${all.length} 張` },
      { status: 400 },
    );
  }

  // 店名是老闆自訂的，可能有印表機內建字庫沒有的字
  const bad = unprintable(settings.shop_name);
  if (bad.length > 0) {
    return NextResponse.json(
      { error: `店名裡的「${bad.join('')}」印表機印不出來` },
      { status: 422 },
    );
  }

  // 編號要在濾掉用過的之前就定下來，否則會跟著遞補
  const digits = Math.max(3, String(all.length).length);
  const tickets = all
    .map((t, i) => ({
      ...t,
      label: `No.${String(i + 1).padStart(digits, '0')}`,
    }))
    .slice(from - 1, to)
    .filter((t) => t.status === 'active' || t.status === 'inactive')
    .map((t) => ({
      label: t.label,
      data: ticketCommands(settings.shop_name, env.siteUrl, {
        code: t.code,
        expiry: t.expires_at ? formatDate(t.expires_at) : null,
        label: t.label,
      }).toString('base64'),
    }));

  if (tickets.length === 0) {
    return NextResponse.json(
      { error: `第 ${from} 到第 ${to} 張裡沒有還能用的序號可以印` },
      { status: 409 },
    );
  }

  // 序號等同抽獎機會，印出去這件事要留痕跡
  await db().from('audit_logs').insert({
    actor_type: 'staff',
    actor_id: session.sid,
    action: 'print_ticket_bluetooth',
    target_type: 'token_batch',
    target_id: id,
    detail: { 範圍: `${from}-${to}`, 張數: tickets.length, 批次: batch.name },
  });

  return NextResponse.json(
    { tickets },
    { headers: { 'cache-control': 'no-store' } },
  );
}
