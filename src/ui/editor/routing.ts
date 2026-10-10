// Ortogonal (Manhattan) kablo yönlendirme.
//  - route(): iki uç arasında basit L/Z güzergâh (kablo çizerken lastik bant ve yedek çözüm).
//  - routeAll(): sayfadaki tüm kablolar için ızgara üzerinde A*. Eleman gövdeleri engeldir;
//    büküm, başka bir netin kablosuyla üst üste binme ve başka terminallerin çıkış payından
//    geçme cezalandırılır. Aynı netin kabloları ucuza aynı hattı paylaşabilir (bara gibi).
//  - Elle şekillendirilmiş kablolar (points) verilen ara noktalardan geçer.

import { dirVector, GRID, snap, type Dir, type Point, type Rect } from './geometry';

export const STUB = 10;

export interface Endpoint extends Point {
  dir: Dir;
  /** Yönsüz uç (bağlantı noktası): çıkış payı yok, her yönden girilebilir. */
  free?: boolean;
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

/** Terminalden çıkış payı kadar uzaktaki nokta (yönsüz uçta kendisi). */
export function stubPoint(e: Endpoint): Point {
  if (e.free) return { x: e.x, y: e.y };
  const v = dirVector(e.dir);
  return { x: e.x + v.x * STUB, y: e.y + v.y * STUB };
}

export function route(a: Endpoint, b: Endpoint | (Point & { dir?: Dir; free?: boolean })): Point[] {
  const a1 = stubPoint(a);
  const bDir = b.free ? undefined : b.dir;
  const b1 = bDir ? stubPoint({ ...b, dir: bDir }) : { x: b.x, y: b.y };
  const aDir: Dir = a.free ? (Math.abs(b1.x - a1.x) >= Math.abs(b1.y - a1.y) ? 'right' : 'down') : a.dir;

  let middle: Point[];
  if (vertical(aDir) && (!bDir || vertical(bDir))) {
    const my = bDir ? snap((a1.y + b1.y) / 2) : a1.y;
    middle = bDir ? [{ x: a1.x, y: my }, { x: b1.x, y: my }] : [{ x: a1.x, y: b1.y }];
  } else if (!vertical(aDir) && (!bDir || !vertical(bDir))) {
    const mx = bDir ? snap((a1.x + b1.x) / 2) : a1.x;
    middle = bDir ? [{ x: mx, y: a1.y }, { x: mx, y: b1.y }] : [{ x: b1.x, y: a1.y }];
  } else if (vertical(aDir)) {
    middle = [{ x: a1.x, y: b1.y }];
  } else {
    middle = [{ x: b1.x, y: a1.y }];
  }
  return simplify([{ x: a.x, y: a.y }, a1, ...middle, b1, { x: b.x, y: b.y }]);
}

/** Noktaları sırayla, eksene paralel olmayan geçişlere köşe ekleyerek birleştirir. */
export function orthoJoin(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x !== p.x && last.y !== p.y) {
      // Önceki parça dikeyse önce yatay git (ve tersi): gereksiz büküm oluşmaz.
      const prev = out[out.length - 2];
      const prevVertical = prev ? prev.x === last.x : false;
      out.push(prevVertical ? { x: p.x, y: last.y } : { x: last.x, y: p.y });
    }
    out.push(p);
  }
  return simplify(out);
}

/** Elle şekillendirilmiş kablo: terminal → çıkış payı → ara noktalar → çıkış payı → terminal. */
export function manualRoute(a: Endpoint, b: Endpoint, points: Point[]): Point[] {
  return orthoJoin([{ x: a.x, y: a.y }, stubPoint(a), ...points, stubPoint(b), { x: b.x, y: b.y }]);
}

export const toPath = (points: Point[]) => points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');

// --- A* ile toplu yönlendirme -------------------------------------------------------------

export interface RouteRequest {
  id: string;
  a: Endpoint;
  b: Endpoint;
  /** Elle verilmiş ara noktalar. */
  points?: Point[];
  /** Elektriksel net numarası: aynı netin kabloları hattı paylaşabilir. */
  net: number;
}

const COST = {
  step: 1,
  bend: 3,
  /** Aynı netin kablosu üzerinden (paylaşım). */
  shared: 0.4,
  /** Başka netin kablosuyla aynı doğrultuda üst üste. */
  overlap: 40,
  /** Başka netin kablosunu dik kesme. */
  cross: 2,
  /** Başka netin köşesi/ucu üzerinden geçme (bağlantı gibi görünür). */
  corner: 40,
  /** Başka bir terminalin çıkış payı. */
  reserved: 25,
};

const MARGIN = 80;
const MAX_EXPANSIONS = 400_000;
const DIRS: Dir[] = ['up', 'right', 'down', 'left'];
const NONE = 4;

