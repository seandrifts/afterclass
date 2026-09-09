import 'server-only';

import { db } from './supabase';
import { shopDayStart, shopMonthStart } from './time';

/*
  日界一律用店家時區。

  原本是 new Date().setHours(0,0,0,0)，在 Vercel（UTC）上等於台北
  早上八點才換日，前一晚的生意會被算進隔天。
*/
const startOfDay = shopDayStart;
const startOfMonth = shopMonthStart;

export interface DashboardStats {
  todayIssued: number;
  todayDrawn: number;
  todayRedeemedCount: number;
  todayRedeemedTotal: number;

  monthRedeemedTotal: number;
  monthEarnedTotal: number;
  monthExpiredTotal: number;
  monthNewMembers: number;

  /** 流通中點數。客人手上還沒用掉的餘額總和，這是帳面負債 */
  outstanding: number;
  expiringSoonAmount: number;
  expiringSoonPeople: number;

  activeTokensLeft: number;

  /** 這個必須永遠是 0。非 0 代表有人繞過 ledger 動了餘額 */
  integrityBreaches: number;

  /** 每日排程最後一次執行時間。null 代表從來沒跑過 */
  lastCronAt: string | null;

  /**
   * 距離上次排程幾小時。null 代表從來沒跑過。
   *
   * 在這裡算而不是在元件裡算，因為 Date.now() 是不純的，
   * 元件應該只負責呈現已經算好的數字。
   */
  cronAgeHours: number | null;

  /**
   * report_totals 這個資料庫函式還沒安裝。
   *
   * 為什麼要有這個旗標：migration 是人工貼進 Supabase SQL 編輯器跑的，
   * 有可能忘記。忘記時上面那些數字全部會是 0，畫面必須講清楚那是
   * 「還沒安裝」而不是「今天沒生意」，否則老闆會照著假數字做決定。
   */
  totalsMissing: boolean;
}

/**
 * 後台首頁的統計。
 *
 * 加總全部在 report_totals() 裡用 SQL 做完（見 0008 migration）。
 * 原本是把資料列整批拉回來用 JS 加總，那會撞上 PostgREST 的單次
 * 回傳筆數上限，超過就靜靜地少算。
 */
export async function loadDashboard(
  expireWarnDays: number,
): Promise<DashboardStats> {
  const warnCutoff = new Date();
  warnCutoff.setDate(warnCutoff.getDate() + expireWarnDays);

  const [totals, integrity, lastCron] = await Promise.all([
    db()
      .rpc('report_totals', {
        p_day_start: startOfDay(),
        p_month_start: startOfMonth(),
        p_warn_cutoff: warnCutoff.toISOString(),
      })
      .maybeSingle<ReportTotals>(),
    db().rpc('check_balance_integrity'),
    db()
      .from('audit_logs')
      .select('created_at')
      .eq('action', 'cron_daily')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const t = totals.data;

  return {
    todayIssued: num(t?.today_issued),
    todayDrawn: num(t?.today_drawn),
    todayRedeemedCount: num(t?.today_spend_count),
    todayRedeemedTotal: num(t?.today_spend_total),

    monthRedeemedTotal: num(t?.month_spend_total),
    monthEarnedTotal: num(t?.month_earn_total),
    monthExpiredTotal: num(t?.month_expire_total),
    monthNewMembers: num(t?.month_new_members),

    outstanding: num(t?.outstanding),
    expiringSoonAmount: num(t?.expiring_amount),
    expiringSoonPeople: num(t?.expiring_people),

    activeTokensLeft: num(t?.active_tokens),

    integrityBreaches: Array.isArray(integrity.data)
      ? integrity.data.length
      : 0,

    lastCronAt: lastCron.data?.created_at ?? null,
    cronAgeHours: lastCron.data?.created_at
      ? (Date.now() - new Date(lastCron.data.created_at).getTime()) / 3_600_000
      : null,

    totalsMissing: !t,
  };
}

export interface ReportTotals {
  today_issued: number;
  today_drawn: number;
  today_spend_count: number;
  today_spend_total: number;
  month_spend_total: number;
  month_earn_total: number;
  month_expire_total: number;
  month_new_members: number;
  outstanding: number;
  outstanding_people: number;
  expiring_amount: number;
  expiring_people: number;
  active_tokens: number;
}

/**
 * 點數頁需要的那幾項。
 *
 * 跟首頁走同一個函式，加總規則只有一份。兩邊各寫一份 SQL 的話，
 * 「流通中點數」遲早會在兩個頁面顯示不同的值。
 */
export async function loadCreditTotals(
  expireWarnDays: number,
): Promise<ReportTotals | null> {
  const warnCutoff = new Date();
  warnCutoff.setDate(warnCutoff.getDate() + expireWarnDays);

  const { data } = await db()
    .rpc('report_totals', {
      p_day_start: startOfDay(),
      p_month_start: startOfMonth(),
      p_warn_cutoff: warnCutoff.toISOString(),
    })
    .maybeSingle<ReportTotals>();

  return data ?? null;
}

/** bigint 經過 JSON 可能是字串，統一轉成數字 */
function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : Number(v) || 0;
}
