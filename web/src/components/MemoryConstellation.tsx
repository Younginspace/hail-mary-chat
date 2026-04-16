// v3.0 visual upgrade — "memory constellation" overlay on the start screen.
//
// A canvas-2D layer of drifting particles that draw faint lines between
// themselves when close. The metaphor: Rocky's memory graph waking up.
// Kept intentionally quiet (low alpha, small particles, low count) so it
// sits on top of Starfield without fighting it.

import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  seed: number;
}

const COUNT_DESKTOP = 64;
const COUNT_MOBILE = 32;
const LINK_DIST = 140;
const LINK_DIST_MOBILE = 110;

export default function MemoryConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isMobile = window.innerWidth < 640;
    const targetCount = isMobile ? COUNT_MOBILE : COUNT_DESKTOP;
    const linkDist = isMobile ? LINK_DIST_MOBILE : LINK_DIST;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;

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

    const particles: Particle[] = Array.from({ length: targetCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 1.6 + 0.6,
      seed: Math.random() * Math.PI * 2,
    }));

    // Pointer attraction — makes the graph feel responsive. Muted so it
    // doesn't hijack attention from the CTA.
    const pointer = { x: width / 2, y: height / 2, active: false };
    const onPointerMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    };
    const onPointerLeave = () => {
      pointer.active = false;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);

    let raf = 0;
    const start = performance.now();

    const step = () => {
      const t = (performance.now() - start) / 1000;
      ctx.clearRect(0, 0, width, height);

      // Update positions.
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        if (pointer.active) {
          const dx = pointer.x - p.x;
          const dy = pointer.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 160 * 160) {
            const f = 0.0006;
            p.vx += dx * f;
            p.vy += dy * f;
          }
        }
        // Mild damping so the graph doesn't shoot off to infinity.
        p.vx *= 0.992;
        p.vy *= 0.992;

        // Wrap around edges.
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
      }

      // Draw links.
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < linkDist) {
            const alpha = (1 - d / linkDist) * 0.45;
            // Slow flicker based on seeds so links pulse asynchronously.
            const flick = 0.7 + 0.3 * Math.sin(t * 1.6 + a.seed + b.seed);
            ctx.strokeStyle = `rgba(0, 212, 170, ${alpha * flick})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Draw nodes with soft glow.
      for (const p of particles) {
        const pulse = 0.55 + 0.45 * Math.sin(t * 1.3 + p.seed);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
        glow.addColorStop(0, `rgba(80, 240, 210, ${0.55 * pulse})`);
        glow.addColorStop(1, 'rgba(0, 212, 170, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(200, 255, 240, ${0.9 * pulse})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
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
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="memory-constellation" aria-hidden="true" />;
}
