import 'server-only';

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';

import { TICKET_FONT_TTF_BASE64 } from './ticket-font.generated';

/*
  58mm 熱感紙的抽獎卡，直接產生 PDF。

  店裡的出單機是從 iPad 的列印 App 連線的，App 吃的是檔案，不是網頁的
  列印視窗。所以這裡不再輸出「給瀏覽器列印的 HTML」，改成一份可以直接
  下載、傳到 App 的 PDF。

  不用無頭瀏覽器把 HTML 轉成 PDF：那要在 serverless 裡塞一整個
  Chromium，冷啟動多好幾秒。卡片的版面只有幾行字加一個 QR，
  自己算座標畫出來又快又穩，每次結果也一模一樣。

  版面的幾個前提：

  1. 紙寬 58mm，但印字頭只有 48mm 左右，兩側各 5mm 印不到。
     所有內容都置中排在 48mm 內
  2. 只有黑與白。灰色會被換成網點，字會糊、QR 會掃不到
  3. 解析度約每 mm 8 點。QR 每一格取整數點，邊緣才不會忽粗忽細
  4. 一張一頁，高度固定。有裁刀的機器會自己切，沒有的沿虛線撕
*/

const MM = 72 / 25.4;

const PAGE_W = 58 * MM;
const PAGE_H = 76 * MM;

/** 印字頭實際印得到的寬度 */
const PRINTABLE = 48 * MM;

/** 熱感印字頭的解析度，每 mm 幾點 */
const DOTS_PER_MM = 8;

/** QR 邊長上限。實際大小會往下取到「每格整數點」 */
const QR_MAX = 34 * MM;

const BLACK = rgb(0, 0, 0);

export interface Ticket {
  code: string;
  /** 已經格式化好的到期日，例如「2026/11/24」。沒有期限給 null */
  expiry: string | null;
}

export interface TicketSheet {
  shopName: string;
  siteUrl: string;
  tickets: Ticket[];
}

/**
 * 字型裡沒有的字。
 *
 * 嵌進去的字型只留了卡片會用到的字（見 scripts/subset-ticket-font.mjs）。
 * PDF 不像網頁會自動換系統字型，缺字會印成空白方框，而且要等紙印出來
 * 才看得到。所以產生之前先檢查，有缺就讓呼叫端擋下來。
 */
export function missingGlyphs(font: PDFFont, text: string): string[] {
  const known = new Set(font.getCharacterSet());
  return [...new Set(text)].filter((ch) => !known.has(ch.codePointAt(0)!));
}

export async function loadTicketFont(doc: PDFDocument): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  // 字型已經裁過，整份嵌入。讓 pdf-lib 再裁一次對中文字型不穩定
  return doc.embedFont(Buffer.from(TICKET_FONT_TTF_BASE64, 'base64'), {
    subset: false,
  });
}

export async function renderTicketPdf(sheet: TicketSheet): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await loadTicketFont(doc);

  doc.setTitle(`${sheet.shopName} 抽獎卡`);
  doc.setCreator('afterclass');

  for (const ticket of sheet.tickets) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawTicket(page, font, sheet, ticket);
  }

  return doc.save();
}

