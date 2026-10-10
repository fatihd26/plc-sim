// Sembol tablosu: PLC adreslerini şemadaki gerçek elemanlara eşler.
// %I/%Q terminalinden kablolar boyunca (klemens, bağlantı noktası ve sayfa geçişleri üzerinden)
// ilerlenir; ulaşılan ilk "gerçek" elemanın adı adresin etiketi olur. Böylece ladder'daki
// etiketler eleman adı veya kablolama değişince kendiliğinden güncellenir.

import { PLC_DI, PLC_DQ } from './catalog';
import { terminalKey, type ComponentInstance, type Schematic, type TerminalRef } from './schematic';

/** Kabloyu olduğu gibi geçiren elemanlar. */
const PASSIVE = new Set<ComponentInstance['type']>(['terminal', 'junction', 'xref']);
/** Besleme elemanları etiket olarak anlamlı değildir (ortak hat). */
const SUPPLY = new Set<ComponentInstance['type']>(['psu24', 'mains3']);

/** "%I0.0" → ["S1:14"] biçiminde, adres başına bağlı eleman uçları. */
export type SymbolTable = Record<string, string[]>;

export function buildSymbolTable(schematic: Schematic, plcId: string): SymbolTable {
  const byId = new Map(schematic.components.map((c) => [c.id, c]));
  const adj = new Map<string, TerminalRef[]>();
  const link = (a: TerminalRef, b: TerminalRef) => {
    const ka = terminalKey(a);
    adj.set(ka, [...(adj.get(ka) ?? []), b]);
  };
  for (const w of schematic.wires) {
    link(w.a, w.b);
    link(w.b, w.a);
  }
  // Klemensin iki ucu ve aynı adlı sayfa geçişleri birbirine bağlıdır.
  const xrefs = new Map<string, TerminalRef[]>();
  for (const c of schematic.components) {
    if (c.type === 'terminal') {
      link({ component: c.id, terminal: '1' }, { component: c.id, terminal: '2' });
      link({ component: c.id, terminal: '2' }, { component: c.id, terminal: '1' });
    }
    if (c.type === 'xref') xrefs.set(c.name, [...(xrefs.get(c.name) ?? []), { component: c.id, terminal: '1' }]);
  }
  for (const list of xrefs.values()) for (const a of list) for (const b of list) if (a !== b) link(a, b);

  const reach = (start: TerminalRef): string[] => {
    const seen = new Set([terminalKey(start)]);
    const queue = [start];
    const found: string[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(terminalKey(cur)) ?? []) {
        const key = terminalKey(next);
        if (seen.has(key)) continue;
        seen.add(key);
        const c = byId.get(next.component);
        if (!c || c.id === plcId) continue;
        if (PASSIVE.has(c.type)) queue.push(next);
        else if (!SUPPLY.has(c.type)) found.push(`${c.name}:${next.terminal}`);
      }
    }
    return found.sort();
  };

  const table: SymbolTable = {};
  for (const t of [...PLC_DI, ...PLC_DQ]) {
    const found = reach({ component: plcId, terminal: t });
    if (found.length) table[`%${t}`] = found;
  }
  return table;
}

/** Adresin kısa etiketi: bağlı elemanların adları ("S1", "K1, P1"). */
export function symbolName(table: SymbolTable, address: string): string {
  const key = address.trim().toUpperCase().replace(/^%?/, '%');
  const ends = table[key];
  if (!ends) return '';
  return [...new Set(ends.map((e) => e.split(':')[0]!))].join(', ');
}
