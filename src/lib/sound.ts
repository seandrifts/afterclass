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
 * 轉盤停下來的時候（約一秒後）。中間隔著時間差，但只要 context
 * 已解鎖就播得出來。
 */

let ctx: AudioContext | null = null;

/**
 * 所有聲音都先進限幅器再出去。
 *
 * 音量拉高之後，中獎音那五顆音會疊在一起 —— 單顆 0.42 的話瞬間振幅
 * 會超過 1.0，直接接 destination 就是削波，聽起來是「刺啦」的破音而
 * 不是變大聲。限幅器把超過門檻的部分壓下來，後面再補一段 makeup
 * 增益，聽感上就是「更大聲但沒有變髒」。
 *
 * 門檻設 -6dB 而不是更低，是為了讓單顆音完全不受影響 —— 只有真的
 * 疊起來的瞬間才會被壓。壓縮器如果一直在作用，中獎音會被自己前面
 * 的轉動聲壓小，那正好是反效果。
 */
let bus: AudioNode | null = null;

/*
  限幅之後的補償增益。整體音量的總開關。

  1.4 是實測出來的上限：大獎那段（五顆音疊在一起、底下還有轉軸的喀喀
  聲）未經處理的峰值是 0.507，乘上 1.4 之後是 0.953，剛好貼著 1.0 的
  天花板又沒有超過。1.5 會變成 1.02，就開始削波了。

  也就是說現在已經是「不破音的前提下能多大聲就多大聲」。真的還嫌小
  的話，剩下的只能靠 iPad 本身的音量鍵或外接一顆小喇叭。
*/
const MAKEUP = 1.4;

/**
 * 各音效的音量。
 *
 * 這是在小吃店尖峰時段播的：抽油煙機、電視、客人講話。原本的值
 * （轉動 0.035、中獎 0.12）在安靜的房間剛好，但在店裡等於沒有聲音。
 * 整體拉高約三倍，靠上面的限幅器維持乾淨。
 *
 * 中獎音必須明顯大過轉動聲，那才是重點所在。
 */
const VOL = {
  tick: 0.13, // 轉軸每經過一格的「喀」。會連響數十下，仍是全場最小的
  spin: 0.22, // 按下去的起始提示
  win: 0.38,
  winBig: 0.42,
  winTail: 0.3, // 大獎最後那顆長音
  scan: 0.16,
  redeem: 0.26,
  error: 0.24,
} as const;

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

      const limiter = ctx.createDynamicsCompressor();
      const t = ctx.currentTime;
      limiter.threshold.setValueAtTime(-6, t);
      limiter.knee.setValueAtTime(4, t);
      limiter.ratio.setValueAtTime(12, t);
      limiter.attack.setValueAtTime(0.003, t);
      limiter.release.setValueAtTime(0.12, t);

      const makeup = ctx.createGain();
      makeup.gain.setValueAtTime(MAKEUP, t);

      limiter.connect(makeup).connect(ctx.destination);
      bus = limiter;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
    bus = null;
  }
}

/** 聲音的出口。限幅器沒建起來時退回直接輸出，寧可小聲也不要沒聲音 */
function out(audio: AudioContext): AudioNode {
  return bus ?? audio.destination;
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

  osc.connect(vol).connect(out(audio));
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/**
 * 中獎的慶祝音。
 *
 * 一般獎項是三音上行的琶音，大獎多兩顆音並拉高八度，聽得出差別。
 * 音量是全場最大的 —— 中獎那一刻要壓過店裡的環境音，客人跟隔壁桌
 * 都聽得到才有「有人抽中了」的氣氛。
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
    tone(
      ctx!,
      freq,
      now + i * 0.085,
      big ? 0.5 : 0.34,
      big ? VOL.winBig : VOL.win,
    );
  });

  // 大獎在最後補一顆長音收尾，像小小的號角
  if (big) {
    tone(ctx, 1046.5, now + notes.length * 0.085 + 0.05, 0.9, VOL.winTail);
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
  tone(ctx, 880, now, 0.1, VOL.redeem); // A5
  tone(ctx, 1174.66, now + 0.09, 0.22, VOL.redeem); // D6
}

export function playErrorSound() {
  if (!isSoundEnabled()) return;
  unlockAudio();
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;
  tone(ctx, 330, now, 0.14, VOL.error); // E4
  tone(ctx, 247, now + 0.13, 0.26, VOL.error); // B3
}

/** 掃到碼的短促提示，讓店員知道讀取成功 */
export function playScanSound() {
  if (!isSoundEnabled()) return;
  unlockAudio();
  if (!ctx || ctx.state !== 'running') return;

  tone(ctx, 1567.98, ctx.currentTime, 0.07, VOL.scan); // G6
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
  vol.gain.linearRampToValueAtTime(VOL.tick, t + 0.002);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

  osc.connect(vol).connect(out(ctx));
  osc.start(t);
  osc.stop(t + 0.05);
}

/** 轉盤開始轉的提示音，短短一聲 */
export function playSpinSound() {
  if (!isSoundEnabled()) return;

  unlockAudio();
  if (!ctx || ctx.state !== 'running') return;

  tone(ctx, 392, ctx.currentTime, 0.12, VOL.spin);
}

// ---------------------------------------------------------------
// 語音報獎
// ---------------------------------------------------------------

/*
  用瀏覽器內建的 Web Speech API 唸出中獎獎項，不打任何雲端 TTS。理由
  跟音效一樣：不多一次網路請求、不必付費、獎項在後台改了也不用重錄。
  代價是聲線由裝置決定，不能挑。

  三個實務上會踩到的坑：

  1. 語音清單是非同步載入的。第一次呼叫 getVoices() 通常回空陣列，
     要等 voiceschanged。所以在按下抽獎的當下就先去要清單，等一秒後
     真的要唸時才有中文聲音可挑，不然會用系統預設的英文聲線去唸中文
  2. iOS Safari 跟音訊一樣要使用者手勢才准發聲，而且只認手勢的同步
     堆疊。所以按下抽獎時先送一個音量 0 的空白句子把它解鎖
  3. 唸的內容要跟畫面上看到的一致。客人看到「+500 點」卻聽到「50 元」
     會以為系統出錯，所以文字由呼叫端給，這裡不自己組
*/

let voice: SpeechSynthesisVoice | null = null;
let speechPrimed = false;
let speakTimer = 0;

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return 'speechSynthesis' in window ? window.speechSynthesis : null;
}

