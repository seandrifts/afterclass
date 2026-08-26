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

/*
  掃原始碼掃不到的字。

  日期時間是 toLocaleString('zh-TW') 執行時才產生的，原始碼裡看不到
  「上午」「下午」這些字。之前就是漏了「午」，結果客人的明細頁上
  「下午」兩個字分屬兩種字型 —— 因為 core 沒有，瀏覽器改用 ext，
  而 ext 有 1.7 MB，在行動網路下要好幾秒才換過來。

  凡是介面自己會產生的字，都必須進 core。ext 只留給真正無法預期的
  內容（客人的 LINE 暱稱、老闆自己打的獎項名稱）。
*/
const RUNTIME = `
上午下午年月日時分秒星期週天今昨明前後本西元
`.replace(/\s/g, '');

/*
  台灣常見姓氏與菜市場名用字。

  客人的名字來自 LINE 暱稱，理論上什麼字都可能有，但實務上絕大多數
  落在這個範圍。多這幾百個字讓 core 只大一點點，卻能讓大部分客人
  不必為了自己的名字去下載那 1.7 MB。
*/
const NAMES = `
陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅高潘簡
朱鍾游詹胡施沈余趙盧梁顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董
溫唐藍石紀連歐倪嚴牛甘祝熊白田塗巫季婁松武聶
雅婷淑芬怡君佳玲美惠慧文志明家豪俊宏建國瑞祥宗翰冠廷承恩子彥柏
睿宇軒琪欣萱涵語彤宸沐晴心妍芯昀晨希嘉筠茹蓉媛珊琳蕙貞秀鳳霞菊
偉傑倫哲皓凱威廷賢仁義禮智信忠孝勇誠泰豐榮富貴財旺春夏秋冬
`.replace(/\s/g, '');

for (const ch of RUNTIME) used.add(ch);
for (const ch of NAMES) used.add(ch);

/*
  老闆在後台設定的文字。

  店名出現在每一頁最上方，獎項名稱印在轉盤上，兩者都存在資料庫裡，
  掃原始碼看不到。漏掉的話那幾個字會落到 ext —— 也就是每個客人、
  每次開頁都為了店名去下載 1.7 MB。

  「下課後點心坊」就是這樣，「課」和「坊」不在 core，六個字用了兩種
  字型。

  連不上資料庫時就跳過，只是少收幾個字，不該讓裁切整個失敗。
*/
async function shopVocabulary() {
  const envFile = '.env.local';
  const env = {};
  try {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    return '';
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return '';

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(url, key, { auth: { persistSession: false } });
    const [settings, prizes] = await Promise.all([
      db
        .from('settings')
        .select('shop_name, paused_reason, rules_content')
        .eq('id', 1)
        .maybeSingle(),
      db.from('prizes').select('name, terms'),
    ]);
    if (settings.error || prizes.error) {
      // 欄位名打錯之類的問題要講出來，不然會安靜地少收一堆字
      console.warn(
        `  讀不到後台文字：${(settings.error ?? prizes.error).message}`,
      );
      return '';
    }
    return [
      settings.data?.shop_name ?? '',
      settings.data?.paused_reason ?? '',
      settings.data?.rules_content ?? '',
      ...(prizes.data ?? []).flatMap((p) => [p.name ?? '', p.terms ?? '']),
    ].join('');
  } catch {
    return '';
  }
}

const shopText = await shopVocabulary();
for (const ch of shopText) used.add(ch);
console.log(
  shopText
    ? `已納入後台設定的店名與獎項名稱（${new Set(shopText).size} 個相異字）`
    : '（連不上資料庫，這次沒納入店名與獎項名稱）',
);

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

/*
  裁完之後驗一次。

  fontTools 對於來源字型沒有的字會安靜跳過，不會報錯，所以「少字」
  這件事不會自己浮出來。之前漏掉「午」就是這樣過關的，直到客人的
  明細頁上「下午」變成兩種字型才發現。

  比對方式是排除來源字型本來就沒有的字 —— 那些是真的拿不到，不算
  裁切的錯。剩下的只要有一個沒進 core 就讓指令失敗。
*/
function verifyCore(coreFile, wanted) {
  const py = `
import sys, json
from fontTools.ttLib import TTFont
def cmap(p):
    f = TTFont(p, lazy=True); s = set()
    for t in f['cmap'].tables: s |= set(t.cmap.keys())
    return s
have, orig = cmap(sys.argv[1]), cmap(sys.argv[2])
want = json.loads(sys.stdin.read())
print(json.dumps([c for c in want
                  if ord(c) in orig and ord(c) not in have]))
`;
  const out = execFileSync('python3', ['-c', py, coreFile, src], {
    input: JSON.stringify([...wanted]),
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

console.log(`\n來源：${src}  ${kb(src)} KB\n`);

console.log('[1] core（介面文案 + 常用字，立即載入）');
const coreFile = subset('kanzimi-core.woff2', core);
console.log(`  ✓ ${path.basename(coreFile)}  ${kb(coreFile)} KB  （${core.length} 字）`);

const dropped = verifyCore(coreFile, core);
if (dropped.length) {
  console.error(
    `\n✗ core 少了 ${dropped.length} 個來源字型有、卻沒裁進去的字：\n` +
      `  ${dropped.join('')}\n` +
      `  這些字在畫面上會改用 ext（1.7 MB）或系統字，同一句話會出現兩種字型。\n`,
  );
  process.exit(1);
}
console.log('  ✓ 已驗證：介面會用到的字都在 core 裡');

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