function drawTicket(
  page: PDFPage,
  font: PDFFont,
  sheet: TicketSheet,
  ticket: Ticket,
) {
  // 明確鋪一層白底。不鋪的話頁面是透明的，有些列印 App 轉成點陣時
  // 會把透明當成黑色，整張印成全黑
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_W,
    height: PAGE_H,
    color: rgb(1, 1, 1),
  });

  // PDF 的原點在左下角。版面是從上往下想的，所以用「距離頂端幾 mm」換算
  const y = (mmFromTop: number) => PAGE_H - mmFromTop * MM;

  centered(page, font, fit(font, sheet.shopName, 14), y(8.8));
  centered(page, font, { text: '感謝消費・掃碼抽好禮', size: 9 }, y(13));

  const qrBottom = drawQr(page, `${sheet.siteUrl}/d/${ticket.code}`, 15.5);

  // 中間加一槓比較好念。輸入時有沒有槓都查得到（normalizeCode 會拿掉）
  const code = `${ticket.code.slice(0, 4)}-${ticket.code.slice(4)}`;
  spaced(page, font, code, 15, 0.08, y(qrBottom + 6));

  centered(page, font, { text: '手機相機掃描 QR Code', size: 9 }, y(qrBottom + 10.8));
  centered(page, font, { text: '馬上抽獎', size: 9 }, y(qrBottom + 15));

  centered(
    page,
    font,
    {
      text: ticket.expiry
        ? `每張限抽一次 ‧ ${ticket.expiry} 前有效`
        : '每張限抽一次',
      size: 7.5,
    },
    y(qrBottom + 19.6),
  );

  // 撕線
  page.drawLine({
    start: { x: 0, y: y(75.3) },
    end: { x: PAGE_W, y: y(75.3) },
    thickness: 0.3 * MM,
    color: BLACK,
    dashArray: [1.2 * MM, 1 * MM],
  });
}

/** 店名可以由老闆自訂，太長就縮字級，不讓它超出印得到的寬度 */
function fit(font: PDFFont, text: string, size: number) {
  let s = size;
  while (s > 7 && font.widthOfTextAtSize(text, s) > PRINTABLE) s -= 0.5;
  return { text, size: s };
}

function centered(
  page: PDFPage,
  font: PDFFont,
  line: { text: string; size: number },
  baseline: number,
) {
  const width = font.widthOfTextAtSize(line.text, line.size);
  page.drawText(line.text, {
    x: (PAGE_W - width) / 2,
    y: baseline,
    size: line.size,
    font,
    color: BLACK,
  });
}

/** 加字距的置中文字。pdf-lib 沒有字距選項，逐字畫 */
function spaced(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  trackingEm: number,
  baseline: number,
) {
  const gap = size * trackingEm;
  const chars = [...text];
  const widths = chars.map((ch) => font.widthOfTextAtSize(ch, size));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);

  let x = (PAGE_W - total) / 2;
  chars.forEach((ch, i) => {
    page.drawText(ch, { x, y: baseline, size, font, color: BLACK });
    x += widths[i] + gap;
  });
}

/**
 * 畫 QR，回傳它的底邊距離頁面頂端幾 mm。
 *
 * 容錯等級用 M 而不是 H：容錯越高格子越密越細，在油污反光的環境
 * 反而更難掃（理由同 lib/qr.ts）。
 *
 * 每一格的邊長取「整數個印字點」。除不盡的話印表機會把某些格子多印
 * 或少印一點，黑白邊界就不齊了。
 */
function drawQr(page: PDFPage, text: string, topMm: number): number {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const count = qr.modules.size;
  const data = qr.modules.data;

  const dots = Math.max(1, Math.floor((QR_MAX / MM) * DOTS_PER_MM / count));
  const cell = (dots / DOTS_PER_MM) * MM;
  const side = cell * count;

  const left = (PAGE_W - side) / 2;
  const top = PAGE_H - topMm * MM;

  /*
    整個 QR 畫成「一條路徑、填一次色」。

    一格一個長方形分開畫的話，相鄰兩格的邊界會各自做一次反鋸齒，
    轉成點陣時中間會透出一條白色細縫。合成同一條路徑就沒有這個問題。
    同一列連續的黑格先併成一段，路徑也短很多。

    路徑用的是 SVG 的座標習慣：以格為單位、y 往下。
  */
  let path = '';
  for (let row = 0; row < count; row += 1) {
    let start = -1;
    for (let col = 0; col <= count; col += 1) {
      const dark = col < count && data[row * count + col];
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        path += `M${start} ${row}h${col - start}v1h${start - col}z`;
        start = -1;
      }
    }
  }

  page.drawSvgPath(path, { x: left, y: top, scale: cell, color: BLACK });

  return topMm + side / MM;
}
