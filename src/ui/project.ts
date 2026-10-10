// Proje dosyası: JSON içe/dışa aktarma ve tarayıcıda otomatik kayıt.

import { startStopSchematic } from '../sim/examples';
import { migrateSchematic, validateSchematic, type Schematic } from '../sim/schematic';

const STORAGE_KEY = 'plc-sim:schematic';
export const FILE_EXTENSION = '.plcsim.json';

/** JSON metnini şemaya çevirir (eski sürümler güncellenir); geçersizse açıklamalı hata fırlatır. */
export function parseSchematic(text: string): Schematic {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Dosya geçerli JSON değil.');
  }
  const s = migrateSchematic(data);
  if (!s || typeof s !== 'object' || !Array.isArray(s.components) || !Array.isArray(s.wires)) {
    throw new Error('Dosya bir PLC-SIM şeması değil.');
  }
  const errors = validateSchematic(s);
  if (errors.length) throw new Error(errors.join('\n'));
  return s;
}

export const serializeSchematic = (s: Schematic) => JSON.stringify(s, null, 2);

/** Son kaydedilen şema; yoksa veya okunamazsa start-stop örneği. */
export function loadAutosave(): Schematic {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) return parseSchematic(text);
  } catch {
    // Depolama kapalı veya kayıt bozuk: örnekle başla.
  }
  return startStopSchematic();
}

export function saveAutosave(s: Schematic): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Depolama kapalıysa sessizce geç.
  }
}

/** Dosya adı için proje adını sadeleştirir. */
const fileName = (title: string | undefined) =>
  (title ?? '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-') || 'proje';

export function downloadSchematic(s: Schematic, name = fileName(s.title)): void {
  const blob = new Blob([serializeSchematic(s)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}${FILE_EXTENSION}`;
  a.click();
  URL.revokeObjectURL(url);
}
