import { useRef, useCallback, useState, useEffect } from 'react';
import type { Lang } from '../i18n';
import {
  playSharedAudio,
  stopSharedAudio,
  getGreetingAudioSequence,
  getIntroAudioSequence,
  getMoodAudio,
  getLikeAudio,
  getDirtyAudio,
  type RockyMood,
} from '../utils/rockyAudio';
import { findDefaultAudioByReply } from '../utils/defaultDialogs';

// ── TTS: 通过 EdgeSpark worker 代理（/api/tts，auth required）
// 服务器端注入 MiniMax API key，浏览器不持有任何凭据
const API_BASE = import.meta.env.VITE_API_URL || '';

const VALID_MOODS: RockyMood[] = ['happy', 'unhappy', 'question', 'inahurry', 'laugh', 'talk'];

interface UseRockyTTSReturn {
  speak: (text: string, lang: Lang, msgId?: string) => void;
  stop: () => void;
  isSpeaking: boolean;
  isEnabled: boolean;
  toggle: () => void;
  ttsQuotaExceeded: boolean;
  ttsInsufficientCredits: boolean;
}

// ── 解析 LLM 回复，提取 mood + 特殊标记 + 正文 ──
function parseRockyReply(content: string) {
  const lines = content.split('\n');
  let mood: RockyMood = 'talk';
  let hasIntro = false;
  let hasLike = false;
  let hasDirty = false;
  const textParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // [MOOD:happy] 标签
    const moodMatch = trimmed.match(/^\[MOOD:(\w+)\]$/);
    if (moodMatch) {
      const m = moodMatch[1] as RockyMood;
      if (VALID_MOODS.includes(m)) mood = m;
      continue;
    }

    // [INTRO] 标签
    if (trimmed === '[INTRO]') { hasIntro = true; continue; }
    // [LIKE] 标签
    if (trimmed === '[LIKE]') { hasLike = true; continue; }
    // [DIRTY] 标签
    if (trimmed === '[DIRTY]') { hasDirty = true; continue; }

    // 跳过音符行
    if (/^[♫♩♪❗\s]{3,}$/.test(trimmed)) continue;

    // 提取翻译正文
    if (/^\[(Translation|翻译|翻訳)\]/.test(trimmed)) {
      let text = trimmed.replace(/^\[(Translation|翻译|翻訳)\]\s*/, '');
      // 如果有 INTRO 标签，去掉开头的 "I am Rocky" 类内容，避免和预录音频重复
      if (hasIntro) {
        text = text.replace(/^I am Rocky[.!?,\s]*/i, '').replace(/^Rocky here[.!?,\s]*/i, '');
      }
      if (text) textParts.push(text);
      continue;
    }

    // 其他文本行
    if (!/^【Grace/.test(trimmed)) {
      textParts.push(trimmed);
    } else {
      const graceText = trimmed.replace(/^【Grace[^】]*】\s*/, '');
      if (graceText) textParts.push(graceText);
    }
  }

  return { mood, hasIntro, hasLike, hasDirty, text: textParts.join(' ') };
}

