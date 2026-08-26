/**
 * 時區換算的測試。
 *
 *   node scripts/test-time.mjs
 *
 * 時間錯了不會噴錯，只會安靜地顯示成別的數字，人眼很難看出來 ——
 * 之前客人的明細頁少了 8 小時就這樣過了好幾週。所以這裡把答案寫死
 * 比對，任何一項不合就讓指令失敗。
 *
 * 刻意在 TZ=UTC 底下跑，因為 Vercel 就是 UTC；本機開發如果在別的
 * 時區，錯誤會被本機環境蓋掉而測不出來。
 */
import { execFileSync } from 'node:child_process';

if (process.env.TZ !== 'UTC') {
  // 用 Vercel 的時區重跑自己，避免本機時區把問題蓋掉
  execFileSync(process.execPath, [new URL(import.meta.url).pathname], {
    env: { ...process.env, TZ: 'UTC' },
    stdio: 'inherit',
  });
  process.exit(0);
}

const SHOP_TIMEZONE = 'Asia/Taipei';

function partsInShopTz(instant) {
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
  const p = {};
  for (const { type, value } of f.formatToParts(instant)) {
    if (type !== 'literal') p[type] = Number(value);
  }
  if (p.hour === 24) p.hour = 0;
  return p;
}

function shopOffsetMs(instant) {
  const p = partsInShopTz(instant);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    instant.getTime()
  );
}

function dayStartFor(nowIso, offsetDays = 0) {
  const p = partsInShopTz(new Date(nowIso));
  const guess = Date.UTC(p.year, p.month - 1, p.day - offsetDays);
  return new Date(guess - shopOffsetMs(new Date(guess))).toISOString();
}

/*
  把各種 Unicode 空白正規化成一般空格再比對。

  zh-TW 在「8/26」與「上午9:30」之間放的是 U+2009 細空格，而且這個
  分隔符在不同 ICU 版本之間換過好幾次（一般空格、細空格、窄不斷行
  空格）。寫死的話測試會隨著 Node 升級莫名其妙壞掉，而那跟我們要
  驗的時區完全無關。
*/
function fmt(iso) {
  return new Date(iso)
    .toLocaleString('zh-TW', {
      timeZone: SHOP_TIMEZONE,
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    .replace(/[\s  -  ]+/g, ' ');
}

let failed = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) console.log(`      得到 ${got}\n      應為 ${want}`);
}

console.log('\n[1] 顯示時間（台北 = UTC+8）');
check('12:55 UTC → 台北 下午 8:55', fmt('2026-08-26T12:55:42Z'), '8/26 下午8:55');
check('14:28 UTC → 台北 下午 10:28', fmt('2026-08-26T14:28:19Z'), '8/26 下午10:28');
check('01:30 UTC → 台北 上午 9:30', fmt('2026-08-26T01:30:00Z'), '8/26 上午9:30');
check('16:00 UTC → 台北 隔天 上午 12:00', fmt('2026-08-25T16:00:00Z'), '8/26 上午12:00');

console.log('\n[2] 「今日」的分界是台北午夜，不是 UTC 午夜');
// 台北 8/26 00:00 = UTC 8/25 16:00
check(
  '台北時間 8/26 上午 9 點時，今日起點',
  dayStartFor('2026-08-26T01:00:00Z'),
  '2026-08-25T16:00:00.000Z',
);
check(
  '台北時間 8/26 晚上 11 點時，今日起點仍是同一天',
  dayStartFor('2026-08-26T15:00:00Z'),
  '2026-08-25T16:00:00.000Z',
);

console.log('\n[3] 跨日的邊界');
// UTC 8/25 15:59 = 台北 8/25 23:59，還算前一天
check(
  '台北 8/25 23:59 → 今日起點是 8/25',
  dayStartFor('2026-08-25T15:59:00Z'),
  '2026-08-24T16:00:00.000Z',
);
// UTC 8/25 16:00 = 台北 8/26 00:00，換日了
check(
  '台北 8/26 00:00 → 今日起點跳到 8/26',
  dayStartFor('2026-08-25T16:00:00Z'),
  '2026-08-25T16:00:00.000Z',
);

console.log('\n[4] 舊寫法的錯誤（確認測試抓得到）');
const oldWay = (() => {
  const d = new Date('2026-08-26T01:00:00Z');
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
})();
console.log(`  舊的 startOfDay() 在 UTC 環境給出 ${oldWay}`);
console.log(`  新的           給出 ${dayStartFor('2026-08-26T01:00:00Z')}`);
check(
  '兩者確實不同（差 8 小時）',
  String(
    (Date.parse(oldWay) - Date.parse(dayStartFor('2026-08-26T01:00:00Z'))) /
      3600000,
  ),
  '8',
);

console.log(
  failed === 0 ? '\n全部通過。\n' : `\n有 ${failed} 項不符。\n`,
);
process.exit(failed === 0 ? 0 : 1);
