// Ortogonal (Manhattan) kablo yönlendirme: terminal yönünde kısa bir çıkış,
// ardından yatay/dikey parçalarla hedefe ulaşan çoklu çizgi.

import { dirVector, snap, type Dir, type Point } from './geometry';

export const STUB = 10;

export interface Endpoint extends Point {
  dir: Dir;
}

const vertical = (d: Dir) => d === 'up' || d === 'down';

/** Ardışık tekrarları ve aynı doğru üzerindeki ara noktaları kaldırır. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3) as [Point, Point, Point];
      const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

export function route(a: Endpoint, b: Endpoint | Point & { dir?: Dir }): Point[] {
  const va = dirVector(a.dir);
  const a1 = { x: a.x + va.x * STUB, y: a.y + va.y * STUB };
  const b1 = b.dir ? { x: b.x + dirVector(b.dir).x * STUB, y: b.y + dirVector(b.dir).y * STUB } : { x: b.x, y: b.y };

  let middle: Point[];
  if (vertical(a.dir) && (!b.dir || vertical(b.dir))) {
    const my = b.dir ? snap((a1.y + b1.y) / 2) : a1.y;
    middle = b.dir ? [{ x: a1.x, y: my }, { x: b1.x, y: my }] : [{ x: a1.x, y: b1.y }];
  } else if (!vertical(a.dir) && (!b.dir || !vertical(b.dir))) {
    const mx = b.dir ? snap((a1.x + b1.x) / 2) : a1.x;
    middle = b.dir ? [{ x: mx, y: a1.y }, { x: mx, y: b1.y }] : [{ x: b1.x, y: a1.y }];
  } else if (vertical(a.dir)) {
    middle = [{ x: a1.x, y: b1.y }];
  } else {
    middle = [{ x: b1.x, y: a1.y }];
  }
  return simplify([{ x: a.x, y: a.y }, a1, ...middle, b1, { x: b.x, y: b.y }]);
}

export const toPath = (points: Point[]) => points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
