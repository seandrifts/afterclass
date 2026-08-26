/**
 * 連線自我檢查。
 *
 *   node --env-file=.env.local scripts/check-connection.mjs
 *
 * 確認環境變數齊全、連得上 Supabase、schema 與初始資料正確、
 * 老闆 PIN 已設定。任何一項失敗都會指出該去修哪裡。
 *
 * 刻意不印出任何金鑰的內容，只印長度與前綴。
 */
import { createClient } from '@supabase/supabase-js';

let failed = 0;

function ok(label, detail = '') {
  console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
}

function bad(label, hint) {
  failed += 1;
  console.log(`  ✗ ${label}`);
  if (hint) console.log(`     → ${hint}`);
}

console.log('\n[1] 環境變數');

const REQUIRED = [
  ['SITE_URL', false],
  ['NEXT_PUBLIC_SUPABASE_URL', false],
  ['SUPABASE_SERVICE_ROLE_KEY', true],
  ['SESSION_SECRET', true],
  ['CRON_SECRET', true],
];

for (const [name, secret] of REQUIRED) {
  const value = process.env[name];
  if (!value) {
    bad(name, '在 .env.local 裡填上這一項');
    continue;
  }
  ok(name, secret ? `已填入（${value.length} 字元）` : value);
}

if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
  bad('SESSION_SECRET 太短', '至少 32 字元，用 openssl rand -base64 32 重新產生');
}

const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (key.startsWith('sb_publishable_')) {
  bad(
    '這是 Publishable key，不是 Secret key',
    'Publishable key 受 RLS 限制，讀不到任何資料。請改複製 Secret keys 區塊那把 sb_secret_ 開頭的',
  );
} else if (key && !key.startsWith('sb_secret_') && !key.startsWith('eyJ')) {
  bad('Secret key 格式看起來不對', '應該是 sb_secret_ 開頭（新版）或 eyJ 開頭（舊版 service_role）');
}

if (failed > 0) {
  console.log('\n環境變數有問題，先修好再繼續。\n');
  process.exit(1);
}

console.log('\n[2] 連線與 schema');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const settings = await db.from('settings').select('*').eq('id', 1).maybeSingle();

if (settings.error) {
  bad(`連不上或讀不到 settings：${settings.error.message}`,
    settings.error.message.includes('does not exist')
      ? '資料表還沒建立，請先執行 supabase/migrations/0001_init.sql'
      : '確認 URL 與 Secret key 是否正確');
  console.log('');
  process.exit(1);
}

if (!settings.data) {
  bad('settings 沒有資料', '0001_init.sql 應該會自動插入一列，請重新執行');
  process.exit(1);
}

ok('連線成功');

const s = settings.data;
ok('settings', `到期 ${s.credit_expire_days} 天 / 單次上限 ${s.max_redeem_per_visit} 元`);

console.log('\n[3] 初始資料');

const prizes = await db
  .from('prizes')
  .select('name, type, credit_amount, cost, weight')
  .eq('is_active', true)
  .gt('weight', 0)
  .order('sort_order');

if (prizes.error) {
  bad(`讀不到 prizes：${prizes.error.message}`);
} else {
  const rows = prizes.data;
  const total = rows.reduce((a, r) => a + r.weight, 0);
  const cost = rows.reduce((a, r) => a + (r.weight / total) * r.cost, 0);

  if (rows.length === 0) {
    bad('沒有任何獎項', '執行 supabase/seed.sql');
  } else if (rows.length !== 8) {
    bad(
      `獎項有 ${rows.length} 個（預期 8）`,
      rows.length > 8
        ? 'seed.sql 可能跑了不只一次。delete from prizes; 之後只重跑 insert 那段'
        : '確認 seed.sql 完整執行',
    );
  } else {
    ok('獎項', `${rows.length} 個，權重合計 ${total}`);
    ok('名目期望成本', `${cost.toFixed(2)} 元 / 客`);
  }

  console.log('');
  for (const r of rows) {
    const pct = ((r.weight / total) * 100).toFixed(2).padStart(6);
    console.log(`     ${pct}%  ${r.name}`);
  }
}

console.log('\n[4] 店員帳號');

const staff = await db.from('staff').select('name, role, pin_hash, is_active');

if (staff.error) {
  bad(`讀不到 staff：${staff.error.message}`);
} else if (staff.data.length === 0) {
  bad('沒有任何店員帳號', '執行 supabase/seed.sql');
} else {
  for (const person of staff.data) {
    const placeholder = person.pin_hash.includes('REPLACE_ME');
    if (placeholder) {
      bad(
        `${person.name}（${person.role}）的 PIN 還是佔位值`,
        "產生真的：node -e \"console.log(require('bcryptjs').hashSync('你的PIN', 10))\"，" +
          "再 update staff set pin_hash = '...' where role = 'owner';",
      );
    } else {
      ok(`${person.name}（${person.role}）`, 'PIN 已設定');
    }
  }
}