class MinHeap {
  private readonly f: number[] = [];
  private readonly v: number[] = [];
  get size() {
    return this.v.length;
  }
  push(f: number, v: number) {
    const fs = this.f;
    const vs = this.v;
    let i = vs.length;
    fs.push(f);
    vs.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fs[p]! <= f) break;
      fs[i] = fs[p]!;
      vs[i] = vs[p]!;
      i = p;
    }
    fs[i] = f;
    vs[i] = v;
  }
  pop(): number {
    const fs = this.f;
    const vs = this.v;
    const top = vs[0]!;
    const lf = fs.pop()!;
    const lv = vs.pop()!;
    const n = vs.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && fs[r]! < fs[l]! ? r : l;
        if (fs[c]! >= lf) break;
        fs[i] = fs[c]!;
        vs[i] = vs[c]!;
        i = c;
      }
      fs[i] = lf;
      vs[i] = lv;
    }
    return top;
  }
}

class Grid {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  readonly blocked: Uint8Array;
  readonly reserved: Int32Array;
  /** Hücreyi yatay/dikey kullanan net (+1); -1 = birden çok net. 0 = boş. */
  readonly hNet: Int32Array;
  readonly vNet: Int32Array;
  readonly cornerNet: Int32Array;

  constructor(area: Rect) {
    this.x0 = snap(area.x - MARGIN);
    this.y0 = snap(area.y - MARGIN);
    this.w = Math.ceil((area.w + 2 * MARGIN) / GRID) + 2;
    this.h = Math.ceil((area.h + 2 * MARGIN) / GRID) + 2;
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.reserved = new Int32Array(n);
    this.hNet = new Int32Array(n);
    this.vNet = new Int32Array(n);
    this.cornerNet = new Int32Array(n);
  }

  cell(p: Point): number {
    const cx = Math.round((p.x - this.x0) / GRID);
    const cy = Math.round((p.y - this.y0) / GRID);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1;
    return cy * this.w + cx;
  }

  point(cell: number): Point {
    return { x: this.x0 + (cell % this.w) * GRID, y: this.y0 + Math.floor(cell / this.w) * GRID };
  }

  block(r: Rect): void {
    const cx0 = Math.max(0, Math.ceil((r.x - this.x0) / GRID));
    const cx1 = Math.min(this.w - 1, Math.floor((r.x + r.w - this.x0) / GRID));
    const cy0 = Math.max(0, Math.ceil((r.y - this.y0) / GRID));
    const cy1 = Math.min(this.h - 1, Math.floor((r.y + r.h - this.y0) / GRID));
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) this.blocked[y * this.w + x] = 1;
  }

  /** Güzergâhı doluluk tablolarına işler. */
  occupy(points: Point[], net: number): void {
    const mark = (arr: Int32Array, c: number) => {
      if (c < 0) return;
      const cur = arr[c]!;
      arr[c] = cur === 0 || cur === net + 1 ? net + 1 : -1;
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const horizontal = a.y === b.y;
      const steps = Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / GRID);
      for (let s = 0; s <= steps; s++) {
        const t = steps ? s / steps : 0;
        const c = this.cell({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        mark(horizontal ? this.hNet : this.vNet, c);
      }
    }
    for (const p of points) mark(this.cornerNet, this.cell(p));
  }
}

const otherNet = (v: number, net: number) => v !== 0 && v !== net + 1;

