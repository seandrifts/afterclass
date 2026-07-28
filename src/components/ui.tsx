import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-card border border-line bg-raised p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      {children}
    </main>
  );
}

const buttonBase =
  'inline-flex w-full items-center justify-center rounded-2xl px-6 text-lg font-bold ' +
  'transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40';

// 觸控目標最小 56px。店員手濕、動作快，按鈕小了就會誤觸
const buttonSizes = {
  md: 'min-h-14',
  lg: 'min-h-16 text-xl',
} as const;

const buttonVariants = {
  primary: 'bg-brand-500 text-white shadow-md hover:bg-brand-600',
  secondary: 'border-2 border-line bg-raised text-ink hover:bg-brand-50',
  ghost: 'text-ink-soft hover:bg-brand-50',
  danger: 'bg-bad text-white hover:opacity-90',
} as const;

type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`${buttonBase} ${buttonSizes[size]} ${buttonVariants[variant]} ${className}`}
    />
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
}: {
  href: string;
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${buttonBase} ${buttonSizes[size]} ${buttonVariants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

/**
 * 錯誤狀態畫面。
 *
 * 每種失敗都要有自己的說明。客人在店門口掃到壞掉的序號時，
 * 「這組序號已經被使用過了」跟「發生錯誤」對他來說是完全不同的資訊，
 * 前者他知道要去問店家，後者只會讓他放棄。
 */
export function StatusScreen({
  emoji,
  title,
  detail,
  action,
}: {
  emoji: string;
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="text-6xl" aria-hidden>
          {emoji}
        </div>
        <h1 className="mt-5 text-2xl font-bold text-ink">{title}</h1>
        {detail ? (
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            {detail}
          </p>
        ) : null}
        {action ? <div className="mt-8 w-full">{action}</div> : null}
      </div>
    </Screen>
  );
}
