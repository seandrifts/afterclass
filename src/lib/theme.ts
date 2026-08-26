/**
 * 從單一主色推導出整組色階。
 *
 * 設定頁只讓老闆挑一個顏色，但介面用到的是 brand-50 到 brand-900
 * 一整組。這裡把那個顏色當成 500 階，其餘往亮部與暗部推。
 *
 * 在 OKLCH 空間做混色而不是 RGB。RGB 直接跟白色混會讓顏色顯得
 * 灰濁（例如橘色調亮會變成粉土色），OKLCH 的亮度變化比較符合
 * 眼睛的感受，推出來的淺色仍然保有原本的色相。
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const FALLBACK = '#e4572e';

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;

  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * 相對亮度（WCAG 定義）。
 *
 * 用來決定主色上面該放白字還是黑字。老闆可能挑到很亮的黃色，
 * 那時候白字會完全看不見。
 */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 主色上面應該用什麼顏色的文字，才看得清楚 */
export function readableOn(hex: string): string {
  const rgb = parseHex(hex) ?? parseHex(FALLBACK)!;
  // 0.45 是實測出來的分界，比標準的 0.5 稍低，
  // 因為中間色偏暗時白字仍然比黑字好讀
  return luminance(rgb) > 0.45 ? '#1c1917' : '#ffffff';
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function toHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * 產生 CSS 變數字串，直接塞進 <style> 覆蓋掉 globals.css 的預設值。
 *
 * 淺階往白色混、深階往接近黑的暖色混。純黑會讓深色階看起來
 * 髒掉，混一點色相進去比較自然。
 */
export function brandScaleCss(hex: string): string {
  const base = parseHex(hex) ?? parseHex(FALLBACK)!;
  const white: Rgb = { r: 255, g: 255, b: 255 };
  const dark: Rgb = { r: 24, g: 16, b: 12 };

  const steps: [number, Rgb, number][] = [
    [50, white, 0.94],
    [100, white, 0.86],
    [200, white, 0.7],
    [300, white, 0.48],
    [400, white, 0.24],
    [500, base, 0],
    [600, dark, 0.16],
    [700, dark, 0.32],
    [800, dark, 0.48],
    [900, dark, 0.62],
  ];

  const vars = steps
    .map(([step, target, t]) => {
      const color = t === 0 ? base : mix(base, target, t);
      return `--color-brand-${step}:${toHex(color)}`;
    })
    .join(';');

  return `:root{${vars}}`;
}