console.log('\n[5] 餘額帳務一致性');

const integrity = await db.rpc('check_balance_integrity');

if (integrity.error) {
  bad(`函式呼叫失敗：${integrity.error.message}`,
    '確認 supabase/migrations/0002_functions.sql 已執行');
} else if (integrity.data.length > 0) {
  bad(
    `${integrity.data.length} 個帳戶的餘額與流水帳對不上`,
    '有人繞過流水帳直接改了餘額。這是最高優先級的問題',
  );
} else {
  /*
    這裡本來寫死「目前 0 筆交易」。剛上線時是對的，之後就一直印著
    同一句話，等於自我檢查在報一個過期的斷言 —— 而自我檢查印出來的
    東西是拿來當判斷依據的，錯的比沒有更糟。改成每次真的去數。
  */
  const ledger = await db
    .from('balance_transactions')
    .select('id', { head: true, count: 'exact' });

  ok(
    '餘額與流水帳一致',
    ledger.error ? '' : `目前 ${ledger.count} 筆交易`,
  );
}

console.log('\n[6] 活動狀態');

if (s.campaign_active) {
  ok('活動進行中', '客人掃碼可以抽獎');
} else {
  ok('活動未開啟', '這是預設值。等店名、獎項、序號都備妥再從後台打開');
}

console.log('\n[7] 資料庫版本');

/*
  逐一確認每個 migration 真的跑過。

  Supabase 的 SQL 編輯器不會記錄你跑過哪些檔案，貼上去執行成功之後
  畫面就沒了，很容易分不清「跑過了」跟「以為跑過了」。所以這裡不看
  紀錄，直接檢查每個檔案應該建立出來的東西存不存在。
*/
const MIGRATIONS = [
  {
    file: '0004_notifications.sql',
    what: '推播紀錄',
    probe: () =>
      db.from('notifications').select('id', { head: true, count: 'exact' }),
  },
  {
    file: '0005_batch_stats.sql',
    what: '批次統計',
    probe: () => db.rpc('batch_stats'),
  },
  {
    file: '0006_lockout_ladder.sql',
    what: '登入鎖定階梯',
    probe: () => db.from('staff').select('lockout_level').limit(1),
  },
];

for (const m of MIGRATIONS) {
  const { error } = await m.probe();
  if (error) {
    bad(`${m.file}（${m.what}）還沒執行`, `Supabase SQL Editor 貼上 supabase/migrations/${m.file} 再跑一次`);
  } else {
    ok(`${m.file}`, m.what);
  }
}

console.log('\n[8] 卡片');

const tokens = await db.from('draw_tokens').select('status, kind, expires_at');

if (tokens.error) {
  bad(`讀不到卡片：${tokens.error.message}`);
} else {
  const now = Date.now();

  /*
    紙卡印出來時是 inactive，店員收錢後才刷成 active。所以「印了幾張」
    跟「客人現在抽得到幾張」是兩件事，這裡分開算。

    active 但已過保存期限的要另外挑出來 —— 它們在資料庫裡看起來還是
    active，但客人掃了會被拒絕，只看狀態欄會誤判。
    */
  const live = tokens.data.filter(
    (t) =>
      t.kind === 'card' &&
      t.status === 'active' &&
      (!t.expires_at || Date.parse(t.expires_at) > now),
  ).length;

  const spare = tokens.data.filter(
    (t) => t.kind === 'card' && t.status === 'inactive',
  ).length;

  if (tokens.data.length === 0) {
    bad(
      '一張卡片都還沒產生',
      '後台「序號卡」建立一批並列印，否則客人掃不到任何東西',
    );
  } else if (live === 0) {
    bad(
      `沒有一張卡片是客人現在抽得到的（庫存 ${spare} 張未啟用）`,
      spare > 0
        ? '卡片印出來是未啟用狀態，要店員端刷過才會生效'
        : '已全部抽完或過期，需要再建一批',
    );
  } else {
    ok('客人抽得到的卡片', `${live} 張`);
    ok('未啟用庫存', `${spare} 張`);
  }
}

console.log(
  failed === 0
    ? '\n全部通過。可以 npm run dev 了。\n'
    : `\n有 ${failed} 項需要處理。\n`,
);

process.exit(failed === 0 ? 0 : 1);
