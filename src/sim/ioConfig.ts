// Kontrolör G/Ç yapılandırması: fiziksel terminal ↔ process image adresi eşlemesi.
//
// PLC: sabit eşleme (I0.0 terminali = %I0.0, Q0.0 terminali = %Q0.0).
// ESP32: her GPIO pininin yönü (mode_<pin>) ve adres biti (addr_<pin>: 'auto' veya '0'..'7')
// parametrelerden gelir. Giriş pini %I0.<bit>, çıkış pini %Q0.<bit> olur. 'auto' pinler,
// elle verilmiş bitlerden sonra pin sırasıyla boştaki en küçük biti alır.

import { ESP32_PINS, PLC_DI, PLC_DQ, strParam, type ComponentType, type ParamValue } from './catalog';
import type { LadderNode, LadderProgram } from './ladder';
import type { ComponentInstance } from './schematic';

type Instance = Pick<ComponentInstance, 'type' | 'params'>;

/** Bir kontrolörün tek fiziksel G/Ç noktası. */
export interface IoPoint {
  /** Process image adresi ("%I0.0"). */
  address: string;
  /** Process image bit indeksi (byte × 8 + bit). */
  bit: number;
  /** Bileşen terminali ("I0.0", "GPIO16"). */
  terminal: string;
  /** Adres otomatik atandı. */
  auto: boolean;
}

export interface ControllerIo {
  inputs: IoPoint[];
  outputs: IoPoint[];
  /** Yapılandırma hataları (çakışan adres). */
  errors: string[];
}

/** ESP32 pin başına seçilebilecek adres bitleri (%I0.0..0.7 / %Q0.0..0.7). */
export const ESP32_ADDR_BITS = 8;

export const isController = (type: ComponentType) => type === 'plc' || type === 'esp32';

export function controllerIo(inst: Instance): ControllerIo {
  if (inst.type !== 'esp32') {
    const fixed = (names: readonly string[]) => names.map((t, i) => ({ address: `%${t}`, bit: i, terminal: t, auto: false }));
    return { inputs: fixed(PLC_DI), outputs: fixed(PLC_DQ), errors: [] };
  }
  const pins = ESP32_PINS.map((terminal) => ({
    terminal,
    mode: strParam(inst, `mode_${terminal}`) as 'in' | 'out',
    addr: strParam(inst, `addr_${terminal}`),
  }));
  const errors: string[] = [];
  const side = (mode: 'in' | 'out'): IoPoint[] => {
    const area = mode === 'in' ? 'I' : 'Q';
    const mine = pins.filter((p) => p.mode === mode);
    const used = new Map<number, string>();
    const out = new Map<string, IoPoint>();
    for (const p of mine) {
      if (p.addr === 'auto') continue;
      const bit = Number(p.addr);
      const other = used.get(bit);
      if (other) errors.push(`%${area}0.${bit} hem ${other} hem ${p.terminal} pinine atanmış`);
      used.set(bit, p.terminal);
      out.set(p.terminal, { address: `%${area}0.${bit}`, bit, terminal: p.terminal, auto: false });
    }
    for (const p of mine) {
      if (p.addr !== 'auto') continue;
      let bit = 0;
      while (used.has(bit)) bit++;
      used.set(bit, p.terminal);
      out.set(p.terminal, { address: `%${area}0.${bit}`, bit, terminal: p.terminal, auto: true });
    }
    return mine.map((p) => out.get(p.terminal)!);
  };
  return { inputs: side('in'), outputs: side('out'), errors };
}

/** Adresin kontrolördeki fiziksel karşılığı. */
export function ioPointOf(io: ControllerIo, address: string): { point: IoPoint; dir: 'in' | 'out' } | null {
  const key = address.trim().toUpperCase().replace(/^%?/, '%');
  const inp = io.inputs.find((p) => p.address === key);
  if (inp) return { point: inp, dir: 'in' };
  const out = io.outputs.find((p) => p.address === key);
  return out ? { point: out, dir: 'out' } : null;
}

// --- Programdan otomatik yapılandırma --------------------------------------------------------

/** Programın kullandığı %I ve %Q bitleri (kontak, çıkış ve kutu girişleri). */
export function usedIo(program: LadderProgram): { inputs: number[]; outputs: number[] } {
  const inputs = new Set<number>();
  const outputs = new Set<number>();
  const note = (address: string | undefined) => {
    const m = address && /^%?([IQ])(\d+)\.([0-7])$/i.exec(address.trim());
    if (!m) return;
    const bit = Number(m[2]) * 8 + Number(m[3]);
    (m[1]!.toUpperCase() === 'I' ? inputs : outputs).add(bit);
  };
  const visit = (n: LadderNode) => {
    if (n.kind === 'contact') note(n.address);
    if (n.kind === 'series') n.items.forEach(visit);
    if (n.kind === 'parallel') n.branches.forEach(visit);
  };
  for (const net of program.networks) {
    visit(net.logic);
    for (const a of [net.coil.address, net.coil.reset, net.coil.load, net.coil.down]) note(a);
  }
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { inputs: sorted(inputs), outputs: sorted(outputs) };
}

