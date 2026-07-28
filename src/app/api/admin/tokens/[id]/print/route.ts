import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { getStaffSession } from '@/lib/session';
import { db } from '@/lib/supabase';

/**
 * 匯出一批序號的列印清單（HTML）。
 *
 * 用可列印的 HTML 而不是 PDF，因為列印行本來就吃得下 HTML，
 * 而且老闆可以先在瀏覽器預覽、直接 Ctrl+P 輸出成 PDF，
 * 不需要為此背一個 PDF 產生器的相依。
 *
 * 序號文字一定要印在 QR 旁邊。QR 被油污弄髒、鏡頭壞掉、
 * 老人家不會掃，都能靠手動輸入救回來。
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<'/api/admin/tokens/[id]/print'>,
) {
  const session = await getStaffSession();
  if (!session || session.role !== 'owner') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { id } = await ctx.params;

  const [{ data: batch }, { data: tokens }] = await Promise.all([
    db().from('token_batches').select('name').eq('id', id).maybeSingle(),
    db()
      .from('draw_tokens')
      .select('code')
      .eq('batch_id', id)
      .order('created_at'),
  ]);

  if (!batch) return new NextResponse('Not found', { status: 404 });

  const { default: QRCode } = await import('qrcode');

  const cards = await Promise.all(
    (tokens ?? []).map(async (t) => {
      const svg = await QRCode.toString(`${env.siteUrl}/d/${t.code}`, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 0,
        width: 130,
      });
      return `<div class="card">${svg}<div class="code">${t.code}</div></div>`;
    }),
  );

  const html = `<!doctype html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8">
<title>${batch.name} 列印清單</title>
<style>
  @page { size: A4; margin: 8mm; }
  body { font-family: system-ui, sans-serif; margin: 0; }
  .sheet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; }
  .card {
    border: 1px dashed #bbb; border-radius: 3mm; padding: 3mm;
    text-align: center; break-inside: avoid;
  }
  .card svg { width: 100%; height: auto; }
  .code {
    margin-top: 2mm; font-family: ui-monospace, monospace;
    font-size: 11pt; font-weight: 700; letter-spacing: 0.08em;
  }
  .head { padding: 4mm 0; font-size: 10pt; color: #666; }
  @media print { .head { display: none; } }
</style></head>
<body>
<div class="head">
  ${batch.name} · 共 ${cards.length} 組 · 用瀏覽器列印功能輸出，可另存為 PDF
</div>
<div class="sheet">${cards.join('')}</div>
</body></html>`;

  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
