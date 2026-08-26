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

/**
 * 所有可點擊元素共用的基底。
 *
 * cursor-pointer 跟 focus-visible 寫在這裡而不是各自散落，是因為
 * 這兩項最容易在新增元件時被漏掉。焦點環用 focus-visible 而非 focus，
 * 這樣滑鼠點擊不會留下一圈框，只有鍵盤操作時才顯示。
 */
const interactive =
  'cursor-pointer transition-colors duration-200 ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

const buttonBase = `inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 text-lg font-bold active:scale-[0.98] ${interactive}`;

// 觸控目標最小 56px。店員手濕、動作快，按鈕小了就會誤觸
const buttonSizes = {
  sm: 'min-h-11 text-base px-4',
  md: 'min-h-14',
  lg: 'min-h-16 text-xl',
} as const;

const buttonVariants = {
  primary: 'bg-brand-500 text-(--color-brand-on) shadow-md hover:bg-brand-600',
  secondary: 'border-2 border-line bg-raised text-ink hover:bg-brand-50',
  ghost: 'text-ink-soft hover:bg-brand-50',
  danger: 'bg-bad text-white hover:opacity-90',
} as const;

type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonBase} ${buttonSizes[size]} ${buttonVariants[variant]} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
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

/** 純文字連結，同樣要有焦點環 */
export function TextLink({
  href,
  className = '',
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded underline underline-offset-2 ${interactive} hover:text-brand-600 ${className}`}
    >
      {children}
    </Link>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`size-5 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 骨架屏的單一區塊。載入時先佔住位置，避免內容跳動 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-brand-100/60 ${className}`}
      aria-hidden="true"
    />
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
  icon,
  tone = 'neutral',
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    neutral: 'bg-brand-50 text-brand-500',
    good: 'bg-green-50 text-good',
    warn: 'bg-amber-50 text-warn',
    bad: 'bg-red-50 text-bad',
  } as const;

  return (
    <Screen>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div
          className={`flex size-24 items-center justify-center rounded-full ${tones[tone]}`}
        >
          {icon}
        </div>
        <h1 className="mt-6 text-2xl font-bold text-balance text-ink">
          {title}
        </h1>
        {detail ? (
          <p className="mt-3 text-base leading-relaxed text-pretty text-ink-soft">
            {detail}
          </p>
        ) : null}
        {action ? <div className="mt-8 w-full">{action}</div> : null}
      </div>
    </Screen>
  );
}
