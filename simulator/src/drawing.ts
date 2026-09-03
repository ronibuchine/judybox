import { DRAWING_GRID, type DrawStroke } from '@judybox/shared';

/**
 * A tiny deterministic zig-zag. Draw This does not need real artwork, only a
 * valid, distinctive-per-player submission on the same wire format a real
 * canvas produces, so payload size and transport get exercised for real.
 */
export function generateDrawing(playerIndex: number): DrawStroke[] {
  const offset = (playerIndex % 5) * 120;
  const points: number[] = [];
  for (let step = 0; step <= 6; step += 1) {
    const x = Math.min(DRAWING_GRID, 50 + offset + step * 100);
    const y = step % 2 === 0 ? 100 : 400;
    points.push(x, y);
  }
  return [{ points, size: playerIndex % 2 === 0 ? 'thin' : 'thick' }];
}