export function useRockyTTS(skipTTS = false): UseRockyTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [ttsQuotaExceeded, setTtsQuotaExceeded] = useState(false);
  const [ttsInsufficientCredits, setTtsInsufficientCredits] = useState(false);
  const cancelledRef = useRef(false);
  const abortCtrlRef = useRef<AbortController | null>(null);

  // ── 播放单个音频（可中断，用共享 Audio 元素） ──
  const playInterruptible = useCallback((src: string): Promise<void> => {
    if (cancelledRef.current) return Promise.resolve();
    return playSharedAudio(src);
  }, []);

  // ── 依次播放音频序列（可中断） ──
  const playSequenceInterruptible = useCallback(async (srcs: string[]) => {
    for (const src of srcs) {
      if (cancelledRef.current) return;
      await playInterruptible(src);
    }
  }, [playInterruptible]);

  // ── TTS 专用 Audio 元素 ──
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── TTS：走 EdgeSpark 代理（GET /api/tts?text=...），返回 audio/mpeg 二进制
  const fetchTTS = useCallback((text: string, lang: Lang): Promise<HTMLAudioElement | null> => {
    if (skipTTS || !text.trim() || ttsQuotaExceeded || ttsInsufficientCredits) return Promise.resolve(null);

    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;

    return (async () => {
      try {
        const url = `${API_BASE}/api/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}`;
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          signal: abortCtrl.signal,
        });

        if (!res.ok) {
          if (res.status === 402) { setTtsInsufficientCredits(true); return null; }
          if (res.status === 429) { setTtsQuotaExceeded(true); return null; }
          console.error('TTS HTTP error:', res.status);
          return null;
        }

        if (cancelledRef.current) return null;

        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!bytes.byteLength || cancelledRef.current) return null;

        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));

        // 加载 Audio 元素
        const audio = new Audio();
        audio.preload = 'auto';

        await new Promise<void>((resolve, reject) => {
          audio.oncanplaythrough = () => { audio.oncanplaythrough = null; audio.onerror = null; resolve(); };
          audio.onerror = () => { audio.oncanplaythrough = null; audio.onerror = null; reject(); };
          audio.src = blobUrl;
          audio.load();
        });

        if (cancelledRef.current) { URL.revokeObjectURL(blobUrl); return null; }

        (audio as HTMLAudioElement & { _blobUrl?: string })._blobUrl = blobUrl;
        return audio;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return null;
        console.error('TTS failed:', err);
        return null;
      } finally {
        abortCtrlRef.current = null;
      }
    })();
  }, [skipTTS, ttsQuotaExceeded, ttsInsufficientCredits]);

  // ── 播放已就绪的 TTS Audio 元素 ──
  const playTTSAudio = useCallback((audio: HTMLAudioElement): Promise<void> => {
    if (cancelledRef.current) {
      const url = (audio as HTMLAudioElement & { _blobUrl?: string })._blobUrl;
      if (url) URL.revokeObjectURL(url);
      return Promise.resolve();
    }
    ttsAudioRef.current = audio;
    return new Promise<void>((resolve) => {
      const cleanup = () => {
        const url = (audio as HTMLAudioElement & { _blobUrl?: string })._blobUrl;
        if (url) URL.revokeObjectURL(url);
        audio.onended = null;
        audio.onerror = null;
        ttsAudioRef.current = null;
        resolve();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      audio.play().catch(cleanup);
    });
  }, []);

  // ── 请求+播放一步到位 ──
  const speakWithTTS = useCallback(async (text: string, lang: Lang): Promise<void> => {
    const audio = await fetchTTS(text, lang);
    if (audio) await playTTSAudio(audio);
  }, [fetchTTS, playTTSAudio]);

  // ── 主播放函数 ──
  const speak = useCallback(
    async (content: string, lang: Lang, msgId?: string) => {
      if (!isEnabled) return;
      cancelledRef.current = false;
      setIsSpeaking(true);

      // === Greeting 特殊处理: hello音效 + sayhello + 预录音频 ===
      // Note: previous version had 200ms setTimeout between mood and voice.
      // Removed — adds latency with no audible benefit.
      if (msgId === 'greeting') {
        await playSequenceInterruptible(getGreetingAudioSequence());
        if (!cancelledRef.current) {
          await playInterruptible(`/audio/defaults/greeting_${lang}.mp3`);
        }
        setIsSpeaking(false);
        return;
      }

      // === Farewell 特殊处理: mood音效 + 预录音频 ===
      if (msgId?.startsWith('farewell-')) {
        if (!cancelledRef.current) {
          await playInterruptible(getMoodAudio('unhappy'));
        }
        if (!cancelledRef.current) {
          await playInterruptible(`/audio/defaults/farewell_${lang}.mp3`);
        }
        setIsSpeaking(false);
        return;
      }

      // === 预置对话: mood 音频 + 本地预录 TTS ===
      if (msgId?.startsWith('default-')) {
        const { mood, hasLike } = parseRockyReply(content);
        const defaultAudio = findDefaultAudioByReply(content, lang);
        if (!cancelledRef.current) {
          await playInterruptible(getMoodAudio(mood));
        }
        if (hasLike && !cancelledRef.current) {
          await playInterruptible(getLikeAudio());
        }
        if (defaultAudio && !cancelledRef.current) {
          await playInterruptible(defaultAudio);
        }
        setIsSpeaking(false);
        return;
      }

      const { mood, hasIntro, hasLike, hasDirty, text } = parseRockyReply(content);

      // === Text 模式：自定义回复不播任何音频 ===
      if (skipTTS) {
        setIsSpeaking(false);
        return;
      }

      // === DIRTY 警告 ===
      if (hasDirty && !cancelledRef.current) {
        await playInterruptible(getDirtyAudio());
        // dirty 之后还播正文（警告内容）
        if (text && !cancelledRef.current) {
          await speakWithTTS(text, lang);
        }
        setIsSpeaking(false);
        return;
      }

      // === 自我介绍 ===
      if (hasIntro && !cancelledRef.current) {
        await playSequenceInterruptible(getIntroAudioSequence());
        if (text && !cancelledRef.current) {
          await speakWithTTS(text, lang);
        }
        setIsSpeaking(false);
        return;
      }

      // === 普通回复: mood 音频 + TTS 并行下载，串行播放 ===

      // 1. 并行：mood 音效播放 + TTS 下载
      const ttsPromise = text ? fetchTTS(text, lang) : Promise.resolve(null);

      if (!cancelledRef.current) {
        await playInterruptible(getMoodAudio(mood));
      }

      // 2. 如果有 LIKE 标签，播放 ilike
      if (hasLike && !cancelledRef.current) {
        await playInterruptible(getLikeAudio());
      }

      // 3. 等 TTS 加载就绪
      const ttsAudio = await ttsPromise;

      // 4. 播放 TTS
      if (ttsAudio && !cancelledRef.current) {
        await playTTSAudio(ttsAudio);
      }

      setIsSpeaking(false);
    },
    [isEnabled, playInterruptible, playSequenceInterruptible, speakWithTTS]
  );

  const stop = useCallback(() => {
    cancelledRef.current = true;
    abortCtrlRef.current?.abort();
    stopSharedAudio();
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.currentTime = 0;
      const url = (ttsAudioRef.current as HTMLAudioElement & { _blobUrl?: string })._blobUrl;
      if (url) URL.revokeObjectURL(url);
      ttsAudioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  const toggle = useCallback(() => {
    setIsEnabled((prev) => {
      if (prev) stop();
      return !prev;
    });
  }, [stop]);

  useEffect(() => {
    return () => {
      abortCtrlRef.current?.abort();
      stopSharedAudio();
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.currentTime = 0;
        ttsAudioRef.current = null;
      }
    };
  }, []);

  return { speak, stop, isSpeaking, isEnabled, toggle, ttsQuotaExceeded, ttsInsufficientCredits };
}
