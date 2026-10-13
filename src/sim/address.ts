// Siemens benzeri bit adresleme: %I0.0, %Q0.0, %M0.0
// Yalnızca tanıdıklık için; TIA Portal uyumluluğu hedeflenmez.

export type Area = 'I' | 'Q' | 'M';

export interface BitAddress {
  area: Area;
  byte: number;
  bit: number;
}

/** Her bellek alanının bayt cinsinden boyutu. */
export const AREA_BYTES: Record<Area, number> = { I: 2, Q: 2, M: 16 };

const ADDRESS_RE = /^%?([IQM])(\d+)\.([0-7])$/;

export function parseAddress(text: string): BitAddress {
  const match = ADDRESS_RE.exec(text.trim().toUpperCase());
  if (!match) {
    throw new Error(`Geçersiz adres: "${text}" (beklenen biçim: %I0.0)`);
  }
  const area = match[1] as Area;
  const byte = Number(match[2]);
  const bit = Number(match[3]);
  if (byte >= AREA_BYTES[area]) {
    throw new Error(`Adres alan dışında: "${text}" (${area} alanı ${AREA_BYTES[area]} bayt)`);
  }
  return { area, byte, bit };
}

export function formatAddress(addr: BitAddress): string {
  return `%${addr.area}${addr.byte}.${addr.bit}`;
}

/** Alan içindeki düz bit indeksi. */
export function bitIndex(addr: BitAddress): number {
  return addr.byte * 8 + addr.bit;
}

// --- Zamanlayıcı ve sayıcı operandları ---------------------------------------------------------
// T0..T15 zamanlayıcı, C0..C15 sayıcı. Kontakta bit (Q çıkışı), karşılaştırmada değer (ET ms / CV)
// olarak okunur.

export type FuncArea = 'T' | 'C';

export interface FuncAddress {
  area: FuncArea;
  index: number;
}

/** Zamanlayıcı ve sayıcı sayısı (her biri). */
export const FUNC_COUNT = 16;

/** Kontakların okuyabildiği her şey: %I/%Q/%M biti veya T/C çıkışı. */
export type BitOperand = BitAddress | FuncAddress;

const FUNC_RE = /^%?([TC])(\d+)$/;

export const isFunc = (op: BitOperand): op is FuncAddress => op.area === 'T' || op.area === 'C';

export function parseFunc(text: string): FuncAddress | null {
  const match = FUNC_RE.exec(text.trim().toUpperCase());
  if (!match) return null;
  const index = Number(match[2]);
  if (index >= FUNC_COUNT) throw new Error(`Adres alan dışında: "${text}" (T/C 0..${FUNC_COUNT - 1})`);
  return { area: match[1] as FuncArea, index };
}

/** %I0.0, %Q0.0, %M0.0, T0 veya C0. */
export function parseOperand(text: string): BitOperand {
  const func = parseFunc(text);
  if (func) return func;
  try {
    return parseAddress(text);
  } catch (e) {
    if (e instanceof Error && /alan dışında/.test(e.message)) throw e;
    throw new Error(`Geçersiz adres: "${text}" (beklenen: %I0.0, %Q0.0, %M0.0, T0, C0)`);
  }
}

export function formatOperand(op: BitOperand): string {
  return isFunc(op) ? `${op.area}${op.index}` : formatAddress(op);
}

// --- Kelime belleği ve analog G/Ç ----------------------------------------------------------
// %MW0..%MW63: 16 bit işaretsiz kelimeler. %M bit alanından ayrıdır (Siemens'teki MB/MW çakışması
// modellenmez). Modbus'ta %MWn = holding register n.
// %IW0..%IW1: analog girişler, %QW0..%QW1: analog çıkışlar. Siemens gibi 0..27648 = 0..10 V
// (4–20 mA girişte 4..20 mA). Kablo kopuk 4–20 mA girişte 32767 okunur.

export type WordArea = 'MW' | 'IW' | 'QW';

export interface WordAddress {
  area: WordArea;
  index: number;
}

export const MW_COUNT = 64;
export const AI_COUNT = 2;
export const AQ_COUNT = 2;
export const WORD_COUNT: Record<WordArea, number> = { MW: MW_COUNT, IW: AI_COUNT, QW: AQ_COUNT };

/** Analog ölçek: 10 V / 20 mA tam skala ham değeri (Siemens S7-1200 ile aynı). */
export const ANALOG_FULL = 27648;
/** 4–20 mA girişte kablo kopuk / alt taşma değeri. */
export const ANALOG_OVERFLOW = 32767;

const WORD_RE = /^%?(MW|IW|QW)(\d+)$/;

export function parseWord(text: string): WordAddress | null {
  const match = WORD_RE.exec(text.trim().toUpperCase());
  if (!match) return null;
  const area = match[1] as WordArea;
  const index = Number(match[2]);
  if (index >= WORD_COUNT[area]) {
    throw new Error(`Adres alan dışında: "${text}" (%${area}0..%${area}${WORD_COUNT[area] - 1})`);
  }
  return { area, index };
}

export const formatWord = (w: WordAddress) => `%${w.area}${w.index}`;

// --- Hızlı sayıcılar (HSC) -------------------------------------------------------------------
// HC0, HC1: donanım sayıcısının değeri (işaretli). PLC parametresinden etkinleştirilir; reset
// bobini (R) ile sıfırlanır.

export interface HcAddress {
  area: 'HC';
  index: number;
}

export const HSC_COUNT = 2;

const HC_RE = /^%?HC(\d+)$/;

export function parseHc(text: string): HcAddress | null {
  const match = HC_RE.exec(text.trim().toUpperCase());
  if (!match) return null;
  const index = Number(match[1]);
  if (index >= HSC_COUNT) throw new Error(`Adres alan dışında: "${text}" (HC0..HC${HSC_COUNT - 1})`);
  return { area: 'HC', index };
}

/**
 * Değer operandı: sabit (ondalık olabilir), zamanlayıcı geçen süresi (ms), sayıcı değeri,
 * %MW/%IW/%QW kelimesi veya hızlı sayıcı değeri.
 */
export type ValueOperand = { area: 'K'; value: number } | FuncAddress | WordAddress | HcAddress;

export function parseValue(text: string): ValueOperand {
  const t = text.trim();
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return { area: 'K', value: Number(t) };
  const func = parseFunc(t);
  if (func) return func;
  const word = parseWord(t);
  if (word) return word;
  const hc = parseHc(t);
  if (hc) return hc;
  throw new Error(
    `Geçersiz değer: "${text}" (sayı, T0 = geçen süre ms, C0 = sayıcı değeri, %MW0 / %IW0 / %QW0 = kelime, HC0 = hızlı sayıcı)`,
  );
}

/** Yazılabilir kelime: %MW veya %QW. */
export function parseDest(text: string): WordAddress {
  const w = parseWord(text);
  if (!w || w.area === 'IW') throw new Error(`Çıkış adresi %MW0..%MW${MW_COUNT - 1} veya %QW0..%QW${AQ_COUNT - 1} olmalı`);
  return w;
}

export function formatValue(op: ValueOperand): string {
  if (op.area === 'K') return String(op.value);
  if (op.area === 'MW' || op.area === 'IW' || op.area === 'QW') return formatWord(op);
  return `${op.area}${op.index}`;
}
