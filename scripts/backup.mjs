/**
 * 資料備份。
 *
 *   node --env-file=.env.local scripts/backup.mjs
 *   node --env-file=.env.local scripts/backup.mjs --verify backups/xxx.json
 *
 * Supabase 免費方案沒有任何自動備份。資料量目前四百筆，用不著為了備份
 * 升級付費方案 —— 但也不能什麼都不做，客人的點數餘額弄丟是不能重來的。
 *
 * 還原是兩件事湊起來：
 *
 *   schema、函式、觸發器   已經在 supabase/migrations/ 裡，跟著 git 走
 *   資料                   這支腳本匯出的 JSON
 *
 * 所以備份只需要顧資料。真的出事時，開一個新的 Supabase 專案、依序跑
 * migrations、再把 JSON 灌回去就好。
 *
 * 輸出含客人的 LINE ID 與暱稱，是個資。預設寫到 backups/，那個資料夾
 * 已經在 .gitignore 裡 —— 千萬不要 commit 進 repo。
 */
import { createClient } from '@supabase/supabase-js';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/*
  順序有意義：還原時要照這個順序插入，否則外鍵會失敗。
  跟 0001_init.sql 建表的順序一致。
*/
const TABLES = [
  'settings',
  'staff',
  'prizes',
  'token_batches',
  'users',
  'draw_tokens',
  'balance_transactions',
  'coupons',
  'prize_change_log',
  'audit_logs',
  'notifications',
];

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/*
  migrations 裡宣告了哪些欄位。

  第一次呼叫才讀檔並切成語句，之後重用 —— 這些 const 寫在檔尾，
  模組載入時還沒初始化，直接用會 ReferenceError。
*/
let statementsCache = null;

function sqlStatements() {
  if (statementsCache) return statementsCache;

  const sql = readdirSync('supabase/migrations')
    .sort()
    .map((f) => readFileSync('supabase/migrations/' + f, 'utf8'))
    .join('\n');

  // 先去掉 -- 註解行，否則語句開頭會是註解，^create table 對不上
  statementsCache = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';');

  return statementsCache;
}

function declaredColumns(table) {
  const set = new Set();

  for (const raw of sqlStatements()) {
    const st = raw.trim();

    // create table X ( ... )
    const create = new RegExp(`^create table ${table}\\s*\\(([\\s\\S]*)\\)$`, 'i');
    const m = st.match(create);
    if (m) {
      for (const line of m[1].split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('--')) continue;
        const col = t.match(/^([a-z_][a-z0-9_]*)\s+[a-z]/i);
        if (
          col &&
          !/^(primary|unique|check|constraint|foreign|references)$/i.test(col[1])
        ) {
          set.add(col[1]);
        }
      }
    }

    /*
      alter table X add column A, add column B

      一句可以加好幾欄，所以要用 g 旗標把全部抓出來。只抓第一個的話
      0004 那句「add column push_enabled, add column push_expiry_enabled」
      會漏掉後者，然後誤報成「備份有、schema 沒有」。
    */
    if (new RegExp(`^alter table\\s+${table}\\b`, 'i').test(st)) {
      const re = /add column\s+(?:if not exists\s+)?([a-z_][a-z0-9_]*)/gi;
      let a;
      while ((a = re.exec(st))) set.add(a[1]);
    }
  }

  return set;
}

const verifyPath = process.argv.includes('--verify')
  ? process.argv[process.argv.indexOf('--verify') + 1]
  : null;

if (verifyPath) {
  await verify(verifyPath);
} else {
  await backup();
}

async function backup() {
  const dir = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'backups';
  mkdirSync(dir, { recursive: true });

  const dump = { takenAt: new Date().toISOString(), tables: {} };
  let total = 0;
  let failed = 0;

  console.log('\n備份中\n');

  for (const table of TABLES) {
    /*
      分頁抓。Supabase 預設一次最多回一千筆，資料長大之後直接 select
      會安靜地只拿到前一千筆 —— 備份少了資料卻不會報錯，是最糟的失敗
      方式。所以這裡一定要抓到回傳筆數少於一頁為止。
    */
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from(table)
        .select('*')
        .range(from, from + PAGE - 1);

      if (error) {
        console.log(`  ✗ ${table.padEnd(22)} ${error.message}`);
        failed++;
        break;
      }
      rows.push(...data);
      if (data.length < PAGE) break;
    }

    dump.tables[table] = rows;
    total += rows.length;
    console.log(`  ✓ ${table.padEnd(22)} ${String(rows.length).padStart(6)} 筆`);
  }

  if (failed > 0) {
    console.log(`\n有 ${failed} 個資料表讀不到，這份備份不完整，不要拿它當依據。\n`);
    process.exit(1);
  }

  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[:T]/g, '')
    .replace(/-/g, '');
  const file = path.join(dir, `afterclass-${stamp}.json`);
  writeFileSync(file, JSON.stringify(dump, null, 2));

  const kb = Math.round(statSync(file).size / 1024);
  console.log(`\n  ${file}  ${kb} KB  共 ${total} 筆\n`);

  // 立刻讀回來驗一次。寫壞的備份跟沒有備份一樣，但更危險
  await verify(file);
}

