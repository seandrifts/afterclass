import 'server-only';

import bcrypt from 'bcryptjs';

import { db } from './supabase';
import type { StaffSession } from './session';

const MAX_FAILURES = 5;

/**
 * 遞增鎖定。
 *
 * 固定 15 分鐘的鎖定，換算下來每天仍可嘗試 480 次。6 位數 PIN
 * 需要 2.9 年才會被猜到，但 4 位數只要 10 天。
 *
 * 改成每次被鎖時間翻倍，攻擊者的嘗試速率會急速下降：
 * 第一次 15 分鐘、接著 1 小時、4 小時、24 小時。連續攻擊一天之後
 * 幾乎完全停擺，而正常店員打錯幾次頂多等 15 分鐘。
 */
const LOCKOUT_LADDER_MINUTES = [15, 60, 240, 1440];

/**
 * PIN 最低長度。
 *
 * 4 位數在現有的鎖定機制下平均 10 天就會被猜中，那是真的會發生的
 * 時間尺度。6 位數是 2.9 年，差距在於組合數多了一百倍。
 */
export const MIN_PIN_LENGTH = 6;

export type LoginResult =
  | { ok: true; session: StaffSession }
  | { ok: false; reason: 'BAD_PIN' | 'LOCKED'; lockedMinutes?: number };

interface StaffRow {
  id: string;
  name: string;
  pin_hash: string;
  role: 'staff' | 'owner';
  is_active: boolean;
  failed_count: number;
  locked_until: string | null;
  lockout_level: number;
}

/**
 * PIN 登入。
 *
 * 用 PIN 而不是帳號密碼，因為店員在櫃檯的共用手機上要能快速切換，
 * 打一組長密碼在尖峰時段是不可行的。
 *
 * 代價是 PIN 的熵很低，所以一定要有失敗鎖定，否則四位數字暴力破解
 * 只需要一萬次。連續失敗五次鎖十五分鐘，把破解時間拉到不可行的程度。
 */
export async function loginStaff(
  staffId: string,
  pin: string,
): Promise<LoginResult> {
  const { data } = await db()
    .from('staff')
    .select(
      'id, name, pin_hash, role, is_active, failed_count, locked_until, lockout_level',
    )
    .eq('id', staffId)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) return { ok: false, reason: 'BAD_PIN' };

  const staff = data as StaffRow;

  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    const mins = Math.ceil(
      (new Date(staff.locked_until).getTime() - Date.now()) / 60_000,
    );
    return { ok: false, reason: 'LOCKED', lockedMinutes: mins };
  }

  const valid = await bcrypt.compare(pin, staff.pin_hash);

  if (!valid) {
    const failures = staff.failed_count + 1;
    const shouldLock = failures >= MAX_FAILURES;

    if (!shouldLock) {
      await db()
        .from('staff')
        .update({ failed_count: failures })
        .eq('id', staff.id);

      return { ok: false, reason: 'BAD_PIN' };
    }

    // 每次被鎖，下一次的時間拉長一階
    const level = Math.min(
      staff.lockout_level ?? 0,
      LOCKOUT_LADDER_MINUTES.length - 1,
    );
    const minutes = LOCKOUT_LADDER_MINUTES[level];

    await db()
      .from('staff')
      .update({
        failed_count: 0,
        lockout_level: level + 1,
        locked_until: new Date(Date.now() + minutes * 60_000).toISOString(),
      })
      .eq('id', staff.id);

    return { ok: false, reason: 'LOCKED', lockedMinutes: minutes };
  }

  // 登入成功就把鎖定階梯歸零，正常使用者不會被歷史紀錄拖累
  await db()
    .from('staff')
    .update({
      failed_count: 0,
      locked_until: null,
      lockout_level: 0,
      last_login_at: new Date().toISOString(),
    })
    .eq('id', staff.id);

  return {
    ok: true,
    session: { sid: staff.id, name: staff.name, role: staff.role },
  };
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

/**
 * 擋掉一眼就能猜到的 PIN。
 *
 * 長度只決定「總共有多少種可能」，不決定「攻擊者會先試哪幾種」。
 * 888888 是 6 位數，組合空間一百萬，但它會出現在任何攻擊字典的
 * 前十筆。全同數字、連號、以及生日型的年份開頭都屬於這一類。
 */
export function weakPinReason(pin: string): string | null {
  if (pin.length < MIN_PIN_LENGTH) {
    return `PIN 至少要 ${MIN_PIN_LENGTH} 位數`;
  }
  if (/^(\d)\1+$/.test(pin)) {
    return '不能全部都是同一個數字';
  }
  if (isSequential(pin)) {
    return '不能是連續數字';
  }
  return null;
}

function isSequential(pin: string): boolean {
  let up = true;
  let down = true;

  for (let i = 1; i < pin.length; i += 1) {
    const diff = Number(pin[i]) - Number(pin[i - 1]);
    if (diff !== 1) up = false;
    if (diff !== -1) down = false;
  }
  return up || down;
}

/**
 * 列出可登入的人員。
 *
 * 依角色分流：店員登入頁只看得到店員，老闆登入頁只看得到老闆。
 * 這樣店員不會知道老闆帳號叫什麼，也不會誤點。
 */
export async function listActiveStaff(
  role?: 'staff' | 'owner',
): Promise<{ id: string; name: string; role: 'staff' | 'owner' }[]> {
  let query = db()
    .from('staff')
    .select('id, name, role')
    .eq('is_active', true);

  if (role) query = query.eq('role', role);

  const { data } = await query.order('name');
  return data ?? [];
}
