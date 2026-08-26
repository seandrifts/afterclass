import type { Settings } from './types';
import { formatShortDate } from './time';

/**
 * 點數顯示。
 *
 * 資料庫一律存「元」的整數。點數只是顯示層的包裝：抽到「1 元」感覺
 * 很寒酸，抽到「10 點」感覺好很多。同一件事，數字大就是比較爽。
 *
 * 重要：店員端一律顯示「元」，不做換算。阿姨在尖峰時段不該需要心算
 * 470 點等於多少錢。只有客人端才顯示點數。
 */
export function toPoints(dollars: number, s: Settings): number {
  return dollars * s.points_per_dollar;
}

/** 客人端顯示：有開點數就顯示點數，沒開就顯示元 */
export function formatForCustomer(dollars: number, s: Settings): string {
  if (!s.points_display_enabled) return `${dollars} 元`;
  return `${toPoints(dollars, s)} 點`;
}

/** 店員端顯示：永遠是元 */
export function formatForStaff(dollars: number): string {
  return `${dollars} 元`;
}

/**
 * 錢包頁的進度條目標值。
 *
 * 用「單次折抵上限」當里程碑，這是客人下次來店能一次用掉的最大金額，
 * 也是最自然的目標。達標後多出來的部分照樣累積，只是要分次使用。
 */
export function progressToward(
  balance: number,
  s: Settings,
): { target: number; ratio: number; reached: boolean; remaining: number } {
  const target = s.max_redeem_per_visit;
  const reached = balance >= target;

  return {
    target,
    ratio: Math.min(1, target > 0 ? balance / target : 0),
    reached,
    remaining: Math.max(0, target - balance),
  };
}

/** 這次結帳實際能折抵多少：受餘額與單次上限雙重限制 */
export function redeemableNow(balance: number, s: Settings): number {
  if (balance < s.min_balance_to_redeem) return 0;
  return Math.min(balance, s.max_redeem_per_visit);
}

/** 距離到期還有幾天。回傳 null 代表沒有餘額或沒有到期日 */
export function daysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/**
 * 到期日顯示，例如「11/03」。
 *
 * 原本用 getMonth()/getDate()，那是伺服器當地時間 —— 在 Vercel 上是
 * UTC，接近午夜的到期日會顯示成前一天，客人會以為少了一天。
 */
export function formatExpiryDate(expiresAt: string): string {
  return formatShortDate(expiresAt);
}
