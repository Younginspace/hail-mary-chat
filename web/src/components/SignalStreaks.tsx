// v3.0 visual upgrade — occasional bright streaks that cross the screen,
// meant to read as "interstellar signals routing through the relay network."
// Sparse by design so they punctuate the start screen instead of cluttering
// it. A new streak is spawned every 3–7 seconds.

import { useEffect, useRef } from 'react';

interface Streak {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0..1, 1 = just spawned
  maxLife: number;
  hue: 'cyan' | 'amber';
}

const MAX_CONCURRENT = 3;

function randomStreak(width: number, height: number): Streak {
  // Start just off an edge and aim across the screen at a shallow angle.
  const side = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  const speed = 4 + Math.random() * 3;
  const angleJitter = (Math.random() - 0.5) * 0.5;

  if (side === 0) {
    x = -40;
    y = Math.random() * height;
    vx = Math.cos(angleJitter) * speed;
    vy = Math.sin(angleJitter) * speed;
  } else if (side === 1) {
    x = width + 40;
    y = Math.random() * height;
    vx = -Math.cos(angleJitter) * speed;
    vy = Math.sin(angleJitter) * speed;
  } else if (side === 2) {
    x = Math.random() * width;
    y = -40;
    vx = Math.sin(angleJitter) * speed;
    vy = Math.cos(angleJitter) * speed;
  } else {
    x = Math.random() * width;
    y = height + 40;
    vx = Math.sin(angleJitter) * speed;
    vy = -Math.cos(angleJitter) * speed;
  }
  return {
    x,
    y,
    vx,
    vy,
    life: 1,
    maxLife: 1 + Math.random() * 0.8,
    hue: Math.random() < 0.75 ? 'cyan' : 'amber',
  };
}

export default function SignalStreaks() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const streaks: Streak[] = [];
    let raf = 0;
    let nextSpawnAt = performance.now() + 2000;

    const step = () => {
      ctx.clearRect(0, 0, width, height);
      const now = performance.now();

      if (now >= nextSpawnAt && streaks.length < MAX_CONCURRENT) {
        streaks.push(randomStreak(width, height));
        nextSpawnAt = now + 3000 + Math.random() * 4000;
      }

      for (let i = streaks.length - 1; i >= 0; i--) {
        const s = streaks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.life -= 0.006;

        if (
          s.life <= 0 ||
          s.x < -120 || s.x > width + 120 ||
          s.y < -120 || s.y > height + 120
        ) {
          streaks.splice(i, 1);
          continue;
        }

        // Draw a trailing streak — gradient line from tail to head.
        const tailLen = 90;
        const tx = s.x - s.vx * tailLen * 0.25;
        const ty = s.y - s.vy * tailLen * 0.25;
        const grad = ctx.createLinearGradient(tx, ty, s.x, s.y);
        const base = s.hue === 'cyan' ? '0, 212, 170' : '255, 180, 90';
        grad.addColorStop(0, `rgba(${base}, 0)`);
        grad.addColorStop(1, `rgba(${base}, ${0.85 * s.life})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();

        // Bright head.
        const head = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 8);
        head.addColorStop(0, `rgba(255, 255, 255, ${0.9 * s.life})`);
        head.addColorStop(1, `rgba(${base}, 0)`);
        ctx.fillStyle = head;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(step);
    };
    step();

    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="signal-streaks" aria-hidden="true" />;
}
