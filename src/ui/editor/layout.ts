// Sayfa düzeni: sayfadaki elemanlar/kablolar, kablo güzergâhları ve sayfa geçişi referansları.
// Saf fonksiyonlar; çizim alanı ve testler kullanır.

import { pageOf, pagesOf, terminalKey, type ComponentInstance, type Schematic, type Wire } from '../../sim/schematic';
import { bounds, worldTerminal, worldTerminals, type Point } from './geometry';
import { routeAll, type RouteRequest } from './routing';

/** Sayfa çerçevesi (A3 yatay oranı) ve antet. */
export const SHEET = { w: 1200, h: 840, titleW: 420, titleH: 60 };

export interface PageContent {
  components: ComponentInstance[];
  /** İki ucu da bu sayfada olan kablolar. */
  wires: Wire[];
}

export function pageContent(s: Schematic, page: string): PageContent {
  const components = s.components.filter((c) => pageOf(s, c) === page);
  const ids = new Set(components.map((c) => c.id));
  return { components, wires: s.wires.filter((w) => ids.has(w.a.component) && ids.has(w.b.component)) };
}

/** Kablolarla birbirine bağlı terminallere aynı net numarasını verir. */
function netNumbers(components: ComponentInstance[], wires: Wire[]): (key: string) => number {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const w of wires) {
    const ra = find(terminalKey(w.a));
    const rb = find(terminalKey(w.b));
    if (ra !== rb) parent.set(ra, rb);
  }
  const numbers = new Map<string, number>();
  for (const c of components) for (const t of worldTerminals(c)) {
    const root = find(terminalKey(t.ref));
    if (!numbers.has(root)) numbers.set(root, numbers.size);
  }
  return (key) => numbers.get(find(key)) ?? -1;
}

/** Sayfadaki tüm kabloların güzergâhı: engellerden kaçan A* (elle verilenler aynen). */
export function routePage(content: PageContent): Map<string, Point[]> {
  const { components, wires } = content;
  const byId = new Map(components.map((c) => [c.id, c]));
  const net = netNumbers(components, wires);
  const requests: RouteRequest[] = [];
  for (const w of wires) {
    const ca = byId.get(w.a.component);
    const cb = byId.get(w.b.component);
    const a = ca && worldTerminal(ca, w.a.terminal);
    const b = cb && worldTerminal(cb, w.b.terminal);
    if (a && b) requests.push({ id: w.id, a, b, points: w.points, net: net(terminalKey(w.a)) });
  }
  const obstacles = components.filter((c) => c.type !== 'junction').map(bounds);
  const terminals = components.flatMap((c) =>
    worldTerminals(c).map((t) => ({ ...t, net: net(terminalKey(t.ref)) })),
  );
  return routeAll(requests, obstacles, terminals);
}

/** Sayfa geçişinin karşılıkları: aynı adlı geçişlerin bulunduğu diğer sayfalar. */
export function xrefTargets(s: Schematic, xref: ComponentInstance): { page: string; component: string; label: string }[] {
  const pages = pagesOf(s);
  const own = pageOf(s, xref);
  return s.components
    .filter((c) => c.type === 'xref' && c.name === xref.name && c.id !== xref.id && pageOf(s, c) !== own)
    .map((c) => {
      const page = pageOf(s, c);
      return { page, component: c.id, label: `/${pages.findIndex((p) => p.id === page) + 1}` };
    });
}

/** Seçim kutusu: soldan sağa = tamamen içindekiler (pencere), sağdan sola = değenler (kesişen). */
export interface BoxSelect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boxSelect(
  content: PageContent,
  paths: Map<string, Point[]>,
  box: BoxSelect,
): { components: string[]; wires: string[] } {
  const crossing = box.x1 < box.x0;
  const r = {
    x: Math.min(box.x0, box.x1),
    y: Math.min(box.y0, box.y1),
    w: Math.abs(box.x1 - box.x0),
    h: Math.abs(box.y1 - box.y0),
  };
  const inside = (p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const segHits = (a: Point, b: Point) =>
    Math.max(a.x, b.x) >= r.x &&
    Math.min(a.x, b.x) <= r.x + r.w &&
    Math.max(a.y, b.y) >= r.y &&
    Math.min(a.y, b.y) <= r.y + r.h;
  const components = content.components
    .filter((c) => {
      const b = bounds(c);
      const corners = [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
      ];
      if (!crossing) return corners.every(inside);
      return b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y;
    })
    .map((c) => c.id);
  const wires = content.wires
    .filter((w) => {
      const pts = paths.get(w.id);
      if (!pts?.length) return false;
      if (!crossing) return pts.every(inside);
      return pts.some((p, i) => i > 0 && segHits(pts[i - 1]!, p));
    })
    .map((w) => w.id);
  return { components, wires };
}
