/*
  裁切抽獎卡（58mm 熱感紙）用的字型。

    node --env-file=.env.local scripts/subset-ticket-font.mjs /路徑/jf-openhuninn-2.1.ttf

  抽獎卡是伺服器直接畫出來的 PDF（src/lib/ticket-pdf.ts），字型要嵌進
  PDF 裡。原始 TTF 有 4.7 MB，只留用得到的字之後小很多。

  產物是 src/lib/ticket-font.generated.ts（base64 的 TTF）。用 TS 模組
  而不是字檔，是因為 route handler 部署到 Vercel 之後讀不到原始碼旁邊
  的檔案，import 進來的才保證會被打包。

  收進去的字：
    1. src 底下所有原始碼出現過的字。卡片文案在裡面，其餘介面用字也一併
       收進來，店名改成常見的字多半不必重跑
    2. 英數與常用符號（序號、日期）
    3. 資料庫裡的店名

  PDF 缺字不會自動換字型，會印成空白方框。列印路由在產生前會檢查，
  遇到字型裡沒有的字會直接回報並要求重跑這支腳本。需要 python3 與 fonttools。
*/
import { execFileSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('用法：node --env-file=.env.local scripts/subset-ticket-font.mjs <來源.ttf>');
  process.exit(1);
}

const OUT = 'src/lib/ticket-font.generated.ts';

const used = new Set();
for (const file of globSync('src/**/*.{ts,tsx}')) {
  // 自己的產物是一大串 base64，不必掃
  if (file.endsWith('.generated.ts')) continue;
  for (const ch of readFileSync(file, 'utf8')) used.add(ch);
}
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
const ttf = path.join(dir, 'ticket.ttf');
writeFileSync(textFile, text);

execFileSync(
  'python3',
  [
    '-m', 'fontTools.subset', src,
    `--text-file=${textFile}`,
    `--output-file=${ttf}`,
    '--no-hinting',
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

const bytes = readFileSync(ttf);

writeFileSync(
  OUT,
  `// 由 scripts/subset-ticket-font.mjs 產生，請勿手動編輯。
// 來源：${path.basename(src)}（jf open 粉圓，SIL Open Font License 1.1）
// 收錄 ${[...text].length} 個字，${Math.round(bytes.length / 1024)} KB

export const TICKET_FONT_TTF_BASE64 =
  '${bytes.toString('base64')}';
`,
);

console.log(`${OUT}  ${[...text].length} 個字  ${Math.round(bytes.length / 1024)} KB`);
