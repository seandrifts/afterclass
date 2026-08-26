/**
 * 中文字型裁切。
 *
 *   node scripts/subset-font.mjs <來源.ttf>
 *
 * 中文字型動輒四五 MB，因為要涵蓋數萬個字。客人在店門口用行動網路
 * 掃 QR，光等字型下載就要好幾秒，這期間畫面是空的或用系統字閃一下
 * 再跳字，體驗很差。
 *
 * 做法是只保留真正會用到的字。分成兩份：
 *
 *   core  介面固定文案 + 常用漢字，隨頁面立即載入
 *   ext   次常用漢字，用 unicode-range 讓瀏覽器只在遇到時才抓
 *
 * 客人名稱與老闆自訂的獎項名稱是動態的，可能出現任何字，所以 ext
 * 要留足餘裕；真的超出範圍時瀏覽器會自動退回系統字，不會變成方框。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('用法：node scripts/subset-font.mjs <來源.ttf>');
  process.exit(1);
}

const OUT_DIR = 'src/app/fonts';
mkdirSync(OUT_DIR, { recursive: true });

const kb = (p) => Math.round(statSync(p).size / 1024);

// ---------------------------------------------------------------
// 1. 蒐集介面實際用到的字
// ---------------------------------------------------------------
const used = new Set();

const collect = (pattern) => {
  for (const file of globSync(pattern)) {
    for (const ch of readFileSync(file, 'utf8')) used.add(ch);
  }
};

collect('src/**/*.{ts,tsx}');
collect('supabase/**/*.sql');

// ---------------------------------------------------------------
// 2. 常用漢字。動態內容（客人暱稱、老闆打的獎項名稱）會用到這些
// ---------------------------------------------------------------
const COMMON = `
的一是不了人我在有他這為之大來以個中上們到說國和地也子時道出而要於就下得可你年生
自會那後能對著事其裡所去行過家十用發天如然作方成者多日都三小軍二無同麼經法當起與
好看學進種將還分此心前面又定見只主沒公從問點代明知起本高反業向十正身法民第使被水
現實加量長聲請或位入常文總次品式活設及管特件長求老頭基資邊流路級少圖山統接知較將
組每計別她手角期根論運農指幾九區強放決西被幹做必戰先回則任取據處隊南給色光門即保
治北造百規熱領七海口東導器壓志世金增爭濟階油思術極交受聯什認六共權收證改清己美再
採轉更單風切打白教速花帶安場身車例真務具萬每目至達走積示議聲報鬥完類八離華名確才
科張信馬節話米整空元況今集溫傳土許步群廣石記需段研界拉林律叫且究觀越織裝影算低持
音眾書布復容兒須際商非驗連斷深難近礦千週委素技備半辦青省列習響約支般史感勞便團往
酸歷市克何除消構府稱太準精值號率族維劃選標寫存候毛親快效斯院查江型眼王按格養易置
派層片始卻專狀育廠京識適屬圓包火住調滿縣局照參紅細引聽該鐵價嚴龍飛
店員抽獎折抵點數餘額累積到期回饋序號掃描核銷免單金券機率成本設定推播客人老闆管理
新增儲值查詢確認取消刪除返回登出登入密碼錯誤成功失敗警告提醒通知
`.replace(/\s/g, '');

for (const ch of COMMON) used.add(ch);

// 標點、數字、拉丁字母、常見符號
for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
  used.add(ch);
}
for (const ch of `　、。〈〉《》「」『』【】〔〕！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～·—…‧–！＄％·`) {
  used.add(ch);
}
for (const ch of ` !"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~×÷°±→←↑↓✓✗★☆`) {
  used.add(ch);
}

// ---------------------------------------------------------------
// 3. 切成 core 與 ext
// ---------------------------------------------------------------
const isCJK = (ch) => ch >= '一' && ch <= '鿿';

const core = [...used].filter((c) => c.codePointAt(0) > 31).join('');

/*
  ext 涵蓋整個常用漢字區塊（U+4E00–U+9FFF）扣掉 core 已有的。
  瀏覽器靠 unicode-range 判斷，只有真的遇到才會下載這份。
*/
function subset(outName, text, unicodeRange) {
  const out = path.join(OUT_DIR, outName);
  const args = [
    '-m',
    'fontTools.subset',
    src,
    `--output-file=${out}`,
    '--flavor=woff2',
    '--layout-features=*',
    '--no-hinting',
    '--desubroutinize',
    '--drop-tables+=DSIG',
  ];

  if (text) args.push(`--text=${text}`);
  if (unicodeRange) args.push(`--unicodes=${unicodeRange}`);

  execFileSync('python3', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return out;
}

console.log(`\n來源：${src}  ${kb(src)} KB\n`);

console.log('[1] core（介面文案 + 常用字，立即載入）');
const coreFile = subset('kanzimi-core.woff2', core);
console.log(`  ✓ ${path.basename(coreFile)}  ${kb(coreFile)} KB  （${core.length} 字）`);

console.log('\n[2] ext（其餘常用漢字，遇到才載入）');
const extFile = subset('kanzimi-ext.woff2', null, 'U+4E00-9FFF');
console.log(`  ✓ ${path.basename(extFile)}  ${kb(extFile)} KB`);

const total = kb(coreFile) + kb(extFile);
const saved = Math.round((1 - kb(coreFile) / kb(src)) * 100);
console.log(
  `\n首次載入只需 ${kb(coreFile)} KB（原始 ${kb(src)} KB，省 ${saved}%）`,
);
console.log(`兩份合計 ${total} KB，ext 只有遇到罕用字才會下載。\n`);

writeFileSync(
  path.join(OUT_DIR, 'README.md'),
  `# 字型

由 \`scripts/subset-font.mjs\` 從原始 TTF 裁切產生，請勿手動編輯。

- \`kanzimi-core.woff2\` 介面文案與常用字，隨頁面立即載入
- \`kanzimi-ext.woff2\` 其餘常用漢字，靠 unicode-range 延後載入

換字型或新增大量新文案後重新產生：

    node scripts/subset-font.mjs /路徑/字型.ttf
`,
);
