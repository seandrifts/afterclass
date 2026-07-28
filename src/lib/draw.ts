import 'server-only';

import { randomInt } from 'node:crypto';

import type { Prize, PrizeSnapshot } from './types';

/**
 * 加權抽選。
 *
 * 這個函式只在伺服器端執行。前端拿到的是已經決定好的結果，
 * 轉盤動畫只是把結果演出來。機率計算若下放到前端，等於送給
 * 任何懂得開 DevTools 的人一張免單。
 *
 * 用整數權重而非百分比，避免浮點數累加誤差導致機率分佈偏移。
 * 用 crypto 的 randomInt 而非 Math.random，後者可預測。
 */
export function pickPrize(prizes: Prize[]): Prize | null {
  const pool = prizes.filter(
    (p) =>
      p.is_active &&
      p.weight > 0 &&
      (p.stock === null || p.stock_used < p.stock),
  );

  if (pool.length === 0) return null;

  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return null;

  // randomInt(max) 回傳 [0, max)，正好對應累加權重的落點
  let roll = randomInt(total);
  for (const prize of pool) {
    roll -= prize.weight;
    if (roll < 0) return prize;
  }

  // 理論上到不了這裡。真的到了就給最後一項，總比丟例外好
  return pool[pool.length - 1];
}

/**
 * 保底：排除最低價值的獎項。
 *
 * 熟客一週來三次，連續二十次都抽到 1 元會覺得被耍。
 * 成本增加極小，但體感差很多。
 *
 * 「最低價值」以 face_value 判斷，同分時全部排除。
 * 排除後如果沒有東西可抽（例如只設了一種獎項），就退回完整清單。
 */
export function excludeLowestTier(prizes: Prize[]): Prize[] {
  const pool = prizes.filter((p) => p.is_active && p.weight > 0);
  if (pool.length <= 1) return prizes;

  const lowest = Math.min(...pool.map((p) => p.face_value));
  const remaining = pool.filter((p) => p.face_value > lowest);

  return remaining.length > 0 ? remaining : prizes;
}

/**
 * 把獎項凍結成快照，寫進 draw_tokens.prize_snapshot。
 *
 * 之後老闆在後台怎麼改這個獎項，已經抽出的結果都不受影響。
 * 成本也要快照，因為報表要算的是「中獎當下的成本」而不是現在的。
 */
export function toSnapshot(prize: Prize): PrizeSnapshot {
  return {
    prize_id: prize.id,
    name: prize.name,
    type: prize.type,
    credit_amount: prize.credit_amount,
    face_value: prize.face_value,
    cost: prize.cost,
    discount_amt: prize.discount_amt,
    min_spend: prize.min_spend,
    max_discount: prize.max_discount,
    valid_days: prize.valid_days,
    terms: prize.terms,
    image_url: prize.image_url,
    color: prize.color,
  };
}

/** 後台顯示用：把整數權重換算成百分比 */
export function weightToPercent(weight: number, totalWeight: number): number {
  if (totalWeight <= 0) return 0;
  return (weight / totalWeight) * 100;
}

/**
 * 名目期望成本：每抽一次平均要付出多少。
 *
 * 這是「假設每個獎項都被兌現」的數字。實際成本還要乘上核銷率，
 * 見 docs/PLAN.md §3.4。
 */
export function expectedCost(prizes: Prize[]): number {
  const pool = prizes.filter((p) => p.is_active && p.weight > 0);
  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return 0;

  return pool.reduce((sum, p) => sum + (p.weight / total) * p.cost, 0);
}

/** 平均每次抽到的儲值金金額（不含實物券與免單） */
export function expectedCreditPayout(prizes: Prize[]): number {
  const pool = prizes.filter((p) => p.is_active && p.weight > 0);
  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return 0;

  return pool
    .filter((p) => p.type === 'credit')
    .reduce((sum, p) => sum + (p.weight / total) * (p.credit_amount ?? 0), 0);
}

/**
 * 蒙地卡羅模擬，給後台的「模擬 N 次」按鈕用。
 *
 * 回傳每個獎項的實際落點次數與總成本。跑多輪取最高成本，
 * 就是「運氣最差的月份會花多少」，那個數字才是設成本上限的依據。
 */
export function simulate(
  prizes: Prize[],
  draws: number,
): { counts: Map<string, number>; totalCost: number } {
  const counts = new Map<string, number>();
  let totalCost = 0;

  for (let i = 0; i < draws; i += 1) {
    const prize = pickPrize(prizes);
    if (!prize) break;
    counts.set(prize.id, (counts.get(prize.id) ?? 0) + 1);
    totalCost += prize.cost;
  }

  return { counts, totalCost };
}
