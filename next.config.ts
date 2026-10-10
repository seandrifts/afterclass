import type { NextConfig } from "next";

/*
  全站的安全標頭。

  frame-ancestors / X-Frame-Options：不讓別的網站把我們的頁面包進 iframe。
  店員端的折抵與送獎都是按一下就生效，被疊在別人的頁面底下誘導點擊
  （clickjacking）是真的會造成損失的。兩個都送是因為舊瀏覽器只認後者。

  CSP 只設 frame-ancestors，不限制 script 來源。Next 會輸出行內 script，
  要鎖就得每個請求配 nonce，那是另一個規模的工程。

  Permissions-Policy 的 camera 必須留給自己：店員端要開鏡頭掃會員碼。
*/
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  // 不必告訴掃描者這裡跑的是什麼框架
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
