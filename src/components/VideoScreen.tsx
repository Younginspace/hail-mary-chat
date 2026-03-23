import { useRef, useEffect, useState } from 'react';

interface Props {
  /** Whether Rocky is currently "speaking" (streaming a reply) */
  isSpeaking: boolean;
}

export default function VideoScreen({ isSpeaking }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {
      // Autoplay blocked — will play on first user interaction
      const unlock = () => {
        video.play();
        document.removeEventListener('click', unlock);
      };
      document.addEventListener('click', unlock);
    });
  }, []);

  return (
    <div className={`video-screen ${isSpeaking ? 'speaking' : ''}`}>
      {/* Scan lines overlay */}
      <div className="screen-scanlines" />
      {/* Noise overlay */}
      <div className="screen-noise" />
      {/* Signal indicator */}
      <div className="screen-signal">
        <span className="signal-dot" />
        LIVE — ERID SURFACE
      </div>
      {/* Video element */}
      <video
        ref={videoRef}
        className={`rocky-video ${videoLoaded ? 'loaded' : ''}`}
        src="/rocky-feed.mp4"
        loop
        muted
        playsInline
        onLoadedData={() => setVideoLoaded(true)}
      />
      {/* Fallback when no video */}
      {!videoLoaded && (
        <div className="video-fallback">
          <div className="fallback-text">
            ■■■ 正在建立视觉链路 ■■■
            <br />
            ESTABLISHING VISUAL LINK...
          </div>
        </div>
      )}
      {/* Vignette */}
      <div className="screen-vignette" />
    </div>
  );
}
