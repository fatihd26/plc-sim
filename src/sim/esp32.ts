// ESP32 I/O kartı: 24 V beslemeli, optokuplörlü 24 V girişler, transistörlü 24 V çıkışlar,
// 0–10 V ADC girişi ve RS485 Modbus RTU slave. ESP32'nin kendisi 3,3 V'tur; seviye çevirme kart
// üzerindedir. Firmware saf bir fonksiyondur ve PLC scan'i gibi `loopMs` periyoduyla çalışır.
//
// Modbus haritası (slave):
//   discrete input n  ← GPIO girişleri (ESP32_GPIO sırasıyla)
//   coil n            → GPIO çıkışları
//   input register 0  ← ADC1 ham değeri (0..4095, 0..10 V)
//   input register 1  ← ADC1 [mV]
//   holding register  : uygulamaya serbest (firmware okumaz)
//
// Ladder firmware'inde kart bir PLC gibi çalışır (scan periyodu = loopMs):
//   pin ↔ adres eşlemesi ioConfig.controllerIo'dan (varsayılan otomatik: girişler %I0.0'dan,
//   çıkışlar %Q0.0'dan pin sırasıyla), ADC → %MW0 (ham 0..4095) ve %MW1 (mV).
//   Modbus: coil ↔ %Q, discrete input ↔ %I, holding register ↔ %MW, IR0/IR1 = ADC.

import type { LadderProgram } from './ladder';
import { createModbusModel, type ModbusDataModel } from './modbus';
import { Plc } from './plc';

export const ESP32_GPIO = ['GPIO16', 'GPIO17', 'GPIO18', 'GPIO19'] as const;
export type Esp32Pin = (typeof ESP32_GPIO)[number];
export type PinMode = 'in' | 'out';
export type Esp32Firmware = 'ladder' | 'modbusSlave' | 'local';

export interface Esp32Params {
  slaveId: number;
  baud: number;
  loopMs: number;
  modes: Record<Esp32Pin, PinMode>;
  /** Pinin process image biti: giriş %I0.<bit>, çıkış %Q0.<bit> (ioConfig.controllerIo). */
  bits: Record<Esp32Pin, number>;
  firmware: Esp32Firmware;
}

/** Simülasyonun her tick'te karta verdiği fiziksel durum. */
export interface Esp32Inputs {
  powered: boolean;
  /** Giriş pinlerinde 24 V var mı (çıkış pinleri için yok sayılır). */
  pins: Record<Esp32Pin, boolean>;
  /** ADC1 gerilimi [mV], 0..10 000. */
  adcMv: number;
}

export const ADC_MAX_MV = 10_000;
export const ADC_MAX_RAW = 4095;

type PinMap = Record<Esp32Pin, boolean>;
const pinMap = (v = false) => Object.fromEntries(ESP32_GPIO.map((p) => [p, v])) as PinMap;

/** Firmware: girişleri ve Modbus belleğini okuyup çıkışları ve register'ları yazar. */
export type FirmwareFn = (
  io: {
    pins: Readonly<PinMap>;
    modes: Readonly<Record<Esp32Pin, PinMode>>;
    bits: Readonly<Record<Esp32Pin, number>>;
    adcRaw: number;
    adcMv: number;
  },
  regs: ModbusDataModel,
  out: PinMap,
) => void;

const publishInputs: FirmwareFn = (io, regs) => {
  for (const pin of ESP32_GPIO) if (io.modes[pin] === 'in') regs.discreteInputs[io.bits[pin]] = io.pins[pin];
  regs.inputRegisters[0] = io.adcRaw;
  regs.inputRegisters[1] = io.adcMv;
};

export const FIRMWARE: Record<Exclude<Esp32Firmware, 'ladder'>, FirmwareFn> = {
  /** Modbus slave G/Ç kartı: coil <bit> → çıkış pini, giriş pini → discrete input <bit>. */
  modbusSlave: (io, regs, out) => {
    publishInputs(io, regs, out);
    for (const pin of ESP32_GPIO) out[pin] = regs.coils[io.bits[pin]] ?? false;
  },
  /**
   * Yerel mantık (master gerekmez): her çıkış pini, kendisinden önceki ilk giriş pinini izler;
   * varsayılan yönlerle GPIO16 → GPIO18, GPIO17 → GPIO19. Girişler Modbus'a da yayınlanır.
   */
  local: (io, regs, out) => {
    publishInputs(io, regs, out);
    const inputs = ESP32_GPIO.filter((p) => io.modes[p] === 'in');
    const outputs = ESP32_GPIO.filter((p) => io.modes[p] === 'out');
    outputs.forEach((pin, i) => {
      const src = inputs[i];
      out[pin] = src ? io.pins[src] : false;
    });
  },
};

