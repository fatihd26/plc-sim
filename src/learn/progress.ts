// Öğrenci ilerlemesi: biten dersler ve geçilen görevler, deneme sayıları, kalınan yer.
// Ana kayıt öğrencinin indirdiği dosyadır (.plcsim-ilerleme.json); localStorage yalnız sayfa
// yenilenince kaldığı yerden devam etmek içindir (idea.md › İlerleme kaydı).

import type { Schematic } from '../sim/schematic';
import { LEVELS, playable, type Item, type Level } from './curriculum';

export const PROGRESS_EXTENSION = '.plcsim-ilerleme.json';
const FORMAT = 'plcsim-ilerleme';
const STORAGE_KEY = 'plcsim.learn.v1';

export interface Progress {
  /** Öğe kimliği → tamamlanma zamanı (ISO). */
  done: Record<string, string>;
  /** Görev kimliği → "Kontrol et" sayısı. */
  attempts: Record<string, number>;
  /** Açık ders veya görev ve dersin adımı. */
  current?: { item: string; step: number };
}

export const emptyProgress = (): Progress => ({ done: {}, attempts: {} });

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Gizli pencere veya dolu depolama: ilerleme yalnız dosyaya kaydedilebilir.
  }
}

function normalize(v: unknown): Progress {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Progress>;
  const strings = (r: unknown) =>
    Object.fromEntries(Object.entries(r && typeof r === 'object' ? r : {}).filter(([, x]) => typeof x === 'string')) as Record<string, string>;
  const numbers = (r: unknown) =>
    Object.fromEntries(Object.entries(r && typeof r === 'object' ? r : {}).filter(([, x]) => typeof x === 'number')) as Record<string, number>;
  const cur = o.current;
  return {
    done: strings(o.done),
    attempts: numbers(o.attempts),
    current: cur && typeof cur.item === 'string' && typeof cur.step === 'number' ? { item: cur.item, step: cur.step } : undefined,
  };
}

export interface ProgressFile {
  format: typeof FORMAT;
  version: 1;
  savedAt: string;
  progress: Progress;
  /** Öğrencinin kaydettiği andaki şeması. */
  schematic?: Schematic;
}

export const serializeProgress = (progress: Progress, schematic?: Schematic): string =>
  JSON.stringify({ format: FORMAT, version: 1, savedAt: new Date().toISOString(), progress, schematic } satisfies ProgressFile, null, 2);

export function parseProgress(text: string): { progress: Progress; schematic?: Schematic } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error('dosya JSON değil');
  }
  const f = v as Partial<ProgressFile>;
  if (f?.format !== FORMAT) throw new Error('bu bir PLC-SIM ilerleme dosyası değil');
  if (f.version !== 1) throw new Error(`desteklenmeyen sürüm: ${String(f.version)}`);
  return { progress: normalize(f.progress), schematic: f.schematic };
}

// --- Yol durumu ------------------------------------------------------------------------------

export const isDone = (p: Progress, id: string) => id in p.done;

const exitOf = (l: Level): Item | undefined => l.items.find((i) => 'exit' in i && i.exit);

/**
 * Seviye açık mı: ilki hep açık; diğeri, öncekinin çıkış senaryosu geçilince açılır. Çıkış
 * senaryosu henüz yazılmamışsa (soon) seviye engellemez.
 */
export function levelUnlocked(p: Progress, index: number): boolean {
  for (let i = 0; i < index; i++) {
    const exit = exitOf(LEVELS[i]!);
    if (exit && exit.kind !== 'soon' && !isDone(p, exit.id)) return false;
  }
  return true;
}

/** Açık seviyelerde sıradaki tamamlanmamış öğe. */
export function nextItem(p: Progress, after?: string): Item | null {
  const items = playable();
  const start = after ? items.findIndex((i) => i.id === after) + 1 : 0;
  const open = (i: Item) => levelUnlocked(p, LEVELS.findIndex((l) => l.items.includes(i)));
  return (
    items.slice(start).find((i) => !isDone(p, i.id) && open(i)) ??
    items.find((i) => !isDone(p, i.id) && open(i)) ??
    null
  );
}

export function counts(p: Progress, level?: Level) {
  const items = (level ? level.items : LEVELS.flatMap((l) => l.items)).filter((i) => i.kind !== 'soon');
  return { done: items.filter((i) => isDone(p, i.id)).length, total: items.length };
}
