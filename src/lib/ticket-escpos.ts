import 'server-only';

import iconv from 'iconv-lite';

/*
  用「文字指令」印抽獎卡，跟 POS 印收據是同一種做法。

  為什麼不直接印 PDF：出單機（XP-Q90EC）看不懂 PDF，列印 App 得先把
  整頁畫成點陣圖再送，一張三萬多 bytes。這台機器的藍牙收不下這麼多，
  實測紙走一點就斷線，iPad 的 App 與電腦直接送都一樣。同一台 iPad 上
  的 POS 卻印得好好的，差別就在 POS 只送文字。

  所以這裡也只送文字與指令：字由印表機用內建字型畫，QR 交給機器內建
  的功能產生。整張卡兩百多 bytes，跟一張收據差不多。

  代價是字型只能用機器內建的點陣字，版面只有置中、放大、加粗可用。

  scripts/print-direct.py 有一份相同內容的 Python 版（從電腦直接送），
  改這裡的版面記得一起改。
*/

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

export interface EscposTicket {
  code: string;
  /** 已經格式化好的到期日，例如「2026/11/24」。沒有期限給 null */
  expiry: string | null;
  /** 印在右下角的編號，例如「No.081」 */
  label: string;
}

/**
 * 轉成印表機內建字庫的編碼。
 *
 * 內建的是 GB18030 字庫，繁體字也在裡面（GBK 的範圍涵蓋 Big5 的字）。
 * 但只有雙位元組的字它畫得出來，四位元組的罕用字會印成亂碼。
 * 回傳 null 代表有字印不出來，讓呼叫端擋下，不要印出缺字的卡。
 */
function encode(text: string): Buffer | null {
  const parts: Buffer[] = [];
  for (const ch of text) {
    const bytes = iconv.encode(ch, 'gb18030');
    if (ch.codePointAt(0)! > 0x7f && bytes.length !== 2) return null;
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}

/** 印表機內建字庫裡沒有的字 */
export function unprintable(text: string): string[] {
  return [...new Set(text)].filter((ch) => encode(ch) === null);
}

export function ticketCommands(
  shopName: string,
  siteUrl: string,
  ticket: EscposTicket,
): Buffer {
  const out: Buffer[] = [];
  const raw = (...bytes: number[]) => out.push(Buffer.from(bytes));
  const line = (text: string) => {
    const encoded = encode(text);
    if (!encoded) throw new Error(`「${text}」有印表機印不出來的字`);
    out.push(encoded, Buffer.from('\n'));
  };

  /** 0x00 一般大小、0x11 寬高各兩倍 */
  const size = (n: number) => raw(GS, 0x21, n);
  const bold = (on: boolean) => raw(ESC, 0x45, on ? 1 : 0);
  const align = (n: 0 | 1 | 2) => raw(ESC, 0x61, n);

  raw(ESC, 0x40); // 初始化，清掉上一份工作留下的狀態
  raw(FS, 0x26); // 開啟中文模式
  align(1);

  bold(true);
  size(0x11);
  line(shopName);
  size(0x00);
  bold(false);

  // 中間的點用「·」。「・」在內建字庫裡是四位元組，印不出來
  line('感謝消費·掃碼抽好禮');
  out.push(Buffer.from('\n'));

  /*
    QR 交給印表機自己畫：選型號、設每格大小、設容錯、存入資料、印出。

    每格 8 點、容錯 M。容錯越高格子越密越細，在油污反光的環境反而
    更難掃（理由同 lib/qr.ts）。
  */
  const url = Buffer.from(`${siteUrl}/d/${ticket.code}`, 'ascii');
  raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0);
  raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 8);
  raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);
  raw(GS, 0x28, 0x6b, (url.length + 3) & 0xff, (url.length + 3) >> 8, 0x31, 0x50, 0x30);
  out.push(url);
  raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);
  out.push(Buffer.from('\n'));

  // 中間加一槓比較好念。輸入時有沒有槓都查得到（normalizeCode 會拿掉）
  bold(true);
  size(0x11);
  line(`${ticket.code.slice(0, 4)}-${ticket.code.slice(4)}`);
  size(0x00);
  bold(false);
  out.push(Buffer.from('\n'));

  line('手機相機掃描 QR Code');
  line('馬上抽獎');
  out.push(Buffer.from('\n'));
  line('每張限抽一次');
  if (ticket.expiry) line(`${ticket.expiry} 前有效`);

  // 編號靠右，換紙卷時靠它知道印到哪一張
  align(2);
  line(ticket.label);
  align(1);

  // 走紙到裁刀位置再半切
  raw(GS, 0x56, 0x42, 0);

  return Buffer.concat(out);
}
