// Simülasyon çekirdeği: sabit 1 ms tick, deterministik faz sırası.
// UI'dan bağımsızdır: dışarıya yalnız komut kuyruğu (giriş) ve snapshot (çıkış) açar.

import { Contactor, Motor, PushButton, ThermalRelay } from './devices';
import type { LadderProgram, LadderTrace } from './ladder';
import { Plc } from './plc';
import { startStopProgram } from './programs';

export const TICK_MS = 1;

export type ButtonId = 'S1' | 'S2';

export type SimCommand =
  | { type: 'button'; id: ButtonId; pressed: boolean }
  | { type: 'thermalTest' }
  | { type: 'thermalReset' };

export interface LoggedCommand {
  tick: number;
  command: SimCommand;
}

export interface SimConfig {
  /** PLC scan periyodu [ms]; tick'in tam katı olmalı. */
  scanTimeMs: number;
  program: LadderProgram;
}

export const DEFAULT_CONFIG: SimConfig = { scanTimeMs: 10, program: startStopProgram };

/** Kablolama: saha cihazı ↔ PLC terminali. Sabittir (şema editörü yok). */
export const IO_MAP = {
  inputs: [
    { channel: 0, address: '%I0.0', label: 'S1 Start (NO)' },
    { channel: 1, address: '%I0.1', label: 'S2 Stop (NC)' },
    { channel: 2, address: '%I0.2', label: 'F2 Termik 95-96 (NC)' },
  ],
  outputs: [{ channel: 0, address: '%Q0.0', label: 'K1 Bobin' }],
} as const;

export interface IoPoint {
  address: string;
  label: string;
  terminal: boolean;
  image: boolean;
}

/** UI'ya verilen, salt-okunur ve kopyalanmış durum. */
export interface SimSnapshot {
  tick: number;
  timeMs: number;
  plc: {
    scanTimeMs: number;
    scanCount: number;
    inputs: IoPoint[];
    outputs: IoPoint[];
    trace: LadderTrace;
  };
  S1: { pressed: boolean; contactClosed: boolean };
  S2: { pressed: boolean; contactClosed: boolean };
  K1: { coilEnergized: boolean; closed: boolean };
  F2: { tripped: boolean; theta: number; tripTheta: number; setCurrentA: number };
  M1: { powered: boolean; running: boolean; speed: number; rpm: number; currentA: number; angleDeg: number };
}

export class Simulation {
  readonly config: SimConfig;
  readonly S1 = new PushButton('NO');
  readonly S2 = new PushButton('NC');
  readonly K1 = new Contactor();
  readonly F2 = new ThermalRelay();
  readonly M1 = new Motor();
  readonly plc: Plc;

  /** Tamamlanmış tick sayısı (= simülasyon zamanı, ms). */
  tick = 0;
  /** Uygulanan tüm komutlar; tekrar oynatma (replay) için. */
  readonly log: LoggedCommand[] = [];
  private queue: SimCommand[] = [];

  constructor(config: Partial<SimConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!Number.isInteger(this.config.scanTimeMs / TICK_MS) || this.config.scanTimeMs <= 0) {
      throw new Error(`scanTimeMs tick süresinin pozitif tam katı olmalı: ${this.config.scanTimeMs}`);
    }
    this.plc = new Plc(this.config.program);
  }

  /** Komut bir sonraki tick'in başında uygulanır. */
  enqueue(command: SimCommand): void {
    this.queue.push(command);
  }

  /** Tek tick (1 ms) ilerlet. */
  step(): void {
    // 1. Kuyruktaki komutları sırayla uygula
    for (const command of this.queue) {
      this.apply(command);
      this.log.push({ tick: this.tick, command });
    }
    this.queue = [];

    // 2. Kablolama: saha kontakları → PLC giriş terminalleri
    const di = this.plc.diTerminals;
    di[0] = this.S1.contactClosed;
    di[1] = this.S2.contactClosed;
    di[2] = this.F2.ncClosed;

    // 3. PLC scan (vadesi geldiyse): PII oku → program → PIQ yaz
    if (this.tick % (this.config.scanTimeMs / TICK_MS) === 0) this.plc.scan();

    // 4. Kontaktör bobini PLC çıkış terminalinden beslenir
    this.K1.update(this.plc.dqTerminals[0]!, TICK_MS);

    // 5. Motor, kontaktör ana kontaklarından beslenir
    this.M1.update(this.K1.closed, TICK_MS);

    // 6. Termik röle motor akımıyla ısınır (açma bir sonraki tick'te PLC girişine yansır)
    this.F2.update(this.M1.currentA, TICK_MS);

    this.tick++;
  }

  run(ms: number): void {
    for (let i = 0; i < ms / TICK_MS; i++) this.step();
  }

  /** Bir sonraki PLC scan'i dahil olmak üzere ilerle. */
  stepScan(): void {
    const target = this.plc.scanCount + 1;
    while (this.plc.scanCount < target) this.step();
  }

  private apply(command: SimCommand): void {
    switch (command.type) {
      case 'button':
        this[command.id].pressed = command.pressed;
        break;
      case 'thermalTest':
        this.F2.test();
        break;
      case 'thermalReset':
        this.F2.reset();
        break;
    }
  }

  snapshot(): SimSnapshot {
    const pii = this.plc.imageCopy('I');
    const piq = this.plc.imageCopy('Q');
    return {
      tick: this.tick,
      timeMs: this.tick * TICK_MS,
      plc: {
        scanTimeMs: this.config.scanTimeMs,
        scanCount: this.plc.scanCount,
        inputs: IO_MAP.inputs.map((p) => ({
          address: p.address,
          label: p.label,
          terminal: this.plc.diTerminals[p.channel]!,
          image: pii[p.channel]!,
        })),
        outputs: IO_MAP.outputs.map((p) => ({
          address: p.address,
          label: p.label,
          terminal: this.plc.dqTerminals[p.channel]!,
          image: piq[p.channel]!,
        })),
        trace: structuredClone(this.plc.lastTrace),
      },
      S1: { pressed: this.S1.pressed, contactClosed: this.S1.contactClosed },
      S2: { pressed: this.S2.pressed, contactClosed: this.S2.contactClosed },
      K1: { coilEnergized: this.K1.coilEnergized, closed: this.K1.closed },
      F2: {
        tripped: this.F2.tripped,
        theta: this.F2.theta,
        tripTheta: ThermalRelay.TRIP_THETA,
        setCurrentA: this.F2.params.setCurrentA,
      },
      M1: {
        powered: this.M1.powered,
        running: this.M1.running,
        speed: this.M1.speed,
        rpm: this.M1.rpm,
        currentA: this.M1.currentA,
        angleDeg: this.M1.angleDeg,
      },
    };
  }
}

/** Kayıtlı komutları aynı tick'lerde yeniden uygulayarak simülasyonu yeniden üretir. */
export function replay(log: readonly LoggedCommand[], totalTicks: number, config?: Partial<SimConfig>): Simulation {
  const sim = new Simulation(config);
  let i = 0;
  while (sim.tick < totalTicks) {
    while (i < log.length && log[i]!.tick === sim.tick) sim.enqueue(log[i++]!.command);
    sim.step();
  }
  return sim;
}
