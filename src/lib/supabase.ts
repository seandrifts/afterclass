import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from './env';

let client: SupabaseClient | null = null;

/**
 * service_role 客戶端。擁有完整資料庫權限並繞過 RLS。
 *
 * 只能在 Server Component / Route Handler / Server Action 使用。
 * 這個模組有 `server-only`，一旦被 client bundle 引用會在建置時報錯。
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
