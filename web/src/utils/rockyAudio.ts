// Rocky 原始音频管理 —— 预加载 + 按场景播放
// 使用共享 Audio 元素解决移动端自动播放限制

// ── 原始 Eridian 语音 (rockyvoice_o) ──
const ROCKY_O = {
  hello1: '/audio/rocky_o/hello1.mp3',
  hello2: '/audio/rocky_o/hello2.mp3',
  happy: '/audio/rocky_o/happy.mp3',
  unhappy: '/audio/rocky_o/unhappy.mp3',
  question: '/audio/rocky_o/question.mp3',
  inahurry: '/audio/rocky_o/inahurry.mp3',
  laugh: '/audio/rocky_o/laugh.mp3',
  talk1: '/audio/rocky_o/talk1.mp3',
  talk2: '/audio/rocky_o/talk2.mp3',
  talk3: '/audio/rocky_o/talk3.mp3',
} as const;

// ── 英语翻译语音 (rockyvoice_h) ──
const ROCKY_H = {
  sayhello: '/audio/rocky_h/sayhello.mp3',
  iamrocky: '/audio/rocky_h/iamrocky.mp3',
  ilike: '/audio/rocky_h/ilike.mp3',
  dirty: '/audio/rocky_h/dirty.mp3',
} as const;

// LLM 输出的 mood 标签 → 原始音频映射
export type RockyMood = 'happy' | 'unhappy' | 'question' | 'inahurry' | 'laugh' | 'talk';

const MOOD_TO_AUDIO: Record<RockyMood, string[]> = {
  happy: [ROCKY_O.happy],
  unhappy: [ROCKY_O.unhappy],
  question: [ROCKY_O.question],
  inahurry: [ROCKY_O.inahurry],
  laugh: [ROCKY_O.laugh],
  talk: [ROCKY_O.talk1, ROCKY_O.talk2, ROCKY_O.talk3],
};

// ── 共享 Audio 元素（移动端关键） ──
// iOS Safari 要求：在用户手势中对某个 Audio 元素调用 play() 后，
// 该元素后续可以不需要手势就播放。但 new Audio() 创建的新元素不行。
// 所以我们用一个全局共享的元素，在用户点击时解锁，之后换 src 复用。
let _sharedAudio: HTMLAudioElement | null = null;

// Generation counter — bumped by stopSharedAudio(). playSharedAudio()
// captures it at the start of its async pipeline and aborts before
// setting audio.src if the generation has moved on. Without this, a
// pending fetch inside playSharedAudio could resolve AFTER the caller
// stopped playback (e.g. user navigated away from chat) and restart
// the shared element on a stale src — exactly the "Rocky echo can't
// play, especially when other audio is playing" symptom users hit.
let _sharedGen = 0;
let _sharedAbort: AbortController | null = null;

/** 获取共享 Audio 元素 */
export function getSharedAudio(): HTMLAudioElement {
  if (!_sharedAudio) {
    _sharedAudio = new Audio();
  }
  return _sharedAudio;
}

/**
 * 在用户手势（click/tap）中调用，解锁移动端音频播放。
 * 必须在 StartScreen 按钮的 click handler 中同步调用。
 */
export function unlockAudio() {
  const audio = getSharedAudio();
  audio.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhkTP3mYAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhkTP3mYAAAAAAAAAAAAAAAAA';
  audio.play().catch(() => {});
}

/**
 * 用共享 Audio 元素播放指定 src，返回播放完毕的 Promise。
 * 先 fetch 为 blob 再设置 src，避免 iOS Safari 对远程 URL 加载失败时
 * 渲染原生 "Load failed" 覆盖层。
 *
 * Cancellation: captures _sharedGen at start. If stopSharedAudio()
 * runs (which bumps _sharedGen and aborts the fetch), the post-fetch
 * code path bails before touching audio.src — without this, a pending
 * fetch could resolve and restart playback after the caller already
 * stopped audio.
 */
export function playSharedAudio(src: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = getSharedAudio();
    // Take ownership of the singleton. Three things, in order:
    //   1. Pause + clear handlers on the currently-playing audio.
    //      Without this, if our new fetch fails (network drop) we
    //      never reach the `play()` path that overwrites audio.src,
    //      so the previous call's audio keeps playing audibly while
    //      the user thinks the new playback "didn't happen". This is
    //      the Echo-can't-play-when-other-audio-is-playing symptom.
    //   2. Abort any in-flight fetch from a previous playSharedAudio
    //      so its post-fetch microtask bails (via the gen check
    //      below) instead of clobbering our about-to-be-bound src.
    //   3. Bump _sharedGen so older callers' promises (still resolving
    //      via the bailed gen-check path) don't race us at audio.src.
    audio.pause();
    audio.onended = null;
    audio.onerror = null;
    if (_sharedAbort) {
      _sharedAbort.abort();
      _sharedAbort = null;
    }
    _sharedGen++;
    const myGen = _sharedGen;
    const ctrl = new AbortController();
    _sharedAbort = ctrl;

    const play = (url: string, revoke?: boolean) => {
      // Re-check generation before setting src — stopSharedAudio may
      // have run between the fetch resolving and this microtask.
      if (myGen !== _sharedGen) {
        if (revoke) URL.revokeObjectURL(url);
        resolve();
        return;
      }
      audio.onended = () => {
        audio.onended = null; audio.onerror = null;
        if (revoke) URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        audio.onended = null; audio.onerror = null;
        if (revoke) URL.revokeObjectURL(url);
        resolve();
      };
      audio.src = url;
      audio.play().catch(() => { if (revoke) URL.revokeObjectURL(url); resolve(); });
    };

    fetch(src, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.blob();
      })
      .then((blob) => {
        if (myGen !== _sharedGen) {
          // Stopped during fetch — drop the blob, do not start.
          resolve();
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        play(blobUrl, true);
      })
      .catch(() => resolve());
  });
}

/**
 * 停止共享 Audio 播放. Bumps the generation so any in-flight
 * playSharedAudio aborts before re-binding src on the shared element.
 * Aborts the in-flight fetch as well, so the network request doesn't
 * keep going after the user navigated away.
 */
export function stopSharedAudio() {
  _sharedGen++;
  if (_sharedAbort) {
    _sharedAbort.abort();
    _sharedAbort = null;
  }
  if (_sharedAudio) {
    _sharedAudio.pause();
    _sharedAudio.currentTime = 0;
    _sharedAudio.onended = null;
    _sharedAudio.onerror = null;
  }
}

// ── 预加载 ──
export function preloadAllRockyAudio() {
  // 用 fetch 预加载到浏览器缓存，不创建额外 Audio 元素
  const allSrcs = [...Object.values(ROCKY_O), ...Object.values(ROCKY_H)];
  allSrcs.forEach((src) => { fetch(src).catch(() => {}); });
}

/** 随机选一个 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── 场景化播放 ──

export function getGreetingAudioSequence(): string[] {
  return [pickRandom([ROCKY_O.hello1, ROCKY_O.hello2])];
}

export function getIntroAudioSequence(): string[] {
  return [ROCKY_O.happy, ROCKY_H.iamrocky];
}

export function getMoodAudio(mood: RockyMood): string {
  const candidates = MOOD_TO_AUDIO[mood];
  return pickRandom(candidates);
}

export function getLikeAudio(): string {
  return ROCKY_H.ilike;
}

export function getDirtyAudio(): string {
  return ROCKY_H.dirty;
}

export { ROCKY_O, ROCKY_H };
