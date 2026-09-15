import { useEffect, useRef } from 'react';

const COLORS = ['#d98462', '#e6c07b', '#93b08f', '#f6f1e9'];
const GRAVITY = 0.16;
const DURATION_MS = 2200;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  spin: number;
}

function createPieces(width: number, height: number, count: number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i += 1) {
    pieces.push({
      x: Math.random() * width,
      y: height * -0.2 - Math.random() * height * 0.3,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 2 + 1.5,
      size: Math.random() * 6 + 4,
      color: COLORS[i % COLORS.length] as string,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.2,
    });
  }
  return pieces;
}

/**
 * A one-shot confetti burst, not a looping background effect. Purely
 * decorative: mounting/unmounting it never affects any server state.
 */
export function Confetti({ density = 'full' }: { density?: 'full' | 'subtle' }): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const resize = (): void => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const count = density === 'full' ? 140 : 40;
    const pieces = createPieces(canvas.width, canvas.height, count);
    const start = performance.now();
    let frame = 0;

    const tick = (now: number): void => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (elapsed >= DURATION_MS) return;

      for (const piece of pieces) {
        piece.vy += GRAVITY * 0.05;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;

        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rotation);
        ctx.fillStyle = piece.color;
        ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        ctx.restore();
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [density]);

  return <canvas ref={canvasRef} className="confetti" aria-hidden="true" />;
}
