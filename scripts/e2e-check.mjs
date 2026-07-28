/**
 * 線上流程驗證。
 *
 *   node --env-file=.env.local scripts/e2e-check.mjs <站台網址>
 *
 * 建立一組拋棄式測試序號，實際打線上 API 走完抽獎與領取，
 * 驗證餘額入帳、折抵上限、冪等保護、帳務一致性，最後把測試資料清乾淨。
 *
 * 用測試專用的會員與序號，不會汙染真實數據。
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const base = (process.argv[2] ?? process.env.SITE_URL ?? '').replace(/\/$/, '');
if (!base) {
  console.error('用法：node --env-file=.env.local scripts/e2e-check.mjs <站台網址>');
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let failed = 0;
const ok = (m, d = '') => console.log(`  ✓ ${m}${d ? `  ${d}` : ''}`);
const bad = (m, d = '') => {
  failed += 1;
  console.log(`  ✗ ${m}${d ? `  ${d}` : ''}`);
};

const TEST_CODE = `E2E${Date.now().toString().slice(-5)}`;
const TEST_WALLET = `E2EW${Date.now().toString().slice(-6)}`;
let userId = null;

async function cleanup() {
  if (userId) {
    await db.from('balance_transactions').delete().eq('user_id', userId);
    await db.from('coupons').delete().eq('user_id', userId);
  }
  await db.from('draw_tokens').delete().eq('code', TEST_CODE);
  if (userId) await db.from('users').delete().eq('id', userId);
}

try {
  console.log(`\n目標：${base}\n`);
  console.log('[1] 建立測試資料');

  const settings = await db.from('settings').select('*').eq('id', 1).single();
  const s = settings.data;

  const wasActive = s.campaign_active;
  if (!wasActive) {
    await db.from('settings').update({ campaign_active: true }).eq('id', 1);
    ok('暫時開啟活動', '（測試完會還原）');
  }

  await db.from('draw_tokens').insert({
    code: TEST_CODE,
    kind: 'card',
    status: 'active',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  ok('測試序號', TEST_CODE);

  const u = await db
    .from('users')
    .insert({
      line_user_id: `E2E_${randomUUID()}`,
      display_name: '流程測試',
      wallet_code: TEST_WALLET,
    })
    .select('id')
    .single();
  userId = u.data.id;
  ok('測試會員', TEST_WALLET);

  console.log('\n[2] 抽獎 API');

  const draw = await fetch(`${base}/api/draw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: TEST_CODE }),
  });
  const drawJson = await draw.json();

  if (!draw.ok) {
    bad('抽獎失敗', JSON.stringify(drawJson));
    throw new Error('stop');
  }
  ok('抽中', `${drawJson.prize.name}（${drawJson.prize.type}）`);

  const again = await fetch(`${base}/api/draw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: TEST_CODE }),
  });
  if (again.ok) bad('同一序號可以抽第二次');
  else ok('重複抽獎被擋', `HTTP ${again.status}`);

  console.log('\n[3] 領取入帳');

  // 領取需要登入態。這裡直接呼叫資料庫函式，驗證的是入帳邏輯本身；
  // LINE 授權那一段只能用真人帳號在瀏覽器測。
  const claim = await db
    .rpc('claim_token', {
      p_code: TEST_CODE,
      p_user_id: userId,
      p_redeem_code: String(Math.floor(100000 + Math.random() * 900000)),
    })
    .single();

  if (claim.error || !claim.data.ok) {
    bad('領取失敗', claim.error?.message ?? claim.data.reason);
    throw new Error('stop');
  }

  const isCredit = claim.data.prize_type === 'credit';
  ok('領取成功', isCredit
    ? `入帳 ${claim.data.credit_added} 元，餘額 ${claim.data.new_balance}`
    : `產生實物券 ${claim.data.coupon_id}`);

  const after = await db
    .from('users')
    .select('balance, balance_expires_at')
    .eq('id', userId)
    .single();

  if (isCredit && after.data.balance !== claim.data.new_balance) {
    bad('餘額與回傳值不符');
  } else if (isCredit) {
    const days = Math.round(
      (new Date(after.data.balance_expires_at) - Date.now()) / 86_400_000,
    );
    ok('到期日已設定', `${days} 天後（設定值 ${s.credit_expire_days}）`);
  }

  if (isCredit) {
    console.log('\n[4] 折抵保護');

    const over = await db.rpc('redeem_balance', {
      p_user_id: userId,
      p_amount: s.max_redeem_per_visit + 1,
      p_staff_id: null,
      p_idempotency_key: randomUUID(),
    });
    if (over.error?.message.includes('EXCEEDS_PER_VISIT_LIMIT')) {
      ok('超過單次上限被擋', `上限 ${s.max_redeem_per_visit} 元`);
    } else {
      bad('超額折抵沒被擋下');
    }

    const balance = after.data.balance;
    if (balance >= 1) {
      const key = randomUUID();
      const r1 = await db
        .rpc('redeem_balance', {
          p_user_id: userId,
          p_amount: 1,
          p_staff_id: null,
          p_idempotency_key: key,
        })
        .single();
      ok('折抵 1 元', `剩餘 ${r1.data.new_balance}`);

      const r2 = await db
        .rpc('redeem_balance', {
          p_user_id: userId,
          p_amount: 1,
          p_staff_id: null,
          p_idempotency_key: key,
        })
        .single();
      if (r2.data.replayed && r2.data.new_balance === r1.data.new_balance) {
        ok('重送同一冪等鍵未重複扣款');
      } else {
        bad('冪等保護失效', JSON.stringify(r2.data));
      }
    }
  }

  console.log('\n[5] 帳務一致性');
  const integrity = await db.rpc('check_balance_integrity');
  if (integrity.data?.length > 0) {
    bad(`${integrity.data.length} 個帳戶餘額與流水帳對不上`);
  } else {
    ok('全站餘額與流水帳一致');
  }

  if (!wasActive) {
    await db.from('settings').update({ campaign_active: false }).eq('id', 1);
    ok('活動開關已還原為關閉');
  }
} catch (e) {
  if (e.message !== 'stop') bad('未預期錯誤', e.message);
} finally {
  await cleanup();
  console.log('\n測試資料已清除');
  console.log(failed === 0 ? '\n流程全部通過。\n' : `\n有 ${failed} 項失敗。\n`);
  process.exit(failed === 0 ? 0 : 1);
}
