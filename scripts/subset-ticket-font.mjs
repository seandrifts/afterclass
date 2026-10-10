/*
  裁切抽獎卡（58mm 熱感紙）用的字型。

    node --env-file=.env.local scripts/subset-ticket-font.mjs /路徑/jf-openhuninn-2.1.ttf

  列印頁是一份獨立的 HTML，不經過 Next 的字型載入，所以字型要直接
  嵌在頁面裡。原始 TTF 有 4.7 MB，只留卡片上會出現的字之後剩幾十 KB。

  產物是 src/lib/ticket-font.generated.ts（base64 的 woff2）。用 TS 模組
  而不是字檔，是因為 route handler 部署到 Vercel 之後讀不到原始碼旁邊
  的檔案，import 進來的才保證會被打包。

  收進去的字：
    1. 列印路由原始碼裡出現的所有字（卡片上的固定文案都在那裡）
    2. 英數與常用符號（序號、日期）
    3. 資料庫裡的店名

  改了卡片文案或店名之後要重跑一次，否則新出現的字會退回系統字型，
  同一行裡混兩種字。需要 python3 與 fonttools、brotli。
*/
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('用法：node --env-file=.env.local scripts/subset-ticket-font.mjs <來源.ttf>');
  process.exit(1);
}

const ROUTE = 'src/app/api/admin/tokens/[id]/print/route.ts';
const OUT = 'src/lib/ticket-font.generated.ts';

const used = new Set();
for (const ch of readFileSync(ROUTE, 'utf8')) used.add(ch);
for (let c = 0x20; c < 0x7f; c += 1) used.add(String.fromCharCode(c));
for (const ch of '・‧／－—（）、，。：！？') used.add(ch);

// 店名存在資料庫，原始碼裡看不到。連不上就跳過，只是少收幾個字
try {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const { data } = await db.from('settings').select('shop_name').eq('id', 1).single();
  for (const ch of data?.shop_name ?? '') used.add(ch);
  console.log(`店名：${data?.shop_name ?? '（讀不到）'}`);
} catch (e) {
  console.log(`讀不到店名，略過（${e.message}）`);
}

const text = [...used].filter((ch) => ch >= ' ').join('');
const dir = mkdtempSync(path.join(tmpdir(), 'ticket-font-'));
const textFile = path.join(dir, 'chars.txt');
const woff = path.join(dir, 'ticket.woff2');
writeFileSync(textFile, text);

execFileSync(
  'python3',
  [
    '-m', 'fontTools.subset', src,
    `--text-file=${textFile}`,
    `--output-file=${woff}`,
    '--flavor=woff2',
    '--layout-features=*',
    '--no-hinting',
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

const bytes = readFileSync(woff);

writeFileSync(
  OUT,
  `// 由 scripts/subset-ticket-font.mjs 產生，請勿手動編輯。
// 來源：${path.basename(src)}（jf open 粉圓，SIL Open Font License 1.1）
// 收錄 ${[...text].length} 個字，${Math.round(bytes.length / 1024)} KB

export const TICKET_FONT_WOFF2_BASE64 =
  '${bytes.toString('base64')}';
`,
);

console.log(`${OUT}  ${[...text].length} 個字  ${Math.round(bytes.length / 1024)} KB`);
