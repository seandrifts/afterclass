/**
 * 店家時區。
 *
 * 資料庫一律存 UTC，這是對的；但顯示與「今日」的分界必須用店家所在
 * 地的時間，否則會出現三種各自不同的答案：
 *
 *   伺服器渲染的頁面   Vercel 是 UTC，客人看到的時間少 8 小時
 *   瀏覽器渲染的頁面   看的人在哪裡就顯示哪裡的時間，老闆在國外看
 *                      跟店員在台灣看是兩個數字
 *   「今日」統計       用 UTC 午夜分界，等於早上八點才換日
 *
 * 全部集中到這裡。要換城市只改 SHOP_TIMEZONE 一行。
 */
export const SHOP_TIMEZONE = 'Asia/Taipei';

/** 某個瞬間，換算成店家時區的年月日時分秒 */
function partsInShopTz(instant: Date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const p: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(instant)) {
    if (type !== 'literal') p[type] = Number(value);
  }

  // hour12:false 在某些環境會把午夜給成 24
  if (p.hour === 24) p.hour = 0;
  return p;
}

/**
 * 店家時區在該瞬間與 UTC 的時差（毫秒）。
 *
 * 台灣沒有日光節約時間，寫死 +8 也會對；但這樣寫的話，哪天改成其他
 * 城市就會安靜地錯掉，而時間的錯誤很難從畫面上看出來。
 */
function shopOffsetMs(instant: Date): number {
  const p = partsInShopTz(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/**
 * 店家時區的某日午夜，回傳 UTC ISO 字串。
 *
 * offsetDays 往前推幾天，0 是今天。
 */
export function shopDayStart(offsetDays = 0): string {
  const p = partsInShopTz(new Date());

  // 先把「店家當地日期」當成 UTC 午夜，再扣掉時差還原成真正的瞬間
  const guess = Date.UTC(p.year, p.month - 1, p.day - offsetDays);
  return new Date(guess - shopOffsetMs(new Date(guess))).toISOString();
}

/** 店家時區的當月一號午夜，回傳 UTC ISO 字串 */
export function shopMonthStart(): string {
  const p = partsInShopTz(new Date());
  const guess = Date.UTC(p.year, p.month - 1, 1);
  return new Date(guess - shopOffsetMs(new Date(guess))).toISOString();
}

/** 日期時間，例如「8/26 晚上8:55」 */
export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: SHOP_TIMEZONE,
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 完整日期時間，含年份。給後台的稽核紀錄用 */
export function formatFullDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: SHOP_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 只有日期，例如「2026/8/26」 */
export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('zh-TW', {
    timeZone: SHOP_TIMEZONE,
  });
}

/** 到期日的短格式，例如「11/03」 */
export function formatShortDate(iso: string | Date): string {
  const p = partsInShopTz(new Date(iso));
  return `${p.month}/${String(p.day).padStart(2, '0')}`;
}
