// Kodla şema ve ladder programı kurma yardımcıları (örnekler, görevler ve testler için).
//
//   const b = builder();
//   b.add('G1', 'psu24', 40, 20);
//   b.wire('G1:L+', 'A1:L+');
//   const prog = program(net('N1', 'Motor', series(no('%I0.0'), nc('%I0.1')), coil('%Q0.0')));

import type { ComponentType, ParamValue } from './catalog';
import type { Coil, CoilType, CompareOp, LadderNode, LadderProgram, Network } from './ladder';
import type { ComponentInstance, Page, Schematic, Wire } from './schematic';

export function builder(title = 'Yeni proje', pages: Page[] = [{ id: 'p1', title: 'Sayfa 1' }]) {
  const components: ComponentInstance[] = [];
  const wires: Wire[] = [];
  let w = 0;
  const api = {
    add(
      id: string,
      type: ComponentType,
      x = 0,
      y = 0,
      extra: Partial<ComponentInstance> & { params?: Record<string, ParamValue> } = {},
    ) {
      components.push({ id, type, name: id, x, y, rotation: 0, ...extra });
      return api;
    },
    /** "C1:T1" → "C2:T2" kablosu; aynı uçtan birden çok kablo çıkabilir. */
    wire(a: string, b: string, extra: Partial<Wire> = {}) {
      const [ac, at] = a.split(':') as [string, string];
      const [bc, bt] = b.split(':') as [string, string];
      wires.push({ id: `w${++w}`, a: { component: ac, terminal: at }, b: { component: bc, terminal: bt }, ...extra });
      return api;
    },
    /** Zincir: wire(a, b), wire(b, c)... */
    chain(...ends: string[]) {
      for (let i = 1; i < ends.length; i++) api.wire(ends[i - 1]!, ends[i]!);
      return api;
    },
    build(): Schematic {
      return { version: 2, title, pages, components: structuredClone(components), wires: structuredClone(wires) };
    },
  };
  return api;
}

// --- Ladder ----------------------------------------------------------------------------------

let n = 0;
const id = (p: string) => `${p}${++n}`;

export const no = (address: string, label?: string): LadderNode => ({ kind: 'contact', id: id('c'), address, contact: 'NO', label });
export const nc = (address: string, label?: string): LadderNode => ({ kind: 'contact', id: id('c'), address, contact: 'NC', label });
export const pos = (address: string, label?: string): LadderNode => ({ kind: 'contact', id: id('c'), address, contact: 'P', label });
export const neg = (address: string, label?: string): LadderNode => ({ kind: 'contact', id: id('c'), address, contact: 'N', label });
export const cmp = (a: string, op: CompareOp, b: string): LadderNode => ({ kind: 'compare', id: id('k'), op, a, b });
export const series = (...items: LadderNode[]): LadderNode => ({ kind: 'series', id: id('s'), items });
export const parallel = (...branches: LadderNode[]): LadderNode => ({ kind: 'parallel', id: id('p'), branches });

/** Çıkış: bobin (varsayılan) veya tür + ek alanlar. */
export const coil = (address: string, type?: CoilType, extra: Partial<Coil> = {}): Coil => ({
  id: id('o'),
  address,
  ...(type && type !== 'coil' ? { type } : {}),
  ...extra,
});

/** Kutu komutu: box('SCALE', '%MW0', { IN: '%IW0', ... }). */
export const box = (type: CoilType, out: string, args: Record<string, string>): Coil => coil(out, type, { args });

export const net = (nid: string, title: string, logic: LadderNode, out: Coil): Network => ({ id: nid, title, logic, coil: out });

/** Koşulsuz çalışan network için her zaman kapalı kontak (%M15.7 hiç yazılmaz → NC kapalı). */
export const always = () => nc('%M15.7');

export const program = (...networks: Network[]): LadderProgram => ({ networks });
