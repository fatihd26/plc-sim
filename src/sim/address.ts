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
