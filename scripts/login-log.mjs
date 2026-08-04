/**
 * 讀登入診斷紀錄。
 *
 *   node --env-file=.env.local scripts/login-log.mjs
 *
 * 客人回報登不進去時跑這個，會直接指出失敗在哪一步以及該查什麼。
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const MEANING = {
  login_success: ['成功', '登入完成'],
  login_rejected_by_line: [
    'LINE 端拒絕',
    'Channel 可能還在 Developing（只有管理員能登入），或客人按了取消',
  ],
  login_bad_state: [
    'state 驗證失敗',
    'SESSION_SECRET 變更過，或客人停在授權畫面超過 15 分鐘',
  ],
  login_missing_params: [
    '參數不完整',
    'LINE 沒有帶回 code 或 state，通常是 Callback URL 設定不符',
  ],
  login_api_failed: [
    'LINE API 失敗',
    'Channel secret 錯誤，或 Callback URL 與設定不一致',
  ],
  login_line_api_failed: [
    'LINE API 失敗',
    'Channel secret 錯誤，或 Callback URL 與設定不一致',
  ],
  login_user_upsert_failed: ['建立會員失敗', '資料庫問題'],
  login_blocked: ['帳號已停用', '這個會員被封鎖了'],
  login_unbound_state: ['成功（cookie 遺失）', 'LINE 內建瀏覽器，已容錯放行'],
};

const { data, error } = await db
  .from('audit_logs')
  .select('action, detail, actor_id, created_at')
  .like('action', 'login_%')
  .order('created_at', { ascending: false })
  .limit(30);

if (error) {
  console.error('讀取失敗：', error.message);
  process.exit(1);
}

if (!data.length) {
  console.log('\n還沒有任何登入紀錄。');
  console.log('請客人試一次登入，再跑一次這個指令。\n');
  process.exit(0);
}

console.log(`\n最近 ${data.length} 筆登入紀錄\n`);

for (const row of data) {
  const [label, hint] = MEANING[row.action] ?? [row.action, ''];
  const時間 = new Date(row.created_at).toLocaleString('zh-TW');
  const ok = row.action === 'login_success' || row.action === 'login_unbound_state';

  console.log(`${ok ? '✓' : '✗'} ${時間}  ${label}`);
  if (hint && !ok) console.log(`    可能原因：${hint}`);

  const detail = row.detail ?? {};
  for (const [k, v] of Object.entries(detail)) {
    if (k === '提示') continue;
    console.log(`    ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  if (detail.提示) console.log(`    → ${detail.提示}`);
  console.log('');
}

const failures = data.filter(
  (r) => r.action !== 'login_success' && r.action !== 'login_unbound_state',
);

if (failures.length > 0) {
  const top = failures[0];
  console.log('─'.repeat(56));
  console.log('最近一次失敗：', MEANING[top.action]?.[0] ?? top.action);
  console.log(MEANING[top.action]?.[1] ?? '');
  console.log('');
}
