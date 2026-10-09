// Şema dokümanı: bileşen örnekleri + terminaller arası kablolar.
// Konum/döndürme çizim içindir; çekirdek yalnızca tip, kimlik ve bağlantıları kullanır.

import { CATALOG, COMPONENT_TYPES, type ComponentType } from './catalog';

export type Rotation = 0 | 90 | 180 | 270;

export interface ComponentInstance {
  id: string;
  type: ComponentType;
  name: string;
  x: number;
  y: number;
  rotation: Rotation;
}

export interface TerminalRef {
  component: string;
  terminal: string;
}

export interface Wire {
  id: string;
  a: TerminalRef;
  b: TerminalRef;
}

export interface Schematic {
  version: 1;
  components: ComponentInstance[];
  wires: Wire[];
}

export const emptySchematic = (): Schematic => ({ version: 1, components: [], wires: [] });

export const terminalKey = (ref: TerminalRef): string => `${ref.component}:${ref.terminal}`;

export const sameTerminal = (a: TerminalRef, b: TerminalRef): boolean =>
  a.component === b.component && a.terminal === b.terminal;

/** Yapısal hataları döndürür; boş dizi = geçerli. */
export function validateSchematic(s: Schematic): string[] {
  const errors: string[] = [];
  if (s.version !== 1) errors.push(`Desteklenmeyen şema sürümü: ${String(s.version)}`);
  const byId = new Map<string, ComponentInstance>();
  for (const c of s.components) {
    if (byId.has(c.id)) errors.push(`Tekrarlanan bileşen kimliği: ${c.id}`);
    if (!COMPONENT_TYPES.includes(c.type)) errors.push(`Bilinmeyen bileşen tipi: ${String(c.type)}`);
    byId.set(c.id, c);
  }
  const wireIds = new Set<string>();
  for (const w of s.wires) {
    if (wireIds.has(w.id)) errors.push(`Tekrarlanan kablo kimliği: ${w.id}`);
    wireIds.add(w.id);
    for (const end of [w.a, w.b]) {
      const c = byId.get(end.component);
      if (!c) errors.push(`Kablo ${w.id}: bileşen yok (${end.component})`);
      else if (!CATALOG[c.type]?.terminals.includes(end.terminal)) {
        errors.push(`Kablo ${w.id}: ${c.name} üzerinde "${end.terminal}" terminali yok`);
      }
    }
    if (sameTerminal(w.a, w.b)) errors.push(`Kablo ${w.id}: iki ucu aynı terminalde`);
  }
  return errors;
}
