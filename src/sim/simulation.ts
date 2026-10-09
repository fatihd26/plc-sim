// Simülasyon çekirdeği: sabit 1 ms tick, deterministik faz sırası.
// Devre bir şema dokümanından kurulur; bağlantılar her tick'te NetSolver ile çözülür.
// UI'dan bağımsızdır: dışarıya yalnız komut kuyruğu (giriş) ve snapshot (çıkış) açar.

import { CATALOG, PLC_DI, PLC_DQ, type ComponentType } from './catalog';
import { Contactor, Motor, PushButton, ThermalRelay } from './devices';
import type { LadderProgram, LadderTrace } from './ladder';
import { NetSolver, type NetPotential, type NetResult, type Potential } from './netlist';
import { Plc } from './plc';
import { startStopProgram } from './programs';
import { terminalKey, validateSchematic, type Schematic } from './schematic';

export const TICK_MS = 1;

export type SimCommand =
  | { type: 'button'; component: string; pressed: boolean }
  | { type: 'switch'; component: string; closed: boolean }
  | { type: 'thermalTest'; component: string }
  | { type: 'thermalReset'; component: string };

export interface LoggedCommand {
  tick: number;
  command: SimCommand;
}

export interface SimConfig {
  /** PLC scan periyodu [ms]; tick'in tam katı olmalı. */
  scanTimeMs: number;
  /** Tüm PLC'lere yüklenen program. */
  program: LadderProgram;
}

export const DEFAULT_CONFIG: SimConfig = { scanTimeMs: 10, program: startStopProgram };

export type ComponentState =
  | { type: 'mains3' }
  | { type: 'psu24' }
  | { type: 'buttonNO' | 'buttonNC' | 'estop'; pressed: boolean; contactClosed: boolean }
  | { type: 'contactor'; coilEnergized: boolean; closed: boolean }
  | { type: 'breaker3'; closed: boolean }
  | { type: 'lamp'; lit: boolean }
  | { type: 'terminal' }
  | { type: 'thermal'; tripped: boolean; theta: number; tripTheta: number; setCurrentA: number; currentA: number }
  | {
      type: 'motor3';
      powered: boolean;
      running: boolean;
      speed: number;
      rpm: number;
      currentA: number;
      angleDeg: number;
      direction: 1 | -1;
    }
  | {
      type: 'plc';
      powered: boolean;
      scanTimeMs: number;
      scanCount: number;
      /** DI terminalleri (fiziksel) ve PII. */
      diTerminals: boolean[];
      pii: boolean[];
      /** PIQ ve DQ terminalleri (fiziksel). */
      piq: boolean[];
      dqTerminals: boolean[];
      trace: LadderTrace;
    };

/** UI'ya verilen, salt-okunur ve kopyalanmış durum. */
export interface SimSnapshot {
  tick: number;
  timeMs: number;
  components: Record<string, ComponentState>;
  /** "bileşen:terminal" → net potansiyeli. */
  potentials: Record<string, NetPotential>;
  /** Kısa devre olan netler ("bileşen:terminal" listeleri). */
  shorts: string[][];
}

type Device =
  | { type: 'mains3' }
  | { type: 'psu24' }
  | { type: 'buttonNO' | 'buttonNC' | 'estop'; button: PushButton }
  | { type: 'contactor'; contactor: Contactor }
  | { type: 'breaker3'; closed: boolean }
  | { type: 'lamp'; lit: boolean }
  | { type: 'terminal' }
  | { type: 'thermal'; relay: ThermalRelay; currentA: number }
  | { type: 'motor3'; motor: Motor }
  | { type: 'plc'; plc: Plc; powered: boolean };

interface Entry {
  id: string;
  device: Device;
  /** Terminal adı → global terminal indeksi. */
  t: Record<string, number>;
}

const PHASES: Potential[] = ['L1', 'L2', 'L3'];

function createDevice(type: ComponentType, config: SimConfig): Device {
  switch (type) {
    case 'mains3':
    case 'psu24':
    case 'terminal':
      return { type };
    case 'buttonNO':
      return { type, button: new PushButton('NO') };
    case 'buttonNC':
    case 'estop':
      return { type, button: new PushButton('NC') };
    case 'contactor':
      return { type, contactor: new Contactor() };
    case 'breaker3':
      // Şalter kapalı teslim edilir; kullanıcı elle açabilir.
      return { type, closed: true };
    case 'lamp':
      return { type, lit: false };
    case 'thermal':
      return { type, relay: new ThermalRelay(), currentA: 0 };
    case 'motor3':
      return { type, motor: new Motor() };
    case 'plc':
      return { type, plc: new Plc(config.program), powered: false };
  }
}

export class Simulation {
  readonly config: SimConfig;
  readonly schematic: Schematic;
  private readonly entries: Entry[] = [];
  private readonly byId = new Map<string, Entry>();
  private readonly terminalKeys: string[] = [];
  private readonly wirePairs: [number, number][] = [];
  private readonly solver: NetSolver;

