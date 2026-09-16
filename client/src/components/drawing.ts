import { DRAWING_GRID, type DrawingColor, type DrawStroke } from '@judybox/shared';

const DRAWING_COLOR_TOKENS: Record<DrawingColor, string> = {
  black: '--c-drawing-black',
  blue: '--c-drawing-blue',
  green: '--c-drawing-green',
  red: '--c-drawing-red',
  yellow: '--c-drawing-yellow',
};

export function drawingColorToken(color: DrawingColor): string {
  return DRAWING_COLOR_TOKENS[color];
}

function drawingColorValue(color: DrawingColor): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(drawingColorToken(color))
    .trim();
}

export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly DrawStroke[],
  width: number,
  height: number,
): void {
  for (const stroke of strokes) {
    if (stroke.points.length < 4) continue;
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    if (!stroke.erase) ctx.strokeStyle = drawingColorValue(stroke.color ?? 'black');
    ctx.lineWidth = stroke.size === 'thick' ? width / 32 : width / 110;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < stroke.points.length; i += 2) {
      const x = (stroke.points[i]! / DRAWING_GRID) * width;
      const y = (stroke.points[i + 1]! / DRAWING_GRID) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}