/**
 * ESP32 pinlerini programa göre yapılandırır ve mevcut eşlemeyi (dolayısıyla kablolamayı) olabildiğince
 * korur:
 *   1. Şu anki adresi programda kullanılan pin olduğu gibi kalır.
 *   2. Kalan adresler aynı yöndeki boştaki pinlere pin sırasıyla verilir.
 *   3. Yetmezse kullanılmayan pinlerin yönü çevrilir (`changes` bunu bildirir: kablolama
 *      kontrol edilmeli).
 * Programda kullanılmayan pinler değişmez. Pin sayısı yetmezse veya adres ESP32'de yoksa hata.
 */
export function autoConfigureEsp32(
  program: LadderProgram,
  current: Instance = { type: 'esp32' },
): { params: Record<string, ParamValue>; changes: string[] } | { error: string } {
  const { inputs, outputs } = usedIo(program);
  const name = (area: string) => (b: number) => `%${area}${b >> 3}.${b & 7}`;
  const tooHigh = [
    ...inputs.filter((b) => b >= ESP32_ADDR_BITS).map(name('I')),
    ...outputs.filter((b) => b >= ESP32_ADDR_BITS).map(name('Q')),
  ];
  if (tooHigh.length) {
    return { error: `ESP32'de yalnız %I0.0..0.7 / %Q0.0..0.7 eşlenebilir; programda ${tooHigh.join(', ')} var` };
  }
  if (inputs.length + outputs.length > ESP32_PINS.length) {
    return {
      error: `Program ${inputs.length} giriş + ${outputs.length} çıkış kullanıyor; ESP32 kartında ${ESP32_PINS.length} GPIO var`,
    };
  }

  const io = controllerIo(current);
  const now = new Map<string, { mode: 'in' | 'out'; bit: number; auto: boolean }>();
  for (const p of io.inputs) now.set(p.terminal, { mode: 'in', bit: p.bit, auto: p.auto });
  for (const p of io.outputs) now.set(p.terminal, { mode: 'out', bit: p.bit, auto: p.auto });

  const assigned = new Map<string, { mode: 'in' | 'out'; bit: number }>();
  const need = { in: [...inputs], out: [...outputs] };
  const free = (pin: string) => !assigned.has(pin);
  const take = (mode: 'in' | 'out', pick: (bit: number) => string | undefined) => {
    need[mode] = need[mode].filter((bit) => {
      const pin = pick(bit);
      if (!pin) return true;
      assigned.set(pin, { mode, bit });
      return false;
    });
  };
  for (const mode of ['in', 'out'] as const) {
    // 1. Adresi zaten doğru olan pin
    take(mode, (bit) => ESP32_PINS.find((p) => free(p) && now.get(p)!.mode === mode && now.get(p)!.bit === bit));
  }
  for (const mode of ['in', 'out'] as const) {
    // 2. Aynı yönde, adresi programda kullanılmayan pin
    const usedBits = new Set(mode === 'in' ? inputs : outputs);
    take(mode, () => ESP32_PINS.find((p) => free(p) && now.get(p)!.mode === mode && !usedBits.has(now.get(p)!.bit)));
  }
  const changes: string[] = [];
  for (const mode of ['in', 'out'] as const) {
    // 3. Yönü çevrilen pin. Buraya kalan her boş pin karşı yöndedir ve o yönün ihtiyacı adım
    //    2'de karşılanmıştır; çevirmek güvenlidir.
    take(mode, () => {
      const pin = ESP32_PINS.find(free);
      if (pin) changes.push(`${pin} ${mode === 'in' ? 'çıkıştan girişe' : 'girişten çıkışa'} çevrildi; kablolamasını kontrol edin`);
      return pin;
    });
  }

  const params: Record<string, ParamValue> = {};
  const taken = (mode: 'in' | 'out', bit: number) => [...assigned.values()].some((a) => a.mode === mode && a.bit === bit);
  for (const pin of ESP32_PINS) {
    const a = assigned.get(pin);
    const cur = now.get(pin)!;
    params[`mode_${pin}`] = a?.mode ?? cur.mode;
    // Programda kullanılmayan pin: elle verilmiş adresi yeni atamayla çakışırsa otomatiğe döner.
    params[`addr_${pin}`] = a ? String(a.bit) : cur.auto || taken(cur.mode, cur.bit) ? 'auto' : String(cur.bit);
  }
  return { params, changes };
}
