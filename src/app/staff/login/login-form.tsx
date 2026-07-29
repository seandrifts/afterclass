'use client';

import { useActionState, useState } from 'react';

import { loginAction } from '../actions';
import { IconBackspace } from '@/components/icons';
import { Button, Card } from '@/components/ui';

export function LoginForm({
  staff,
}: {
  staff: { id: string; name: string; role: 'staff' | 'owner' }[];
}) {
  const [state, action, pending] = useActionState(loginAction, null);
  const [selected, setSelected] = useState(staff[0]?.id ?? '');
  const [pin, setPin] = useState('');

  if (staff.length === 0) {
    return (
      <Card>
        <p className="text-center text-ink-soft">
          還沒有建立任何店員。請先執行 seed，或由老闆從後台新增。
        </p>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {staff.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelected(s.id)}
            className={`min-h-16 cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 rounded-2xl border-2 text-lg font-bold ${
              selected === s.id
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-line bg-raised text-ink-soft'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <input type="hidden" name="staffId" value={selected} />
      <input type="hidden" name="pin" value={pin} />

      <div className="rounded-2xl border-2 border-line bg-raised py-5 text-center">
        <p className="tabular text-4xl font-black tracking-[0.4em]">
          {pin.padEnd(4, '·')}
        </p>
      </div>

      <Keypad value={pin} onChange={setPin} />

      {state?.error ? (
        <p className="text-center text-sm font-medium text-bad">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending || pin.length < 4}>
        {pending ? '登入中⋯' : '登入'}
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
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k, i) =>
        k === '' ? (
          <div key={i} />
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => {
              if (k === 'del') onChange(value.slice(0, -1));
              else if (value.length < 6) onChange(value + k);
            }}
            className="cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 min-h-16 rounded-2xl border border-line bg-raised text-2xl font-bold active:bg-brand-50"
            aria-label={k === 'del' ? '刪除' : k}
          >
            {k === 'del' ? (
              <IconBackspace className="mx-auto size-7" />
            ) : (
              k
            )}
          </button>
        ),
      )}
    </div>
  );
}
