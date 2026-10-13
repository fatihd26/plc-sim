// Sembol geometrisi: her tipin boyutu ve terminal konumları (yerel koordinat, ızgara = 10).
// Terminal adları çekirdek kataloğuyla birebir eşleşmelidir (editor.test.ts denetler).
// Kullanıcı tanımlı bileşenlerin geometrisi tanımlarından türetilir.

import { CATALOG, PLC_AI, PLC_AQ, PLC_DI, PLC_DQ, terminalsOf, type ComponentType, type CoreType, type CustomDef } from '../../sim/catalog';
import { viewOf } from '../devices';
import type { ComponentInstance, Point, Rotation, TerminalRef } from '../../sim/schematic';

export type { Point };

export const GRID = 10;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface TerminalGeo extends Point {
  name: string;
  dir: Dir;
  /** Yönsüz uç (bağlantı noktası): kablo her yönden girebilir, çıkış payı yoktur. */
  free?: boolean;
}

export interface SymbolGeo {
  w: number;
  h: number;
  terminals: TerminalGeo[];
}

/** Çizimi bu dosyada olan çekirdek tipler (modüllerin geometrisi görünümlerindedir). */
type BuiltinType = Exclude<CoreType, 'custom'>;

const top = (name: string, x: number): TerminalGeo => ({ name, x, y: 0, dir: 'up' });
const bottom = (name: string, x: number, h: number): TerminalGeo => ({ name, x, y: h, dir: 'down' });

export const GEOMETRY: Record<BuiltinType, SymbolGeo> = {
  mains3: {
    w: 100,
    h: 40,
    terminals: [bottom('L1', 20, 40), bottom('L2', 40, 40), bottom('L3', 60, 40), bottom('N', 80, 40)],
  },
  psu24: { w: 60, h: 60, terminals: [bottom('L+', 20, 60), bottom('M', 40, 60)] },
  buttonNO: { w: 40, h: 60, terminals: [top('13', 20), bottom('14', 20, 60)] },
  buttonNC: { w: 40, h: 60, terminals: [top('11', 20), bottom('12', 20, 60)] },
  estop: { w: 40, h: 60, terminals: [top('11', 20), bottom('12', 20, 60)] },
  breaker3: {
    w: 80,
    h: 80,
    terminals: [['1', '2'], ['3', '4'], ['5', '6']].flatMap(([t, b], i) => [top(t!, 20 + i * 20), bottom(b!, 20 + i * 20, 80)]),
  },
  fuse: { w: 40, h: 60, terminals: [top('1', 20), bottom('2', 20, 60)] },
  lamp: { w: 40, h: 60, terminals: [top('X1', 20), bottom('X2', 20, 60)] },
  terminal: { w: 20, h: 40, terminals: [top('1', 10), bottom('2', 10, 40)] },
  junction: { w: 20, h: 20, terminals: [{ name: '1', x: 10, y: 10, dir: 'up', free: true }] },
  xref: { w: 60, h: 20, terminals: [{ name: '1', x: 0, y: 10, dir: 'left' }] },
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
  relay: {
    w: 100,
    h: 80,
    terminals: [['13', '14'], ['23', '24'], ['31', '32'], ['A1', 'A2']].flatMap(([t, b], i) => [
      top(t!, 20 + i * 20),
      bottom(b!, 20 + i * 20, 80),
    ]),
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
  esp32: {
    w: 160,
    h: 100,
    terminals: [
      top('24V', 20),
      top('GND', 40),
      top('RS485_A', 100),
      top('RS485_B', 120),
      bottom('GPIO16', 20, 100),
      bottom('GPIO17', 40, 100),
      bottom('GPIO18', 60, 100),
      bottom('GPIO19', 80, 100),
      bottom('ADC1', 120, 100),
    ],
  },
  plc: {
    w: 220,
    h: 100,
    terminals: [
      top('L+', 20),
      top('M', 40),
      ...PLC_DI.map((n, i) => top(n, 60 + i * 20)),
      ...PLC_DQ.map((n, i) => bottom(n, 60 + i * 20, 100)),
      { name: 'RS485_A', x: 220, y: 40, dir: 'right' },
      { name: 'RS485_B', x: 220, y: 60, dir: 'right' },
      // Analog modül sol yanda: girişler üstte, çıkışlar altta
      ...[...PLC_AI, ...PLC_AQ].map((name, i): TerminalGeo => ({ name, x: 0, y: 20 + i * 20, dir: 'left' })),
    ],
  },
};

/** Kullanıcı bileşeni: kutuplar 20 aralıkla yan yana; üst/alt terminal çiftleri. */
export function customGeometry(def: CustomDef | undefined): SymbolGeo {
  const poles = def?.poles ?? [];
  const w = Math.max(40, 20 * (poles.length + 1));
  return {
    w,
    h: 80,
    terminals: poles.flatMap((p, i) => [top(p.top, 20 + i * 20), bottom(p.bottom, 20 + i * 20, 80)]),
  };
}

type GeoInstance = Pick<ComponentInstance, 'type' | 'custom'>;

const MISSING: SymbolGeo = { w: 40, h: 40, terminals: [] };

export function geometryOf(inst: GeoInstance): SymbolGeo {
  if (inst.type === 'custom') return customGeometry(inst.custom);
  return GEOMETRY[inst.type as BuiltinType] ?? viewOf(inst.type)?.geometry ?? MISSING;
}

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

type Placed = Pick<ComponentInstance, 'type' | 'custom' | 'x' | 'y' | 'rotation'>;

/** Yerel noktayı dünya koordinatına çevirir (bileşen merkezi etrafında döndürme). */
export function toWorld(inst: Placed, p: Point): Point {
  const g = geometryOf(inst);
  const c = { x: g.w / 2, y: g.h / 2 };
  const r = rotate({ x: p.x - c.x, y: p.y - c.y }, inst.rotation);
  return { x: inst.x + c.x + r.x + 0, y: inst.y + c.y + r.y + 0 };
}

export interface WorldTerminal extends TerminalGeo {
  ref: TerminalRef;
}

export function worldTerminals(inst: ComponentInstance): WorldTerminal[] {
  return geometryOf(inst).terminals.map((t) => ({
    ...toWorld(inst, t),
    name: t.name,
    dir: rotateDir(t.dir, inst.rotation),
    free: t.free,
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
export function bounds(inst: Placed): Rect {
  const g = geometryOf(inst);
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

export const rectContains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Katalog ile geometri tutarlılığı: eksik/fazla terminal adlarını döndürür. */
export function geometryMismatches(): string[] {
  const out: string[] = [];
  for (const type of Object.keys(CATALOG) as ComponentType[]) {
    if (type === 'custom') continue;
    const g = GEOMETRY[type as BuiltinType] ?? viewOf(type)?.geometry;
    if (!g) continue;
    const geo = g.terminals.map((t) => t.name).sort();
    const cat = [...terminalsOf({ type })].sort();
    if (geo.join() !== cat.join()) out.push(`${type}: geometri [${geo.join()}] ≠ katalog [${cat.join()}]`);
  }
  for (const type of Object.keys(CATALOG) as ComponentType[]) {
    if (type !== 'custom' && !(type in GEOMETRY) && !viewOf(type)) out.push(`${type}: geometri yok`);
  }
  return out;
}
