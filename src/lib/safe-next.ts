const FALLBACK = '/wallet';

/**
 * 登入後要回去的位置，只接受站內路徑。
 *
 * 不擋的話，`?next=https://evil.example` 會讓登入端點變成開放轉址，
 * 可以拿去做釣魚。
 *
 * 只檢查開頭是不是 `/` 並不夠。瀏覽器與 `new URL()` 會把反斜線當成
 * 斜線，`/\evil.example` 解析出來就是 `//evil.example`，一樣會跳到
 * 站外；夾帶 tab 或換行也會被解析器默默吃掉。所以這裡實際解析一次，
 * 確認結果還留在同一個 origin，再把正規化後的路徑交出去。
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return FALLBACK;

  // 控制字元與反斜線在正常的站內路徑裡不會出現，直接拒絕
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return FALLBACK;

  const base = 'https://internal.invalid';

  try {
    const url = new URL(raw, base);
    if (url.origin !== base) return FALLBACK;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return FALLBACK;
  }
}