function astar(grid: Grid, req: RouteRequest): Point[] | null {
  const start = stubPoint(req.a);
  const goal = stubPoint(req.b);
  const sc = grid.cell(start);
  const gc = grid.cell(goal);
  if (sc < 0 || gc < 0) return null;
  if (sc === gc) return [start];

  const W = grid.w;
  const n = W * grid.h;
  const g = new Float64Array(n * 5).fill(Infinity);
  const parent = new Int32Array(n * 5).fill(-1);
  const closed = new Uint8Array(n * 5);
  const heap = new MinHeap();
  const gx = gc % W;
  const gy = Math.floor(gc / W);
  const hcost = (c: number) => Math.abs((c % W) - gx) + Math.abs(Math.floor(c / W) - gy);
  // Hedefe varış yönü: hedef terminalin çıkış yönünün tersi (yönsüz uçta serbest).
  const arrive = req.b.free ? -1 : DIRS.indexOf(({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[req.b.dir]);

  const s0 = sc * 5 + (req.a.free ? NONE : DIRS.indexOf(req.a.dir));
  g[s0] = 0;
  heap.push(hcost(sc), s0);
  const net = req.net;

  let expansions = 0;
  while (heap.size) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    const c = Math.floor(s / 5);
    const d = s % 5;
    if (c === gc) {
      const cells: number[] = [];
      for (let k = s; k >= 0; k = parent[k]!) cells.push(Math.floor(k / 5));
      return cells.reverse().map((k) => grid.point(k));
    }
    if (++expansions > MAX_EXPANSIONS) return null;
    const cx = c % W;
    for (let nd = 0; nd < 4; nd++) {
      if (d !== NONE && (nd + 2) % 4 === d) continue; // geri dönüş yok
      let nc: number;
      if (nd === 0) nc = c - W;
      else if (nd === 2) nc = c + W;
      else if (nd === 1) nc = cx + 1 < W ? c + 1 : -1;
      else nc = cx > 0 ? c - 1 : -1;
      if (nc < 0 || nc >= n) continue;
      if (grid.blocked[nc] && nc !== gc) continue;
      const horizontal = nd === 1 || nd === 3;
      const same = horizontal ? grid.hNet[nc]! : grid.vNet[nc]!;
      const perp = horizontal ? grid.vNet[nc]! : grid.hNet[nc]!;
      let cost = same === net + 1 ? COST.shared : COST.step;
      if (otherNet(same, net)) cost += COST.overlap;
      if (otherNet(perp, net)) cost += COST.cross;
      if (otherNet(grid.cornerNet[nc]!, net)) cost += COST.corner;
      if (grid.reserved[nc] && grid.reserved[nc] !== net + 1 && nc !== gc) cost += COST.reserved;
      if (d !== NONE && nd !== d) cost += COST.bend;
      if (nc === gc && arrive >= 0 && nd !== arrive) cost += COST.bend;
      const ns = nc * 5 + nd;
      const ng = g[s]! + cost;
      if (ng < g[ns]!) {
        g[ns] = ng;
        parent[ns] = s;
        heap.push(ng + hcost(nc), ns);
      }
    }
  }
  return null;
}

/**
 * Sayfadaki kabloları sırayla yönlendirir: önce elle şekillendirilenler, sonra diğerleri.
 * `terminals`: sayfadaki tüm terminaller (çıkış payları başka kablolara kapatılır).
 */
export function routeAll(requests: RouteRequest[], obstacles: Rect[], terminals: (Endpoint & { net: number })[]): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  if (requests.length === 0) return out;
  const pts: Point[] = [
    ...requests.flatMap((r) => [r.a, r.b, ...(r.points ?? [])]),
    ...obstacles.flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
    ]),
  ];
  const x0 = Math.min(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y1 = Math.max(...pts.map((p) => p.y));
  const grid = new Grid({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  for (const r of obstacles) grid.block(r);
  for (const t of terminals) {
    if (t.free) continue;
    const c = grid.cell(stubPoint(t));
    if (c >= 0) grid.reserved[c] = grid.reserved[c] && grid.reserved[c] !== t.net + 1 ? -1 : t.net + 1;
  }

  const ordered = [...requests.filter((r) => r.points), ...requests.filter((r) => !r.points)];
  for (const req of ordered) {
    let path: Point[];
    if (req.points) path = manualRoute(req.a, req.b, req.points);
    else {
      const mid = astar(grid, req);
      path = mid
        ? simplify([{ x: req.a.x, y: req.a.y }, ...mid, { x: req.b.x, y: req.b.y }])
        : route(req.a, req.b);
    }
    grid.occupy(path, req.net);
    out.set(req.id, path);
  }
  return out;
}

/** Noktanın çoklu çizgiye uzaklığı ve en yakın parçadaki izdüşümü. */
export function nearestOnPath(points: Point[], p: Point): { distance: number; point: Point; segment: number } {
  let best = { distance: Infinity, point: points[0] ?? p, segment: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.distance) best = { distance: d, point: q, segment: i - 1 };
  }
  return best;
}

/**
 * Bir parçayı dikey doğrultusunda `to` konumuna kaydırır (CAD'deki parça sürükleme).
 * Terminale bağlı ilk/son parça sabit kalır; gerekirse araya bağlantı parçası eklenir.
 * Sonuç, kabloya kaydedilecek ara noktalardır (terminaller hariç).
 */
export function dragSegment(path: Point[], segment: number, to: Point): Point[] {
  const pts = path.map((p) => ({ ...p }));
  const last = pts.length - 1;
  if (segment <= 0 || segment >= last - 1) return pts.slice(1, -1);
  const a = pts[segment]!;
  const b = pts[segment + 1]!;
  const horizontal = a.y === b.y;
  const value = snap(horizontal ? to.y : to.x);
  const moved = (p: Point) => (horizontal ? { x: p.x, y: value } : { x: value, y: p.y });
  // Çıkış payı noktaları (1 ve last-1) yerinde kalsın: kopyası taşınır.
  const before = segment === 1 ? [a, moved(a)] : [moved(a)];
  const after = segment + 1 === last - 1 ? [moved(b), b] : [moved(b)];
  const next = [...pts.slice(0, segment), ...before, ...after, ...pts.slice(segment + 2)];
  return simplify(next).slice(1, -1);
}