export class Esp32 {
  private readonly ownRegs: ModbusDataModel = createModbusModel({ coils: 16, discreteInputs: 16, holding: 32, input: 8 });
  /** Ladder firmware'inde programı çalıştıran PLC çekirdeği; diğer firmware'lerde null. */
  readonly plc: Plc | null;
  /** Çıkış pinlerinin durumu (giriş pinlerinde her zaman false). */
  readonly outputs: PinMap = pinMap();
  inputs: Esp32Inputs = { powered: false, pins: pinMap(), adcMv: 0 };
  /** Firmware döngü sayısı (açılıştan beri). */
  loopCount = 0;
  private elapsedMs = 0;

  constructor(
    readonly params: Esp32Params,
    program: LadderProgram = { networks: [] },
  ) {
    this.plc = params.firmware === 'ladder' ? new Plc(program) : null;
  }

  /** Modbus slave belleği. Ladder firmware'inde PLC process image'ının kendisidir. */
  get regs(): ModbusDataModel {
    return this.plc ? { ...this.plc.modbusModel(), inputRegisters: this.ownRegs.inputRegisters } : this.ownRegs;
  }

  get adcRaw(): number {
    const mv = Math.max(0, Math.min(ADC_MAX_MV, this.inputs.adcMv));
    return Math.round((mv * ADC_MAX_RAW) / ADC_MAX_MV);
  }

  update(inputs: Esp32Inputs, dtMs: number): void {
    const wasPowered = this.inputs.powered;
    this.inputs = inputs;
    if (!inputs.powered) {
      if (wasPowered) this.powerOff();
      return;
    }
    if (!wasPowered) this.elapsedMs = this.params.loopMs; // açılışta hemen bir döngü
    this.elapsedMs += dtMs;
    if (this.elapsedMs < this.params.loopMs) return;
    this.elapsedMs = 0;
    const adcMv = Math.round(Math.max(0, Math.min(ADC_MAX_MV, inputs.adcMv)));
    const modes = this.params.modes;
    if (this.plc) {
      const plc = this.plc;
      const bits = this.params.bits;
      for (const p of ESP32_GPIO) if (modes[p] === 'in') plc.diTerminals[bits[p]] = inputs.pins[p];
      this.ownRegs.inputRegisters[0] = this.adcRaw;
      this.ownRegs.inputRegisters[1] = adcMv;
      plc.setWord(0, this.adcRaw);
      plc.setWord(1, adcMv);
      plc.scan(this.params.loopMs);
      for (const p of ESP32_GPIO) this.outputs[p] = modes[p] === 'out' && plc.dqTerminals[bits[p]]!;
    } else {
      const next = { ...this.outputs };
      FIRMWARE[this.params.firmware as Exclude<Esp32Firmware, 'ladder'>]({ pins: inputs.pins, modes, bits: this.params.bits, adcRaw: this.adcRaw, adcMv }, this.ownRegs, next);
      for (const p of ESP32_GPIO) this.outputs[p] = modes[p] === 'out' && next[p];
    }
    this.loopCount++;
  }

  /** Besleme kesildi: çıkışlar düşer, RAM (Modbus belleği) silinir. */
  private powerOff(): void {
    for (const p of ESP32_GPIO) this.outputs[p] = false;
    this.plc?.powerOff();
    this.ownRegs.coils.fill(false);
    this.ownRegs.discreteInputs.fill(false);
    this.ownRegs.holdingRegisters.fill(0);
    this.ownRegs.inputRegisters.fill(0);
    this.elapsedMs = 0;
    this.loopCount = 0;
  }
}

/**
 * RS485 bus'ları kablolamadan bulur: A uçları aynı nette ve B uçları aynı nette olan cihazlar
 * aynı bus'tadır. Bir cihazın A ucu başka bir cihazın B ucuyla aynı netteyse (A/B ters bağlı)
 * `swapped` döner; bu cihazlar haberleşemez.
 */
export function rs485Groups<T extends { id: string; a: number; b: number }>(
  devices: readonly T[],
): { groups: T[][]; swapped: Set<string> } {
  const byKey = new Map<string, T[]>();
  for (const d of devices) {
    if (d.a === d.b) continue; // A ve B köprülenmiş: bus yok
    const key = `${d.a}:${d.b}`;
    byKey.set(key, [...(byKey.get(key) ?? []), d]);
  }
  const swapped = new Set<string>();
  const aNets = new Map<number, T[]>();
  for (const d of devices) aNets.set(d.a, [...(aNets.get(d.a) ?? []), d]);
  for (const d of devices) {
    for (const other of aNets.get(d.b) ?? []) {
      if (other.id !== d.id) {
        swapped.add(d.id);
        swapped.add(other.id);
      }
    }
  }
  return { groups: [...byKey.values()], swapped };
}
