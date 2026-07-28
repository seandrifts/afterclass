import { randomInt } from 'node:crypto';

/**
 * 紙卡序號字集。
 *
 * 刻意排除易混淆字元：
 *   0 / O、1 / I / L、2 / Z、5 / S、8 / B
 *
 * 序號會印在小卡上，客人掃不到 QR 時要能手動輸入。
 * 老人家在昏暗的小吃店裡抄一串 O 和 0 混雜的碼是行不通的。
 */
const CARD_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

/**
 * 動態 QR 的字集。
 *
 * 必須維持「只有大寫與數字」。查序號的路徑會先經過 normalizeCode()
 * 轉大寫（為了讓客人手動輸入紙卡序號時不分大小寫），字集若含小寫，
 * 產生出來的序號轉大寫之後就查不到自己了。
 *
 * 字元比紙卡多一些是可以的，因為動態 QR 沒有人會用手抄。
 */
const DYNAMIC_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function pick(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/** 紙卡序號，8 碼。用 crypto 亂數，不可用時間戳或流水號 */
export function generateCardCode(): string {
  return pick(CARD_ALPHABET, 8);
}

/** 動態 QR 序號，12 碼。存活只有 60 秒，但仍要防暴力猜測 */
export function generateDynamicCode(): string {
  return pick(DYNAMIC_ALPHABET, 12);
}

/** 券的核銷碼，6 位數字。店員要能快速念出來與輸入 */
export function generateRedeemCode(): string {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += String(randomInt(10));
  return out;
}

/** 會員錢包碼，10 碼。店員掃這個查餘額，與內部 uuid 分開 */
export function generateWalletCode(): string {
  return pick(CARD_ALPHABET, 10);
}

/**
 * 正規化使用者輸入的序號：轉大寫、去掉空白與連字號。
 *
 * 刻意不做字元替換（例如把 0 當成 O）。字集已經同時排除掉 0 和 O，
 * 所以使用者打出任何一個都代表看錯了，而看錯的來源是哪個字無法判斷
 * （0 可能是 Q 也可能是 D）。猜錯會把一組本來無效的碼變成別人的有效碼，
 * 寧可讓他重打。
 */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}
