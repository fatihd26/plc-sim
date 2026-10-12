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

/** Karşılaştırma operandı: tamsayı sabit, zamanlayıcı geçen süresi (ms) veya sayıcı değeri. */
export type ValueOperand = { area: 'K'; value: number } | FuncAddress;

export function parseValue(text: string): ValueOperand {
  const t = text.trim();
  if (/^[+-]?\d+$/.test(t)) return { area: 'K', value: Number(t) };
  const func = parseFunc(t);
  if (func) return func;
  throw new Error(`Geçersiz değer: "${text}" (tamsayı, T0 = geçen süre ms, C0 = sayıcı değeri)`);
}

export function formatValue(op: ValueOperand): string {
  return op.area === 'K' ? String(op.value) : `${op.area}${op.index}`;
}
