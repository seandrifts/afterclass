/**
 * 中獎音效。
 *
 * 用 Web Audio 即時合成，不載入任何音檔。理由：
 *
 * 1. 客人在店門口用行動網路開這一頁，多一個音檔就多一次請求。
 *    合成的程式碼壓縮後只有一兩 KB，音檔動輒數十 KB
 * 2. 不需要處理音檔的授權與託管
 * 3. 音高與長度可以依「是不是大獎」即時調整
 *
 * 行動裝置的限制：瀏覽器只允許在使用者操作之後播放聲音。所以
 * AudioContext 必須在「按下抽獎」那一刻建立並解鎖，實際發聲則是
 * 三秒後轉盤停下來的時候。中間隔著時間差，但只要 context 已解鎖
 * 就播得出來。
 */

let ctx: AudioContext | null = null;

const STORAGE_KEY = 'ld_sound';

/**
 * 音效開關。
 *
 * 做成 external store 的形式，讓元件用 useSyncExternalStore 訂閱。
 * 這是 React 讀取「瀏覽器才有的狀態」的正規做法，不會有伺服器渲染
 * 與客戶端不一致的問題，也不需要在 effect 裡 setState。
 */
const listeners = new Set<() => void>();

export function subscribeSound(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 客人可以自己關掉。有些人在安靜的場合不想突然出聲 */
export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(STORAGE_KEY) !== 'off';
}

/** 伺服器渲染時的預設值。與 isSoundEnabled 的預設一致才不會閃動 */
export function soundServerSnapshot(): boolean {
  return true;
}

export function setSoundEnabled(on: boolean) {
  window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  for (const fn of listeners) fn();
}

/**
 * 在使用者操作的當下解鎖音訊。
 *
 * iOS Safari 只認「使用者手勢的同步呼叫堆疊」裡建立的 AudioContext。
 * 放在按下抽獎的 handler 裡呼叫，之後才播得出聲音。
 */
export function unlockAudio() {
  if (typeof window === 'undefined') return;

  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** 單一顆音。用三角波，比正弦厚一點但不像方波那麼刺耳 */
function tone(
  audio: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  gain: number,
) {
  const osc = audio.createOscillator();
  const vol = audio.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, startAt);

  // 起音快、收尾平滑。直接開關會有「喀」的爆音
  vol.gain.setValueAtTime(0, startAt);
  vol.gain.linearRampToValueAtTime(gain, startAt + 0.015);
  vol.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(vol).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/**
 * 中獎的慶祝音。
 *
 * 一般獎項是三音上行的琶音，大獎多兩顆音並拉高八度，聽得出差別。
 * 音量刻意壓低（0.12），這是在店裡播的，不該嚇到旁邊的人。
 */
export function playWinSound(big = false) {
  if (!isSoundEnabled()) return;

  unlockAudio();
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;

  // C 大調的和弦組成音，聽起來明亮而完整
  const notes = big
    ? [523.25, 659.25, 783.99, 1046.5, 1318.5] // C5 E5 G5 C6 E6
    : [523.25, 659.25, 783.99]; // C5 E5 G5

  notes.forEach((freq, i) => {
    tone(ctx!, freq, now + i * 0.085, big ? 0.5 : 0.34, big ? 0.14 : 0.12);
  });

  // 大獎在最後補一顆長音收尾，像小小的號角
  if (big) {
    tone(ctx, 1046.5, now + notes.length * 0.085 + 0.05, 0.9, 0.1);
  }
}

/**
 * 店員端的操作回饋音。
 *
 * 這比客人端的音效更實用：店員在尖峰時段手上在處理食物或找零，
 * 眼睛不一定看著螢幕。一聲確認音讓他知道扣款成功了，不用低頭確認。
 *
 * 成功是兩顆上行音（明確、短促），失敗是兩顆下行低音（不刺耳但聽得出不對）。
 */
export function playRedeemSuccessSound() {
  if (!isSoundEnabled()) return;
  unlockAudio();
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;
  tone(ctx, 880, now, 0.1, 0.13); // A5
  tone(ctx, 1174.66, now + 0.09, 0.22, 0.13); // D6
}

export function playErrorSound() {
  if (!isSoundEnabled()) return;
  unlockAudio();
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;
  tone(ctx, 330, now, 0.14, 0.11); // E4
  tone(ctx, 247, now + 0.13, 0.26, 0.11); // B3
}

/** 掃到碼的短促提示，讓店員知道讀取成功 */
export function playScanSound() {
  if (!isSoundEnabled()) return;
  unlockAudio();
  if (!ctx || ctx.state !== 'running') return;

  tone(ctx, 1567.98, ctx.currentTime, 0.07, 0.08); // G6
}

/**
 * 轉盤每經過一個獎項的「喀」聲。
 *
 * 不用 tone()，因為那個的起音有 15ms 斜坡 —— 在每秒十幾下的頻率下
 * 聽起來會糊成一片嗡嗡聲，不像機械轉盤的清脆聲響。這裡把起音壓到
 * 2ms、整個聲音只有 30ms，才會是「喀」而不是「嗡」。
 *
 * 音量刻意比其他音效小很多。它會連續響幾十下，用一般音量會蓋過
 * 最後的中獎音，而那才是重點。
 */
export function playReelTick() {
  if (!isSoundEnabled()) return;
  // 這是在動畫的每一幀裡呼叫的，不能每次都去解鎖音訊
  if (!ctx || ctx.state !== 'running') return;

  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(1800, t);

  vol.gain.setValueAtTime(0, t);
  vol.gain.linearRampToValueAtTime(0.035, t + 0.002);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

  osc.connect(vol).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.05);
}

/** 轉盤開始轉的提示音，很輕的一聲 */
export function playSpinSound() {
  if (!isSoundEnabled()) return;

  unlockAudio();
  if (!ctx || ctx.state !== 'running') return;

  tone(ctx, 392, ctx.currentTime, 0.12, 0.06);
}