async function verify(file) {
  console.log('驗證備份檔\n');

  let dump;
  try {
    dump = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`  ✗ 讀不到或不是合法的 JSON：${e.message}\n`);
    process.exit(1);
  }

  let bad = 0;

  for (const table of TABLES) {
    const backedUp = dump.tables?.[table];
    if (!Array.isArray(backedUp)) {
      console.log(`  ✗ ${table.padEnd(22)} 備份檔裡沒有這個資料表`);
      bad++;
      continue;
    }

    // 跟線上現況比對筆數。有落差不一定是壞事（備份之後又有人消費），
    // 但備份比線上多就一定有問題
    const { count, error } = await db
      .from(table)
      .select('*', { head: true, count: 'exact' });

    if (error) {
      console.log(`  ? ${table.padEnd(22)} 線上讀不到，無法比對`);
      continue;
    }

    const diff = count - backedUp.length;
    const mark = backedUp.length > count ? '✗' : '✓';
    if (backedUp.length > count) bad++;

    console.log(
      `  ${mark} ${table.padEnd(22)} 備份 ${String(backedUp.length).padStart(6)}` +
        `  線上 ${String(count).padStart(6)}` +
        (diff > 0 ? `  （備份後又新增 ${diff} 筆）` : ''),
    );
  }

  /*
    欄位要對得回 migrations。

    還原是「跑 migrations 建結構 + 灌 JSON 進去」，所以備份多一個欄位
    就代表那份資料無處可放，少一個欄位就代表還原後那一欄是空的。筆數
    對得上不代表還原得回來，這一項才是。
  */
  console.log('');
  for (const [table, rows] of Object.entries(dump.tables)) {
    if (!rows.length) continue;
    const declared = declaredColumns(table);
    if (declared.size === 0) {
      console.log(`  ? ${table.padEnd(22)} migrations 裡找不到建表語句`);
      bad++;
      continue;
    }
    const actual = new Set(Object.keys(rows[0]));
    const missing = [...declared].filter((c) => !actual.has(c));
    const extra = [...actual].filter((c) => !declared.has(c));
    if (missing.length || extra.length) {
      bad++;
      console.log(
        `  ✗ ${table.padEnd(22)}` +
          (missing.length ? ` 備份缺 ${missing.join(', ')}` : '') +
          (extra.length ? ` / migrations 沒宣告 ${extra.join(', ')}` : ''),
      );
    }
  }
  if (bad === 0) console.log('  ✓ 所有欄位都對得回 migrations');

  /*
    最重要的一項：備份裡的餘額跟流水帳對不對得起來。

    這是整個系統唯一不能妥協的不變量。備份如果連這個都不成立，還原
    之後帳就是錯的，而且很難查出是從哪一刻開始錯的。
  */
  const users = dump.tables?.users ?? [];
  const txns = dump.tables?.balance_transactions ?? [];
  const sum = new Map();
  for (const t of txns) {
    sum.set(t.user_id, (sum.get(t.user_id) ?? 0) + t.amount);
  }
  const broken = users.filter((u) => (sum.get(u.id) ?? 0) !== u.balance);

  console.log('');
  if (broken.length === 0) {
    console.log('  ✓ 備份內的餘額與流水帳一致');
  } else {
    console.log(`  ✗ 備份內有 ${broken.length} 個帳戶餘額與流水帳對不上`);
    bad++;
  }

  console.log(
    bad === 0
      ? '\n這份備份可用。\n\n還原方式：開新的 Supabase 專案 → 依序執行 supabase/migrations/ → 照 TABLES 的順序把 JSON 灌回去。\n'
      : `\n有 ${bad} 項不對，不要拿這份當依據。\n`,
  );

  process.exit(bad === 0 ? 0 : 1);
}
