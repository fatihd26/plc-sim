// Sembol geometrisi: her tipin boyutu ve terminal konumları (yerel koordinat, ızgara = 10).
// Terminal adları çekirdek kataloğuyla birebir eşleşmelidir (geometry.test.ts denetler).

import { CATALOG, PLC_DI, PLC_DQ, type ComponentType } from '../../sim/catalog';
import type { ComponentInstance, Rotation, TerminalRef } from '../../sim/schematic';

export const GRID = 10;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Point {
  x: number;
  y: number;
}

export interface TerminalGeo extends Point {
  name: string;
  dir: Dir;
}

export interface SymbolGeo {
  w: number;
  h: number;
  terminals: TerminalGeo[];
}

const top = (name: string, x: number): TerminalGeo => ({ name, x, y: 0, dir: 'up' });
const bottom = (name: string, x: number, h: number): TerminalGeo => ({ name, x, y: h, dir: 'down' });

export const GEOMETRY: Record<ComponentType, SymbolGeo> = {
  mains3: { w: 80, h: 40, terminals: [bottom('L1', 20, 40), bottom('L2', 40, 40), bottom('L3', 60, 40)] },
  psu24: { w: 60, h: 60, terminals: [bottom('L+', 20, 60), bottom('M', 40, 60)] },
  buttonNO: { w: 40, h: 60, terminals: [top('13', 20), bottom('14', 20, 60)] },
  buttonNC: { w: 40, h: 60, terminals: [top('11', 20), bottom('12', 20, 60)] },
  estop: { w: 40, h: 60, terminals: [top('11', 20), bottom('12', 20, 60)] },
  breaker3: {
    w: 80,
    h: 80,
    terminals: [['1', '2'], ['3', '4'], ['5', '6']].flatMap(([t, b], i) => [top(t!, 20 + i * 20), bottom(b!, 20 + i * 20, 80)]),
  },
  lamp: { w: 40, h: 60, terminals: [top('X1', 20), bottom('X2', 20, 60)] },
  terminal: { w: 20, h: 40, terminals: [top('1', 10), bottom('2', 10, 40)] },
  contactor: {
    w: 140,
    h: 80,
    terminals: [
      ...[['1', '2'], ['3', '4'], ['5', '6'], ['13', '14'], ['21', '22'], ['A1', 'A2']].flatMap(([t, b], i) => [
        top(t!, 20 + i * 20),
        bottom(b!, 20 + i * 20, 80),
      ]),
    ],
  },
  thermal: {
    w: 120,
    h: 80,
    terminals: [
      ...[['1', '2'], ['3', '4'], ['5', '6'], ['95', '96'], ['97', '98']].flatMap(([t, b], i) => [
        top(t!, 20 + i * 20),
        bottom(b!, 20 + i * 20, 80),
      ]),
    ],
  },
  motor3: { w: 80, h: 80, terminals: [top('U', 20), top('V', 40), top('W', 60)] },
  plc: {
    w: 220,
    h: 100,
    terminals: [
      top('L+', 20),
      top('M', 40),
      ...PLC_DI.map((n, i) => top(n, 60 + i * 20)),
      ...PLC_DQ.map((n, i) => bottom(n, 60 + i * 20, 100)),
    ],
  },
};

const DIR_VEC: Record<Dir, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export function dirVector(d: Dir): Point {
  return DIR_VEC[d];
}

/** SVG rotate(θ) ile aynı yönde (ekranda saat yönü) döndürür. */
function rotate(p: Point, r: Rotation): Point {
  switch (r) {
    case 0:
      return p;
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
  }
}

function rotateDir(d: Dir, r: Rotation): Dir {
  const v = rotate(DIR_VEC[d], r);
  return (Object.keys(DIR_VEC) as Dir[]).find((k) => DIR_VEC[k].x === v.x && DIR_VEC[k].y === v.y)!;
}

/** Yerel noktayı dünya koordinatına çevirir (bileşen merkezi etrafında döndürme). */
export function toWorld(inst: Pick<ComponentInstance, 'type' | 'x' | 'y' | 'rotation'>, p: Point): Point {
  const g = GEOMETRY[inst.type];
  const c = { x: g.w / 2, y: g.h / 2 };
  const r = rotate({ x: p.x - c.x, y: p.y - c.y }, inst.rotation);
  return { x: inst.x + c.x + r.x + 0, y: inst.y + c.y + r.y + 0 };
}

export interface WorldTerminal extends TerminalGeo {
  ref: TerminalRef;
}

export function worldTerminals(inst: ComponentInstance): WorldTerminal[] {
  return GEOMETRY[inst.type].terminals.map((t) => ({
    ...toWorld(inst, t),
    name: t.name,
    dir: rotateDir(t.dir, inst.rotation),
    ref: { component: inst.id, terminal: t.name },
  }));
}

export function worldTerminal(inst: ComponentInstance, name: string): WorldTerminal | undefined {
  return worldTerminals(inst).find((t) => t.name === name);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Döndürülmüş bileşenin eksen hizalı sınır kutusu. */
export function bounds(inst: Pick<ComponentInstance, 'type' | 'x' | 'y' | 'rotation'>): Rect {
  const g = GEOMETRY[inst.type];
  const quarter = inst.rotation === 90 || inst.rotation === 270;
  const w = quarter ? g.h : g.w;
  const h = quarter ? g.w : g.h;
  return { x: inst.x + (g.w - w) / 2, y: inst.y + (g.h - h) / 2, w, h };
}

export function unionBounds(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Katalog ile geometri tutarlılığı: eksik/fazla terminal adlarını döndürür. */
export function geometryMismatches(): string[] {
  const out: string[] = [];
  for (const type of Object.keys(CATALOG) as ComponentType[]) {
    const geo = GEOMETRY[type].terminals.map((t) => t.name).sort();
    const cat = [...CATALOG[type].terminals].sort();
    if (geo.join() !== cat.join()) out.push(`${type}: geometri [${geo.join()}] ≠ katalog [${cat.join()}]`);
  }
  return out;
}
