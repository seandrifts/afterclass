/**
 * 序號產生器的回歸測試。
 *
 *   node scripts/test-codes.mjs
 *
 * 這裡守的是一個真的發生過的 bug：動態 QR 的字集曾經包含小寫字母，
 * 但查序號的路徑會先經過 normalizeCode() 轉大寫，導致產生出來的序號
 * 轉大寫之後查不到自己，客人掃了得到「查不到這組序號」。
 *
 * 只要任何產生器的輸出無法通過 normalizeCode 的來回轉換，這裡就會失敗。
 */
import {
  generateCardCode,
  generateDynamicCode,
  generateRedeemCode,
  generateWalletCode,
  normalizeCode,
} from '../src/lib/codes.ts';

let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${label}\n     ${e.message}`);
  }
}

console.log('\n序號產生器');

const GENERATORS = [
  ['紙卡序號', generateCardCode, 8],
  ['動態 QR', generateDynamicCode, 12],
  ['會員錢包碼', generateWalletCode, 10],
];

for (const [name, gen, length] of GENERATORS) {
  check(`${name} 長度為 ${length}`, () => {
    for (let i = 0; i < 200; i += 1) {
      const code = gen();
      if (code.length !== length) {
        throw new Error(`產生了 ${code.length} 碼：${code}`);
      }
    }
  });

  // 這是核心的那條規則
  check(`${name} 通過 normalizeCode 來回不變`, () => {
    for (let i = 0; i < 500; i += 1) {
      const code = gen();
      const normalized = normalizeCode(code);
      if (normalized !== code) {
        throw new Error(
          `${code} 正規化之後變成 ${normalized}，查詢時會找不到這筆資料`,
        );
      }
    }
  });

  check(`${name} 不含易混淆字元 O/0/I/1/L`, () => {
    for (let i = 0; i < 500; i += 1) {
      const code = gen();
      const bad = [...code].filter((c) => 'O0I1L'.includes(c));
      if (bad.length > 0) throw new Error(`${code} 含有 ${bad.join(', ')}`);
    }
  });
}

check('券核銷碼為 6 位純數字', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateRedeemCode();
    if (!/^\d{6}$/.test(code)) throw new Error(`不符格式：${code}`);
  }
});

check('normalizeCode 會去掉空白與連字號、轉大寫', () => {
  const cases = [
    ['abc def', 'ABCDEF'],
    ['ABC-DEF', 'ABCDEF'],
    ['  a-b c ', 'ABC'],
  ];
  for (const [input, expected] of cases) {
    const got = normalizeCode(input);
    if (got !== expected) {
      throw new Error(`normalizeCode('${input}') = '${got}'，預期 '${expected}'`);
    }
  }
});

check('序號重複率極低', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) seen.add(generateCardCode());
  if (seen.size < 5000) {
    throw new Error(`5000 組裡有 ${5000 - seen.size} 組重複`);
  }
});

console.log(failed === 0 ? '\n全部通過。\n' : `\n有 ${failed} 項失敗。\n`);
process.exit(failed === 0 ? 0 : 1);