  /** Tamamlanmış tick sayısı (= simülasyon zamanı, ms). */
  tick = 0;
  /** Uygulanan tüm komutlar; tekrar oynatma (replay) için. */
  readonly log: LoggedCommand[] = [];
  private queue: SimCommand[] = [];

  constructor(schematic: Schematic, config: Partial<SimConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!Number.isInteger(this.config.scanTimeMs / TICK_MS) || this.config.scanTimeMs <= 0) {
      throw new Error(`scanTimeMs tick süresinin pozitif tam katı olmalı: ${this.config.scanTimeMs}`);
    }
    const errors = validateSchematic(schematic);
    if (errors.length) throw new Error(`Geçersiz şema:\n${errors.join('\n')}`);
    this.schematic = structuredClone(schematic);

    const index = new Map<string, number>();
    for (const c of this.schematic.components) {
      const t: Record<string, number> = {};
      for (const name of CATALOG[c.type].terminals) {
        const key = terminalKey({ component: c.id, terminal: name });
        t[name] = this.terminalKeys.length;
        index.set(key, this.terminalKeys.length);
        this.terminalKeys.push(key);
      }
      const entry: Entry = { id: c.id, device: createDevice(c.type, this.config), t };
      this.entries.push(entry);
      this.byId.set(c.id, entry);
    }
    for (const w of this.schematic.wires) {
      this.wirePairs.push([index.get(terminalKey(w.a))!, index.get(terminalKey(w.b))!]);
    }
    this.solver = new NetSolver(this.terminalKeys.length);
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

    // 2. Bağlantıları çöz → PLC girişleri, besleme ve scan
    let nets = this.solveNets();
    const scanDue = this.tick % (this.config.scanTimeMs / TICK_MS) === 0;
    for (const e of this.entries) {
      if (e.device.type !== 'plc') continue;
      const d = e.device;
      const powered = nets.potential(e.t['L+']!) === 'P24' && nets.potential(e.t['M']!) === 'M0';
      if (!powered) {
        if (d.powered) d.plc.powerOff();
        d.powered = false;
        continue;
      }
      d.powered = true;
      PLC_DI.forEach((name, i) => (d.plc.diTerminals[i] = nets.potential(e.t[name]!) === 'P24'));
      if (scanDue) d.plc.scan();
    }

    // 3. PLC çıkışları değişmiş olabilir: bobinler ve motorlar güncel netleri görsün
    nets = this.solveNets();

    // 4. Kontaktör bobinleri (24 V DC, iki yönde de çeker)
    for (const e of this.entries) {
      if (e.device.type !== 'contactor') continue;
      const a1 = nets.potential(e.t['A1']!);
      const a2 = nets.potential(e.t['A2']!);
      const energized = (a1 === 'P24' && a2 === 'M0') || (a1 === 'M0' && a2 === 'P24');
      e.device.contactor.update(energized, TICK_MS);
    }

    // 5. Motorlar: üç farklı faz gerekir; faz sırası yönü belirler
    for (const e of this.entries) {
      if (e.device.type !== 'motor3') continue;
      const phases = ['U', 'V', 'W'].map((n) => PHASES.indexOf(nets.potential(e.t[n]!) as Potential));
      const powered = phases.every((p) => p >= 0) && new Set(phases).size === 3;
      const [u, v] = phases as [number, number, number];
      const direction = powered && (v - u + 3) % 3 === 1 ? 1 : -1;
      e.device.motor.update(powered, TICK_MS, powered ? direction : e.device.motor.direction);
    }

    // 6. Termik röleler: ana kutuplarıyla aynı nette olan motorların akımını taşır
    for (const e of this.entries) {
      if (e.device.type !== 'thermal') continue;
      const poleNets = new Set(['2', '4', '6'].map((n) => nets.netOf(e.t[n]!)));
      let current = 0;
      for (const m of this.entries) {
        if (m.device.type !== 'motor3') continue;
        if (['U', 'V', 'W'].some((n) => poleNets.has(nets.netOf(m.t[n]!)))) current += m.device.motor.currentA;
      }
      e.device.currentA = current;
      e.device.relay.update(current, TICK_MS);
    }

    // 7. Sinyal lambaları (24 V DC, iki yönde de yanar)
    for (const e of this.entries) {
      if (e.device.type !== 'lamp') continue;
      const x1 = nets.potential(e.t['X1']!);
      const x2 = nets.potential(e.t['X2']!);
      e.device.lit = (x1 === 'P24' && x2 === 'M0') || (x1 === 'M0' && x2 === 'P24');
    }

