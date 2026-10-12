// Şema dokümanı: sayfalar, bileşen örnekleri, terminaller arası kablolar ve kullanıcı kütüphanesi.
// Konum/döndürme/sayfa/büküm noktaları çizim içindir; çekirdek yalnızca tip, kimlik, parametre
// ve bağlantıları kullanır.

import { validatePoll, type ModbusPoll } from './modbusMaster';
import { controllerIo } from './ioConfig';
import {
  CATALOG,
  COMPONENT_TYPES,
  terminalsOf,
  validateCustomDef,
  type ComponentType,
  type CustomDef,
  type ParamValue,
} from './catalog';
import { compileProgram, type LadderProgram } from './ladder';

export type Rotation = 0 | 90 | 180 | 270;

export interface Point {
  x: number;
  y: number;
}

export interface ComponentInstance {
  id: string;
  type: ComponentType;
  name: string;
  x: number;
  y: number;
  rotation: Rotation;
  /** Bulunduğu sayfa; yoksa ilk sayfa. */
  page?: string;
  /** Kataloğun tanımladığı parametreler; eksik olanlar varsayılan değeri alır. */
  params?: Record<string, ParamValue>;
  /** Yalnız PLC/ESP32: yüklü ladder programı (PLC'de yoksa start-stop örnek programı). */
  program?: LadderProgram;
  /** Yalnız PLC: Modbus RTU master tarama tablosu. */
  modbusPolls?: ModbusPoll[];
  /** Yalnız `custom`: bileşenin tanımı (kütüphanedeki tanımın kopyası). */
  custom?: CustomDef;
}

export interface TerminalRef {
  component: string;
  terminal: string;
}

export interface Wire {
  id: string;
  a: TerminalRef;
  b: TerminalRef;
  /** Elle şekillendirilmiş güzergâhın ara noktaları; yoksa otomatik yönlendirilir. */
  points?: Point[];
}

export interface Page {
  id: string;
  title: string;
}

export interface Schematic {
  version: 2;
  /** Proje adı (antette görünür). */
  title?: string;
  /** Sayfa listesi; boş/yoksa tek sayfa. */
  pages?: Page[];
  /** Kullanıcı tanımlı bileşen tipleri. */
  library?: CustomDef[];
  components: ComponentInstance[];
  wires: Wire[];
}

export const SCHEMATIC_VERSION = 2;

export const DEFAULT_PAGE: Page = { id: 'p1', title: 'Sayfa 1' };

export const emptySchematic = (): Schematic => ({
  version: 2,
  title: 'Yeni proje',
  pages: [{ ...DEFAULT_PAGE }],
  components: [],
  wires: [],
});

export const pagesOf = (s: Schematic): Page[] => (s.pages?.length ? s.pages : [DEFAULT_PAGE]);

export const pageOf = (s: Schematic, c: ComponentInstance): string => {
  const pages = pagesOf(s);
  return c.page && pages.some((p) => p.id === c.page) ? c.page : pages[0]!.id;
};

export const terminalKey = (ref: TerminalRef): string => `${ref.component}:${ref.terminal}`;

export const sameTerminal = (a: TerminalRef, b: TerminalRef): boolean =>
  a.component === b.component && a.terminal === b.terminal;

/** Eski sürüm dosyaları güncel biçime getirir (v1: sayfa/parametre/program yok). */
export function migrateSchematic(data: unknown): Schematic {
  const s = data as { version?: unknown };
  if (s && typeof s === 'object' && s.version === 1) return { ...(s as object), version: 2 } as Schematic;
  return data as Schematic;
}

/** Yapısal hataları döndürür; boş dizi = geçerli. */
export function validateSchematic(s: Schematic): string[] {
  const errors: string[] = [];
  if (s.version !== SCHEMATIC_VERSION) errors.push(`Desteklenmeyen şema sürümü: ${String(s.version)}`);
  const pageIds = new Set<string>();
  for (const p of s.pages ?? []) {
    if (pageIds.has(p.id)) errors.push(`Tekrarlanan sayfa kimliği: ${p.id}`);
    pageIds.add(p.id);
  }
  for (const def of s.library ?? []) {
    for (const e of validateCustomDef(def)) errors.push(`Kütüphane "${def.title}": ${e}`);
  }
  const byId = new Map<string, ComponentInstance>();
  for (const c of s.components) {
    if (byId.has(c.id)) errors.push(`Tekrarlanan bileşen kimliği: ${c.id}`);
    byId.set(c.id, c);
    if (!COMPONENT_TYPES.includes(c.type)) {
      errors.push(`Bilinmeyen bileşen tipi: ${String(c.type)}`);
      continue;
    }
    if (c.type === 'custom') {
      if (!c.custom) errors.push(`${c.name}: kullanıcı bileşeninin tanımı yok`);
      else for (const e of validateCustomDef(c.custom)) errors.push(`${c.name}: ${e}`);
    }
    for (const key of Object.keys(c.params ?? {})) {
      if (!CATALOG[c.type].params.some((p) => p.key === key)) errors.push(`${c.name}: bilinmeyen parametre "${key}"`);
    }
    for (const e of controllerIo(c).errors) errors.push(`${c.name} G/Ç: ${e}`);
    if (c.modbusPolls) {
      if (c.type !== 'plc') errors.push(`${c.name}: Modbus tablosu yalnız PLC'de olabilir`);
      const ids = new Set<string>();
      for (const p of c.modbusPolls) {
        if (ids.has(p.id)) errors.push(`${c.name} Modbus: tekrarlanan satır kimliği "${p.id}"`);
        ids.add(p.id);
        const err = validatePoll(p);
        if (err) errors.push(`${c.name} Modbus satırı ${p.id}: ${err}`);
      }
    }
    if (c.program) {
      try {
        compileProgram(c.program);
      } catch (e) {
        errors.push(`${c.name} programı: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const wireIds = new Set<string>();
  for (const w of s.wires) {
    if (wireIds.has(w.id)) errors.push(`Tekrarlanan kablo kimliği: ${w.id}`);
    wireIds.add(w.id);
    for (const end of [w.a, w.b]) {
      const c = byId.get(end.component);
      if (!c) errors.push(`Kablo ${w.id}: bileşen yok (${end.component})`);
      else if (COMPONENT_TYPES.includes(c.type) && !terminalsOf(c).includes(end.terminal)) {
        errors.push(`Kablo ${w.id}: ${c.name} üzerinde "${end.terminal}" terminali yok`);
      }
    }
    if (sameTerminal(w.a, w.b)) errors.push(`Kablo ${w.id}: iki ucu aynı terminalde`);
    if (w.points && !w.points.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) {
      errors.push(`Kablo ${w.id}: geçersiz büküm noktası`);
    }
  }
  return errors;
}
