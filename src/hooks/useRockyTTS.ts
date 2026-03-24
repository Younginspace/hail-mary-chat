import { useRef, useCallback, useState, useEffect } from 'react';
import type { Lang } from '../i18n';

// ── Eridian music note mapping ──
// Each symbol maps to a frequency range (pentatonic-ish alien scale)
const NOTE_FREQ: Record<string, number> = {
  '♫': 523.25,  // C5
  '♩': 392.00,  // G4
  '♪': 659.25,  // E5
  '❗': 880.00,  // A5 (surprise)
};

// Eridian "chord" intervals — alien harmony
const ERIDIAN_INTERVALS = [1, 1.25, 1.5]; // root, major third-ish, fifth-ish

interface UseRockyTTSReturn {
  speak: (text: string, lang: Lang) => void;
  stop: () => void;
  isSpeaking: boolean;
  isEnabled: boolean;
  toggle: () => void;
}

export function useRockyTTS(): UseRockyTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeNodesRef = useRef<OscillatorNode[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const cancelledRef = useRef(false);

  // Lazy-init AudioContext (needs user gesture)
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // ── Play alien tones for the music notes line ──
  const playEridianNotes = useCallback((notesLine: string): Promise<void> => {
    return new Promise((resolve) => {
      const ctx = getAudioCtx();
      const symbols = notesLine.split('').filter((c) => NOTE_FREQ[c]);
      if (symbols.length === 0) { resolve(); return; }

      const noteLen = 0.12;   // each note duration
      const gap = 0.04;       // gap between notes
      const totalTime = symbols.length * (noteLen + gap);

      // Master gain with gentle compression
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.15;
      masterGain.connect(ctx.destination);

      // Reverb-like delay
      const delay = ctx.createDelay();
      delay.delayTime.value = 0.08;
      const delayGain = ctx.createGain();
      delayGain.gain.value = 0.3;
      delay.connect(delayGain);
      delayGain.connect(masterGain);

      symbols.forEach((sym, i) => {
        const baseFreq = NOTE_FREQ[sym]!;
        const startTime = ctx.currentTime + i * (noteLen + gap);
        // Add slight random detune for organic feel
        const detune = (Math.random() - 0.5) * 30;

        ERIDIAN_INTERVALS.forEach((interval, j) => {
          const osc = ctx.createOscillator();
          const env = ctx.createGain();

          osc.type = j === 0 ? 'sine' : 'triangle';
          osc.frequency.value = baseFreq * interval;
          osc.detune.value = detune + j * 5;

          // ADSR-ish envelope
          env.gain.setValueAtTime(0, startTime);
          env.gain.linearRampToValueAtTime(j === 0 ? 0.6 : 0.2, startTime + 0.015);
          env.gain.exponentialRampToValueAtTime(0.001, startTime + noteLen);

          osc.connect(env);
          env.connect(masterGain);
          env.connect(delay);

          osc.start(startTime);
          osc.stop(startTime + noteLen + 0.05);
          activeNodesRef.current.push(osc);
        });
      });

      setTimeout(() => {
        activeNodesRef.current = [];
        resolve();
      }, totalTime * 1000 + 200);
    });
  }, [getAudioCtx]);

  // ── Speak the translation text using Web Speech API ──
  const speakText = useCallback((text: string, lang: Lang): Promise<void> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) { resolve(); return; }

      // Cancel any previous
      speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;

      // Language mapping
      const langMap: Record<Lang, string> = {
        zh: 'zh-CN',
        en: 'en-US',
        ja: 'ja-JP',
      };
      utterance.lang = langMap[lang];

      // Rocky's voice: slightly lower pitch, moderate rate
      utterance.pitch = 0.75;
      utterance.rate = 0.92;
      utterance.volume = 0.85;

      // Try to find a good voice
      const voices = speechSynthesis.getVoices();
      const preferredVoice = voices.find(
        (v) => v.lang.startsWith(langMap[lang].split('-')[0]) && v.localService
      );
      if (preferredVoice) utterance.voice = preferredVoice;

      utterance.onend = () => {
        utteranceRef.current = null;
        resolve();
      };
      utterance.onerror = () => {
        utteranceRef.current = null;
        resolve();
      };

      speechSynthesis.speak(utterance);
    });
  }, []);

  // ── Parse Rocky message and extract parts ──
  const parseForTTS = useCallback((content: string) => {
    const lines = content.split('\n');
    let notesLine = '';
    const textParts: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^[♫♩♪❗\s]{3,}$/.test(trimmed)) {
        notesLine = trimmed;
      } else if (/^\[(翻译|Translation|翻訳)\]/.test(trimmed)) {
        const text = trimmed.replace(/^\[(翻译|Translation|翻訳)\]\s*/, '');
        if (text) textParts.push(text);
      } else if (/^【Grace/.test(trimmed)) {
        // Grace's voice part — speak it too
        const graceText = trimmed.replace(/^【Grace[^】]*】\s*/, '');
        if (graceText) textParts.push(graceText);
      } else {
        textParts.push(trimmed);
      }
    }

    return { notesLine, text: textParts.join(' ') };
  }, []);

  // ── Main speak function ──
  const speak = useCallback(
    async (content: string, lang: Lang) => {
      if (!isEnabled) return;
      cancelledRef.current = false;
      setIsSpeaking(true);

      const { notesLine, text } = parseForTTS(content);

      // 1. Play alien tones
      if (notesLine && !cancelledRef.current) {
        await playEridianNotes(notesLine);
      }

      // 2. Small pause between notes and speech
      if (!cancelledRef.current) {
        await new Promise((r) => setTimeout(r, 300));
      }

      // 3. Speak translation
      if (text && !cancelledRef.current) {
        await speakText(text, lang);
      }

      setIsSpeaking(false);
    },
    [isEnabled, parseForTTS, playEridianNotes, speakText]
  );

  const stop = useCallback(() => {
    cancelledRef.current = true;
    // Stop oscillators
    activeNodesRef.current.forEach((osc) => {
      try { osc.stop(); } catch { /* already stopped */ }
    });
    activeNodesRef.current = [];
    // Stop speech
    speechSynthesis.cancel();
    utteranceRef.current = null;
    setIsSpeaking(false);
  }, []);

  const toggle = useCallback(() => {
    setIsEnabled((prev) => {
      if (prev) stop(); // turning off → stop any current speech
      return !prev;
    });
  }, [stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      speechSynthesis.cancel();
      activeNodesRef.current.forEach((osc) => {
        try { osc.stop(); } catch { /* */ }
      });
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return { speak, stop, isSpeaking, isEnabled, toggle };
}