    this.tick++;
  }

  run(ms: number): void {
    for (let i = 0; i < ms / TICK_MS; i++) this.step();
  }

  /** Bir sonraki PLC scan'i dahil olmak üzere ilerle (enerjili PLC yoksa bir scan süresi). */
  stepScan(): void {
    const period = this.config.scanTimeMs / TICK_MS;
    do this.step();
    while (this.tick % period !== 1 % period);
  }

  /** Mevcut cihaz durumlarına göre bağlantıları çözer (yan etkisiz). */
  private solveNets(): NetResult {
    const s = this.solver;
    s.reset();
    for (const [a, b] of this.wirePairs) s.connect(a, b);
    for (const e of this.entries) {
      const t = e.t;
      const d = e.device;
      const link = (a: string, b: string) => s.connect(t[a]!, t[b]!);
      switch (d.type) {
        case 'mains3':
          s.addSource(t['L1']!, 'L1');
          s.addSource(t['L2']!, 'L2');
          s.addSource(t['L3']!, 'L3');
          break;
        case 'psu24':
          s.addSource(t['L+']!, 'P24');
          s.addSource(t['M']!, 'M0');
          break;
        case 'buttonNO':
          if (d.button.contactClosed) link('13', '14');
          break;
        case 'buttonNC':
        case 'estop':
          if (d.button.contactClosed) link('11', '12');
          break;
        case 'breaker3':
          if (d.closed) {
            link('1', '2');
            link('3', '4');
            link('5', '6');
          }
          break;
        case 'terminal':
          link('1', '2');
          break;
        case 'lamp':
          break;
        case 'contactor':
          if (d.contactor.closed) {
            link('1', '2');
            link('3', '4');
            link('5', '6');
            link('13', '14');
          } else {
            link('21', '22');
          }
          break;
        case 'thermal':
          link('1', '2');
          link('3', '4');
          link('5', '6');
          if (d.relay.tripped) link('97', '98');
          else link('95', '96');
          break;
        case 'motor3':
          break;
        case 'plc':
          if (d.powered) {
            PLC_DQ.forEach((name, i) => {
              if (d.plc.dqTerminals[i]) s.addSource(t[name]!, 'P24');
            });
          }
          break;
      }
    }
    return s.solve();
  }

  private apply(command: SimCommand): void {
    const d = this.byId.get(command.component)?.device;
    if (!d) return;
    switch (command.type) {
      case 'button':
        if (d.type === 'buttonNO' || d.type === 'buttonNC' || d.type === 'estop') d.button.pressed = command.pressed;
        break;
      case 'switch':
        if (d.type === 'breaker3') d.closed = command.closed;
        break;
      case 'thermalTest':
        if (d.type === 'thermal') d.relay.test();
        break;
      case 'thermalReset':
        if (d.type === 'thermal') d.relay.reset();
        break;
    }
  }

  private componentState(d: Device): ComponentState {
    switch (d.type) {
      case 'mains3':
      case 'psu24':
      case 'terminal':
        return { type: d.type };
      case 'buttonNO':
      case 'buttonNC':
      case 'estop':
        return { type: d.type, pressed: d.button.pressed, contactClosed: d.button.contactClosed };
      case 'breaker3':
        return { type: d.type, closed: d.closed };
      case 'lamp':
        return { type: d.type, lit: d.lit };
      case 'contactor':
        return { type: d.type, coilEnergized: d.contactor.coilEnergized, closed: d.contactor.closed };
      case 'thermal':
        return {
          type: d.type,
          tripped: d.relay.tripped,
          theta: d.relay.theta,
          tripTheta: ThermalRelay.TRIP_THETA,
          setCurrentA: d.relay.params.setCurrentA,
          currentA: d.currentA,
        };
      case 'motor3': {
        const m = d.motor;
        return {
          type: d.type,
          powered: m.powered,
          running: m.running,
          speed: m.speed,
          rpm: m.rpm,
          currentA: m.currentA,
          angleDeg: m.angleDeg,
          direction: m.direction,
        };
      }
      case 'plc': {
        const p = d.plc;
        return {
          type: d.type,
          powered: d.powered,
          scanTimeMs: this.config.scanTimeMs,
          scanCount: p.scanCount,
          diTerminals: p.diTerminals.slice(0, PLC_DI.length),
          pii: p.imageCopy('I').slice(0, PLC_DI.length),
          piq: p.imageCopy('Q').slice(0, PLC_DQ.length),
          dqTerminals: p.dqTerminals.slice(0, PLC_DQ.length),
          trace: structuredClone(p.lastTrace),
        };
      }
    }
  }

  snapshot(): SimSnapshot {
    const nets = this.solveNets();
    const potentials: Record<string, NetPotential> = {};
    this.terminalKeys.forEach((key, i) => (potentials[key] = nets.potential(i)));
    const components: Record<string, ComponentState> = {};
    for (const e of this.entries) components[e.id] = this.componentState(e.device);
    return {
      tick: this.tick,
      timeMs: this.tick * TICK_MS,
      components,
      potentials,
      shorts: nets.shorts.map((net) => net.map((i) => this.terminalKeys[i]!)),
    };
  }
}

/** Kayıtlı komutları aynı tick'lerde yeniden uygulayarak simülasyonu yeniden üretir. */
export function replay(
  schematic: Schematic,
  log: readonly LoggedCommand[],
  totalTicks: number,
  config?: Partial<SimConfig>,
): Simulation {
  const sim = new Simulation(schematic, config);
  let i = 0;
  while (sim.tick < totalTicks) {
    while (i < log.length && log[i]!.tick === sim.tick) sim.enqueue(log[i++]!.command);
    sim.step();
  }
  return sim;
}
