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

  版面是照出單機（XP-Q90EC）的印字頭排的：

  1. 頁寬 48mm，不是紙寬 58mm。印字頭一行 384 點、每 mm 8 點，實際
     印得到的就是 48mm。頁面做成一樣寬，列印 App 把頁面對到印字頭時
     才是一比一，不會被縮小，也不會把兩側印不到的留白算進去
  2. 所有尺寸以「點」為單位來想。字的大小、間距、QR 的格子都是整數
     點，轉成點陣時才不會有除不盡的邊
  3. 字不要太小。粉圓的筆畫細，字高 20 點時筆畫只有 1 到 2 點寬，
     在螢幕上模擬還讀得出來，但熱感紙實際印 1 點寬的線容易淡掉。
     所以最小的字留在 24 點以上，太長的那行拆成兩行
  4. 只有黑與白。灰色會被換成網點，字會糊、QR 會掃不到
  5. 一張一頁，高度固定。右下角印這張卡在批次裡的編號
*/

const MM = 72 / 25.4;

/** 熱感印字頭的解析度，每 mm 幾點 */
const DOTS_PER_MM = 8;

/** 一個印字點在 PDF 裡的長度 */
const DOT = MM / DOTS_PER_MM;

/** 印字頭一行的點數，也就是頁寬 */
const HEAD_DOTS = 384;

const PAGE_W = HEAD_DOTS * DOT;
const PAGE_H = 672 * DOT;

/** 文字左右各留 8 點，貼著印字頭邊緣的那幾點最容易印不清楚 */
const PRINTABLE = (HEAD_DOTS - 16) * DOT;

/** QR 邊長上限。實際大小會往下取到「每格整數點」 */
const QR_MAX = 34 * MM;

const BLACK = rgb(0, 0, 0);

export interface Ticket {
  code: string;
  /** 已經格式化好的到期日，例如「2026/11/24」。沒有期限給 null */
  expiry: string | null;
  /** 印在右下角的編號，例如「No.081」 */
  label: string;
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

  /*
    從上往下排，單位是印字點。

    cursor 是目前這一行的頂端。每畫一行就往下推「字高 + 行距」，
    所以改任何一行的大小，後面的會自己讓開。
  */
  let cursor = 16;

  const row = (text: string, dots: number, gapAfter: number) => {
    centered(page, font, { text, size: dots * DOT }, baseline(cursor, dots));
    cursor += dots + gapAfter;
  };

  // 店名可以由老闆自訂，太長就縮字級，不讓它超出印得到的寬度
  const shop = fit(font, sheet.shopName, 50);
  centered(page, font, shop, baseline(cursor, 50));
  cursor += 50 + 10;

  row('感謝消費・掃碼抽好禮', 30, 22);

  cursor = drawQr(page, `${sheet.siteUrl}/d/${ticket.code}`, cursor) + 14;

  // 中間加一槓比較好念。輸入時有沒有槓都查得到（normalizeCode 會拿掉）
  const code = `${ticket.code.slice(0, 4)}-${ticket.code.slice(4)}`;
  spaced(page, font, code, 46 * DOT, 4 * DOT, baseline(cursor, 46));
  cursor += 46 + 16;

  row('手機相機掃描 QR Code', 30, 8);
  row('馬上抽獎', 30, 18);

  row('每張限抽一次', 26, 6);
  if (ticket.expiry) row(`${ticket.expiry} 前有效`, 26, 14);
  else cursor += 8;

  /*
    右下角的編號，也就是這張卡在批次裡是第幾張。

    換紙卷或卡紙時靠它知道印到哪裡，下一份從下一號接著印。
  */
  const size = 24 * DOT;
  const right = (PAGE_W + PRINTABLE) / 2;
  page.drawText(ticket.label, {
    x: right - font.widthOfTextAtSize(ticket.label, size),
    y: baseline(cursor, 24),
    size,
    font,
    color: BLACK,
  });
}

/**
 * 一行字的基線位置。
 *
 * 排版時想的是「這行的頂端在第幾點」，PDF 要的是基線，而且原點在
 * 左下角。粉圓的字身大約佔字高的 0.86，基線就在頂端往下那麼多。
 */
function baseline(topDots: number, sizeDots: number): number {
  return PAGE_H - (topDots + sizeDots * 0.86) * DOT;
}

/** 店名可以由老闆自訂，太長就縮字級，不讓它超出印得到的寬度 */
function fit(font: PDFFont, text: string, dots: number) {
  let d = dots;
  while (d > 24 && font.widthOfTextAtSize(text, d * DOT) > PRINTABLE) d -= 2;
  return { text, size: d * DOT };
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
  gap: number,
  baseline: number,
) {
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
 * 畫 QR，回傳它的底邊在第幾點（從頁面頂端算）。
 *
 * 容錯等級用 M 而不是 H：容錯越高格子越密越細，在油污反光的環境
 * 反而更難掃（理由同 lib/qr.ts）。
 *
 * 每一格的邊長取「整數個印字點」。除不盡的話印表機會把某些格子多印
 * 或少印一點，黑白邊界就不齊了。
 */
function drawQr(page: PDFPage, text: string, topDots: number): number {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const count = qr.modules.size;
  const data = qr.modules.data;

  const dots = Math.max(1, Math.floor((QR_MAX / MM) * DOTS_PER_MM / count));
  const cell = dots * DOT;

  // 左邊界也對到整數點，否則整個 QR 會偏半格，每一格的邊都落在兩點之間
  const left = Math.round((HEAD_DOTS - dots * count) / 2) * DOT;
  const top = PAGE_H - topDots * DOT;

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

  return topDots + dots * count;
}
