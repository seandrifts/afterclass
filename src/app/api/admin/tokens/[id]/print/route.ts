import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { getStaffSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import {
  loadTicketFont,
  missingGlyphs,
  renderTicketPdf,
} from '@/lib/ticket-pdf';
import { formatDate, SHOP_TIMEZONE, shopDayStart } from '@/lib/time';

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
 *   ?paper=58   58mm 熱感紙，一張一頁，直接下載成 PDF。店裡的出單機
 *               是從 iPad 的列印 App 連線的，App 要的是檔案
 */
/*
  一批最多 5000 張，PDF 要一頁一頁畫，200 張實測約 8 秒（含冷啟動）。
  不指定的話用平台預設的上限，張數一多就會被砍在半路。
*/
export const maxDuration = 60;

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

  const params = new URL(request.url).searchParams;

  if (params.get('paper') === '58') {
    const settings = await getSettings();
    const all = tokens ?? [];

    /*
      第幾張到第幾張。

      張數是整個批次的固定順序（建立時間、再依序號），先切範圍、
      再濾掉用過的。順序反過來的話，每抽掉一張後面的號碼就全部往前
      遞補，「上次印到 80、這次從 81 開始」會漏印或重印。
    */
    const range = parseRange(params.get('from'), params.get('to'), all.length);
    if ('error' in range) return plain(range.error, 400);

    // 抽過、過期、作廢的不印。印了也只是浪費紙，而且混進去發給客人
    // 會掃出「這組序號已經用過」
    // 編號要在濾掉用過的之前就定下來，否則會跟著遞補
    const digits = Math.max(3, String(all.length).length);
    const printable = all
      .map((t, i) => ({
        ...t,
        label: `No.${String(i + 1).padStart(digits, '0')}`,
      }))
      .slice(range.from - 1, range.to)
      .filter((t) => t.status === 'active' || t.status === 'inactive');

    if (printable.length === 0) {
      return plain(
        `第 ${range.from} 到第 ${range.to} 張裡沒有還能用的序號可以印`,
        409,
      );
    }

    // 店名是老闆自訂的，可能有字型裡沒收的字。PDF 缺字會印成空白方框，
    // 要等紙印出來才看得到，所以先擋
    const { PDFDocument } = await import('pdf-lib');
    const missing = missingGlyphs(
      await loadTicketFont(await PDFDocument.create()),
      settings.shop_name,
    );
    if (missing.length > 0) {
      return plain(
        `店名裡的「${missing.join('')}」不在抽獎卡的字型裡，印出來會是空白。\n` +
          '請重新產生字型後再試：\n' +
          'node --env-file=.env.local scripts/subset-ticket-font.mjs <粉圓字型.ttf>',
        500,
      );
    }

    const pdf = await renderTicketPdf({
      shopName: settings.shop_name,
      siteUrl: env.siteUrl,
      tickets: printable.map((t) => ({
        code: t.code,
        expiry: t.expires_at ? formatDate(t.expires_at) : null,
        label: t.label,
      })),
    });

    /*
      檔名是「年月日_v第幾版」，例如 20261010_v2.pdf。

      版本號是今天第幾次匯出，靠稽核紀錄數出來的。每匯出一次就記一筆，
      所以這份紀錄同時也回答了「誰在什麼時候把序號印出去」—— 序號等同
      抽獎機會，這件事本來就該留痕跡。
    */
    const { count } = await db()
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'export_ticket_pdf')
      .gte('created_at', shopDayStart());

    const version = (count ?? 0) + 1;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIMEZONE })
      .format(new Date())
      .replaceAll('-', '');
    const filename = `${today}_v${version}.pdf`;

    await db().from('audit_logs').insert({
      actor_type: 'staff',
      actor_id: session.sid,
      action: 'export_ticket_pdf',
      target_type: 'token_batch',
      target_id: id,
      detail: {
        檔名: filename,
        範圍: `${range.from}-${range.to}`,
        張數: printable.length,
        批次: batch.name,
      },
    });

    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
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

function plain(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * 解析「第幾張到第幾張」。兩個都沒給就是整批。
 *
 * 填錯時直接講清楚錯在哪，不默默改成別的範圍。印出來的是實體的卡，
 * 悄悄幫人改數字的後果是多印或漏印，而且要對著紙才發現得了。
 */
function parseRange(
  rawFrom: string | null,
  rawTo: string | null,
  total: number,
): { from: number; to: number } | { error: string } {
  if (total === 0) return { error: '這個批次沒有序號' };

  const from = rawFrom === null || rawFrom === '' ? 1 : Number(rawFrom);
  const to = rawTo === null || rawTo === '' ? total : Number(rawTo);

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return { error: '張數請填整數' };
  }
  if (from < 1 || to > total) {
    return { error: `這個批次只有第 1 到第 ${total} 張` };
  }
  if (from > to) {
    return { error: `起始（第 ${from} 張）不能大於結束（第 ${to} 張）` };
  }

  return { from, to };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