/** 挑中文聲線。台灣優先，其次任何中文，都沒有就交給系統預設 */
function pickVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  const all = s.getVoices();
  if (all.length === 0) return null;

  // Android 有些機型回報 zh_TW（底線），統一成連字號再比
  const lang = (v: SpeechSynthesisVoice) =>
    v.lang.replace('_', '-').toLowerCase();

  return (
    all.find((v) => lang(v) === 'zh-tw') ??
    all.find((v) => lang(v).startsWith('zh-tw')) ??
    all.find((v) => lang(v).startsWith('zh-han')) ?? // zh-Hant-TW
    all.find((v) => lang(v).startsWith('zh')) ??
    null
  );
}

/**
 * 在使用者手勢的當下解鎖語音，並開始載入聲音清單。
 *
 * 跟 unlockAudio 一樣要放在按下抽獎的 handler 裡。
 */
export function primeSpeech() {
  const s = synth();
  if (!s) return;

  if (!voice) {
    voice = pickVoice(s);
    if (!voice) {
      s.addEventListener(
        'voiceschanged',
        () => {
          voice = pickVoice(s);
        },
        { once: true },
      );
    }
  }

  if (speechPrimed) return;
  try {
    // 全形空白而不是空字串 —— iOS 對空字串會直接忽略，等於沒解鎖
    const u = new SpeechSynthesisUtterance('　');
    u.volume = 0;
    u.lang = 'zh-TW';
    s.speak(u);
    speechPrimed = true;
  } catch {
    speechPrimed = false;
  }
}

/** 獎項名稱是老闆在後台自己打的，唸之前要整理一下 */
function forSpeech(text: string): string {
  return text
    .replace(/[（(]/g, '，') // 「免單（下次消費全免）」→ 中間停頓一下
    .replace(/[）)]/g, '')
    .replace(/[+＋]/g, '加')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 唸出中獎獎項。
 *
 * 預設慢半拍才開口，讓中獎的琶音先響完 —— 兩個一起出來會糊在一起，
 * 兩個都聽不清楚。
 */
export function speakPrize(text: string, delayMs = 420) {
  if (!isSoundEnabled() || !text) return;
  const s = synth();
  if (!s) return;

  window.clearTimeout(speakTimer);
  speakTimer = window.setTimeout(() => {
    try {
      s.cancel(); // 上一位客人的還沒唸完就被接手時，不要疊在一起

      const u = new SpeechSynthesisUtterance(forSpeech(text));
      if (!voice) voice = pickVoice(s);
      if (voice) u.voice = voice;

      u.lang = voice?.lang ?? 'zh-TW';
      u.rate = 1; // 店裡吵，講太快聽不清楚，就用正常語速
      u.pitch = 1.05; // 稍微上揚一點，聽起來是報喜不是報站
      u.volume = 1;

      s.speak(u);
    } catch {
      // 唸不出來就算了，畫面上本來就看得到獎項
    }
  }, delayMs);
}

/** 換下一位、或離開頁面時把還沒唸完的停掉 */
export function cancelSpeech() {
  window.clearTimeout(speakTimer);
  try {
    synth()?.cancel();
  } catch {
    // 有些瀏覽器在頁面卸載中呼叫會丟例外，不影響任何事
  }
}
