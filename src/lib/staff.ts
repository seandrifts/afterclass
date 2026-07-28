import 'server-only';

import bcrypt from 'bcryptjs';

import { db } from './supabase';
import type { StaffSession } from './session';

const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;

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
    .select('id, name, pin_hash, role, is_active, failed_count, locked_until')
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

    await db()
      .from('staff')
      .update({
        failed_count: shouldLock ? 0 : failures,
        locked_until: shouldLock
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
          : null,
      })
      .eq('id', staff.id);

    return shouldLock
      ? { ok: false, reason: 'LOCKED', lockedMinutes: LOCKOUT_MINUTES }
      : { ok: false, reason: 'BAD_PIN' };
  }

  await db()
    .from('staff')
    .update({
      failed_count: 0,
      locked_until: null,
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

export async function listActiveStaff(): Promise<
  { id: string; name: string; role: 'staff' | 'owner' }[]
> {
  const { data } = await db()
    .from('staff')
    .select('id, name, role')
    .eq('is_active', true)
    .order('name');

  return data ?? [];
}
