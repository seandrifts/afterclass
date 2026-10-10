import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { getStaffSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { formatDate } from '@/lib/time';

/**
 * 匯出一批序號的列印清單（HTML）。
 *
 * 用可列印的 HTML 而不是 PDF，因為列印行本來就吃得下 HTML，
 * 而且老闆可以先在瀏覽器預覽、直接 Ctrl+P 輸出成 PDF，
 * 不需要為此背一個 PDF 產生器的相依。
 *
 * 序號文字一定要印在 QR 旁邊。QR 被油污弄髒、鏡頭壞掉、
 * 老人家不會掃，都能靠手動輸入救回來。
 *
 * 兩種版面：
 *   預設        A4，一頁 4 欄，給一般印表機或印刷行
 *   ?paper=58   58mm 熱感紙，一張一頁，給店裡的出單機
 */
export async function GET(
  request: Request,
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
      .select('code, status, expires_at')
      .eq('batch_id', id)
      .order('created_at')
      .order('code'),
  ]);

  if (!batch) return new NextResponse('Not found', { status: 404 });

  if (new URL(request.url).searchParams.get('paper') === '58') {
    const settings = await getSettings();

    return new NextResponse(
      await thermalSheet({
        batchName: batch.name,
        shopName: settings.shop_name,
        // 抽過、過期、作廢的不印。熱感紙一張一張出，印了也只是浪費紙，
        // 而且混進去發給客人會掃出「這組序號已經用過」
        tokens: (tokens ?? []).filter(
          (t) => t.status === 'active' || t.status === 'inactive',
        ),
      }),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

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

  // 批次名稱是後台自由輸入的文字，直接塞進 HTML 會被當成標籤解析
  const name = escapeHtml(batch.name);

  const html = `<!doctype html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8">
<title>${name} 列印清單</title>
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
  ${name} ‧ 共 ${cards.length} 組 ‧ 用瀏覽器列印功能輸出，可另存為 PDF
</div>
<div class="sheet">${cards.join('')}</div>
</body></html>`;

  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 58mm 熱感紙版面。
 *
 * 幾個跟一般印表機不一樣的地方：
 *
 * 1. 紙寬 58mm，但印字頭只有 48mm 左右，兩側各留 5mm 印不到。
 *    內容寬度照 48mm 排，超出去的部分會直接被切掉
 * 2. 只有黑與白。灰色會被驅動程式換成網點，字會糊、QR 會掃不到，
 *    所以全部用純黑，字重加粗
 * 3. 解析度約每 mm 8 點。QR 邊長 36mm、每格超過 1mm，
 *    點數夠整，邊緣不會因為除不盡而忽粗忽細
 * 4. 一張一頁。每頁高度固定，出單機有裁刀的會自己切，
 *    沒有的沿著底下的虛線撕
 */
async function thermalSheet(input: {
  batchName: string;
  shopName: string;
  tokens: { code: string; expires_at: string | null }[];
}): Promise<string> {
  const { default: QRCode } = await import('qrcode');

  const shop = escapeHtml(input.shopName);

  const tickets = await Promise.all(
    input.tokens.map(async (t) => {
      const svg = await QRCode.toString(`${env.siteUrl}/d/${t.code}`, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
      });

      // 中間加一槓比較好念。輸入時有沒有槓都查得到（normalizeCode 會拿掉）
      const code = `${t.code.slice(0, 4)}-${t.code.slice(4)}`;

      const expiry = t.expires_at
        ? `<div class="fine">每張限抽一次 ‧ ${formatDate(t.expires_at)} 前有效</div>`
        : '<div class="fine">每張限抽一次</div>';

      return `<section class="ticket">
  <div class="shop">${shop}</div>
  <div class="sub">消費回饋抽獎</div>
  ${svg}
  <div class="code">${code}</div>
  <div class="how">手機相機掃描 QR Code<br>馬上抽獎</div>
  ${expiry}
</section>`;
    }),
  );

  return `<!doctype html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8">
<title>${escapeHtml(input.batchName)} 58mm</title>
<style>
  @page { size: 58mm 76mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif;
    color: #000; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .ticket {
    width: 58mm; height: 75mm; padding: 4mm 5mm 0;
    text-align: center; overflow: hidden;
    break-after: page; break-inside: avoid;
    border-bottom: 0.3mm dashed #000;
  }
  .ticket:last-child { break-after: auto; }
  .shop { font-size: 14pt; font-weight: 900; line-height: 1.2; }
  .sub { font-size: 9pt; font-weight: 700; margin-top: 0.5mm; }
  .ticket svg {
    display: block; width: 36mm; height: 36mm; margin: 1.5mm auto 0;
    shape-rendering: crispEdges;
  }
  .code {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 14pt; font-weight: 700; letter-spacing: 0.06em;
  }
  .how { font-size: 9pt; font-weight: 700; line-height: 1.35; margin-top: 1mm; }
  .fine { font-size: 7pt; font-weight: 700; margin-top: 1.2mm; }

  .head {
    font-family: system-ui, sans-serif; font-size: 13px; line-height: 1.7;
    padding: 12px 16px; margin: 0 0 16px; background: #f4f4f4;
    border-bottom: 1px solid #ccc;
  }
  .head b { font-size: 15px; }
  @media screen {
    body { background: #ddd; }
    .ticket { background: #fff; margin: 0 auto 12px; border: 0; }
  }
  @media print { .head { display: none; } }
</style></head>
<body>
<div class="head">
  <b>${escapeHtml(input.batchName)} ‧ 共 ${tickets.length} 張（已用過與過期的不會印）</b><br>
  按 Ctrl+P（Mac 是 ⌘P），印表機選出單機，紙張選 58mm，邊界選「無」，縮放 100%，
  關掉「頁首與頁尾」。<br>
  建議先在列印視窗的「頁面」填 1，印一張確認位置與掃得到，再印全部。
</div>
${tickets.join('\n')}
</body></html>`;
}
