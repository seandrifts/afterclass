import type { SVGProps } from 'react';

/**
 * Icon 集。
 *
 * 全部統一 24x24 viewBox、線性描邊、currentColor，這樣尺寸與顏色
 * 都由外層的 className 決定，不會出現大小不一或顏色對不上的情況。
 *
 * 原本這些位置用的是 emoji。emoji 的問題是每個系統長得不一樣
 * （iOS 的 🍜 跟 Android 的 🍜 差很多），對不齊基線，也無法跟著
 * 文字顏色變化。狀態插畫那種「大圖」用 emoji 還行，但 UI 元件不行。
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconWallet = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H18a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
    <path d="M3 8.5V7a2 2 0 0 1 2-2h11" />
    <circle cx="17" cy="12.5" r="1.25" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconReceipt = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" />
    <path d="M9.5 8h5M9.5 12h5" />
  </Icon>
);

export const IconRules = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 4h8a2 2 0 0 1 2 2v14a1 1 0 0 1-1.5.87L12 18.5l-4.5 2.37A1 1 0 0 1 6 20V6a2 2 0 0 1 2-2z" />
    <path d="M9.5 9h5M9.5 12.5h3" />
  </Icon>
);

export const IconGift = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="9" width="18" height="12" rx="1.5" />
    <path d="M3 13h18M12 9v12" />
    <path d="M12 9S10 4.5 7.5 4.5a2.5 2.5 0 0 0 0 5M12 9s2-4.5 4.5-4.5a2.5 2.5 0 0 1 0 5" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p} strokeWidth={2.5}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const IconBan = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m6 6 12 12" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.5 21 20H3z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="17" r="0.75" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconBowl = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 11h18a9 9 0 0 1-9 9 9 9 0 0 1-9-9z" />
    <path d="M8 8s-.5-1.5.5-3M12 8s-.5-1.5.5-3M16 8s-.5-1.5.5-3" />
  </Icon>
);

export const IconCamera = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 8z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Icon>
);

export const IconKeyboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" />
  </Icon>
);

export const IconUndo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
    <path d="m8 5-4 4 4 4" />
  </Icon>
);

export const IconArrowLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const IconSparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 13.8 9.2 20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z" />
  </Icon>
);

export const IconBackspace = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z" />
    <path d="m12 10 5 4M17 10l-5 4" />
  </Icon>
);

export const IconLine = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 2C6.48 2 2 5.69 2 10.22c0 4.06 3.55 7.46 8.35 8.1.32.07.77.21.88.49.1.25.07.65.03.9l-.14.85c-.04.25-.2.99.87.54s5.75-3.39 7.84-5.8C21.28 13.71 22 12.05 22 10.22 22 5.69 17.52 2 12 2M8.08 12.85H6.1a.26.26 0 0 1-.26-.26V8.7c0-.15.12-.26.26-.26h.5c.14 0 .26.11.26.26v3.1h1.22c.15 0 .26.11.26.26v.53c0 .14-.11.26-.26.26m1.98 0h-.5a.26.26 0 0 1-.27-.26V8.7c0-.15.12-.26.27-.26h.5c.14 0 .26.11.26.26v3.89c0 .14-.12.26-.26.26m4.4 0h-.5a.26.26 0 0 1-.21-.1l-1.79-2.4v2.24c0 .14-.11.26-.26.26h-.5a.26.26 0 0 1-.26-.26V8.7c0-.15.11-.26.26-.26h.53l.02.01.03.02.02.02 1.79 2.4V8.7c0-.15.12-.26.26-.26h.5c.15 0 .26.11.26.26v3.89c0 .14-.11.26-.26.26m3.53-3.36h-1.22v.47h1.22c.15 0 .26.12.26.26v.53c0 .15-.11.26-.26.26h-1.22v.47h1.22c.15 0 .26.12.26.27v.53c0 .14-.11.26-.26.26h-1.98a.26.26 0 0 1-.26-.26V8.7c0-.15.11-.26.26-.26h1.98c.15 0 .26.11.26.26v.53c0 .15-.11.26-.26.26" />
  </svg>
);
