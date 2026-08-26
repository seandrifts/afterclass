'use client';

import { useActionState, useState } from 'react';

import { loginAction } from '../actions';
import { IconBackspace } from '@/components/icons';
import { Button, Card } from '@/components/ui';

const MAX_PIN = 6;
const MIN_PIN = 6;

export function LoginForm({
  staff,
  role,
}: {
  staff: { id: string; name: string; role: 'staff' | 'owner' }[];
  role: 'staff' | 'owner';
}) {
  const [state, action, pending] = useActionState(loginAction, null);
  const [selected, setSelected] = useState(staff[0]?.id ?? '');
  const [pin, setPin] = useState('');

  if (staff.length === 0) {
    return (
      <Card>
        <p className="text-center text-pretty text-ink-soft">
          {role === 'owner'
            ? '還沒有建立老闆帳號。請執行 supabase/seed.sql 並設定 PIN。'
            : '還沒有建立店員帳號。請由老闆從後台新增。'}
        </p>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {/* 只有一個人時不需要選，直接鎖定 */}
      {staff.length > 1 ? (
        <div className="grid grid-cols-2 gap-3">
          {staff.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSelected(s.id);
                setPin('');
              }}
              aria-pressed={selected === s.id}
              className={`min-h-16 cursor-pointer rounded-2xl border-2 text-lg font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${
                selected === s.id
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-line bg-raised text-ink-soft'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      <input type="hidden" name="staffId" value={selected} />
      <input type="hidden" name="pin" value={pin} />
      <input type="hidden" name="role" value={role} />

      {/*
        圓點數量跟著實際輸入長度走，不寫死。
        原本固定畫 4 個，6 位數的 PIN 打到第 5 位就沒有回饋，
        店員會不確定自己按到第幾位。
      */}
      <div
        className="flex min-h-20 items-center justify-center gap-3 rounded-2xl border-2 border-line bg-raised"
        role="status"
        aria-label={`已輸入 ${pin.length} 位`}
      >
        {Array.from({ length: MAX_PIN }, (_, i) => (
          <span
            key={i}
            className={`size-4 rounded-full transition-colors duration-150 ${
              i < pin.length
                ? 'bg-brand-500'
                : // 未輸入的位置用外框而不是淡色實心。原本 bg-line/40
                  // 在暖白背景上幾乎看不見，看不出總共有幾位
                  'border-2 border-line bg-transparent'
            }`}
          />
        ))}
      </div>

      <Keypad value={pin} onChange={setPin} />

      {state?.error ? (
        <p role="alert" className="text-center text-sm font-medium text-bad">
          {state.error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        loading={pending}
        disabled={pin.length < MIN_PIN}
      >
        {pending ? '登入中' : '登入'}
      </Button>
    </form>
  );
}

/**
 * 自製數字鍵盤而非用 input type=number。
 *
 * 系統鍵盤在小吃店的共用手機上會蓋掉半個畫面，而且不同機型的
 * 數字鍵盤配置不一樣。自己畫可以保證按鍵夠大、位置固定。
 */
function Keypad({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'];

  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => {
            if (k === 'del') onChange(value.slice(0, -1));
            else if (k === 'clear') onChange('');
            else if (value.length < MAX_PIN) onChange(value + k);
          }}
          className="min-h-16 cursor-pointer rounded-2xl border border-line bg-raised text-2xl font-bold transition-colors duration-200 active:bg-brand-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300"
          aria-label={k === 'del' ? '刪除' : k === 'clear' ? '清除' : k}
        >
          {k === 'del' ? (
            <IconBackspace className="mx-auto size-7" />
          ) : k === 'clear' ? (
            <span className="text-base text-ink-soft">清除</span>
          ) : (
            k
          )}
        </button>
      ))}
    </div>
  );
}
