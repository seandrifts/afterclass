import 'server-only';

import QRCode from 'qrcode';

/**
 * 產生 QR 的 SVG 字串。
 *
 * 用 SVG 而非 PNG dataURL：檔案小、任何解析度都銳利、
 * 而且可以直接內嵌在 HTML 裡不需要額外請求。
 *
 * 容錯等級刻意用 M 而不是 H。小吃店的環境有油污和反光，直覺會
 * 想開最高容錯，但容錯越高 module 密度越高、格子越細，反而更難掃。
 * M 級搭配短網址的組合實測起來比 H 級好掃。
 */
export async function qrSvg(text: string, size = 240): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: size,
  });
}
