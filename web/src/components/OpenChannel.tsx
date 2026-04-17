import { useState, useRef, useEffect } from 'react';
import { useLang } from '../i18n/LangContext';
import { t } from '../i18n';
import { getDefaultDialogs, type DefaultDialog } from '../utils/defaultDialogs';

// Strip the [MOOD:xxx], [LIKE], [Translation]/[翻译]/[翻訳] control tags and
// leave only the prose — same cleanup the export uses.
function cleanReply(raw: string): string {
  return raw
    .replace(/\[MOOD:[a-zA-Z]+\]/g, '')
    .replace(/\[(LIKE|INTRO|DIRTY)\]/g, '')
    .replace(/\[(Translation|翻译|翻訳)\]\s*/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
}

export default function OpenChannel() {
  const { lang } = useLang();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const dialogs: DefaultDialog[] = getDefaultDialogs(lang);

  // Stop any playing audio on language switch / unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [lang]);

  const handlePlay = (idx: number, dialog: DefaultDialog) => {
    // Same button toggles stop when already playing.
    if (playingIdx === idx && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingIdx(null);
      return;
    }
    // Replace any in-flight clip.
    audioRef.current?.pause();
    const audio = new Audio(dialog.audioFile);
    audioRef.current = audio;
    setPlayingIdx(idx);
    audio.onended = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingIdx(null);
      }
    };
    audio.onerror = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlayingIdx(null);
      }
    };
    audio.play().catch(() => {
      setPlayingIdx(null);
    });
  };

  if (dialogs.length === 0) {
    return <div className="channel-status">{t('channel.noBroadcastFallback', lang)}</div>;
  }

  return (
    <div className="channel-list" role="list">
      {dialogs.map((dialog, idx) => {
        const expanded = openIdx === idx;
        const playing = playingIdx === idx;
        const answer = cleanReply(dialog.reply);
        return (
          <div key={dialog.question} className={`channel-item ${expanded ? 'expanded' : ''}`} role="listitem">
            <button
              type="button"
              className="channel-q"
              aria-expanded={expanded}
              onClick={() => setOpenIdx(expanded ? null : idx)}
            >
              <span className="channel-q-marker">{expanded ? '▼' : '▸'}</span>
              <span className="channel-q-text">{dialog.question}</span>
            </button>
            {expanded && (
              <div className="channel-a">
                <button
                  type="button"
                  className={`channel-play ${playing ? 'playing' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlay(idx, dialog);
                  }}
                  aria-label={playing ? 'Stop' : 'Play'}
                  title={playing ? 'Stop' : 'Play'}
                >
                  {playing ? (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" />
                      <rect x="14" y="5" width="4" height="14" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                      <polygon points="6,4 20,12 6,20" />
                    </svg>
                  )}
                </button>
                <span className="channel-a-prefix">Rocky:</span>
                <span className="channel-a-text">{answer}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
