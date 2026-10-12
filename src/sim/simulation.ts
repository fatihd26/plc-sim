// Simülasyon çekirdeği: sabit 1 ms tick, deterministik faz sırası.
// Devre bir şema dokümanından kurulur; bağlantılar her tick'te NetSolver ile çözülür.
// UI'dan bağımsızdır: dışarıya yalnız komut kuyruğu (giriş) ve snapshot (çıkış) açar.

import {
  numParam,
  PLC_DI,
  PLC_DQ,
  strParam,
  terminalsOf,
  type CustomDef,
  type Voltage,
} from './catalog';
import { Esp32, ESP32_GPIO, rs485Groups, type Esp32Firmware, type Esp32Pin, type PinMode } from './esp32';
import { handleRequest, type ModbusRequest } from './modbus';
import { Contactor, Conveyor, Cylinder, Motor, PushButton, Tank, ThermalRelay } from './devices';
import type { LadderProgram, LadderTrace } from './ladder';
import { NetSolver, type NetPotential, type NetResult, type Potential } from './netlist';
import { controllerIo } from './ioConfig';
import { Plc } from './plc';
import { startStopProgram } from './programs';
import { terminalKey, validateSchematic, type ComponentInstance, type Schematic } from './schematic';

export const TICK_MS = 1;

/** Olay günlüğünde tutulan en fazla kayıt. */
const MAX_EVENTS = 20;

export type SimCommand =
  | { type: 'button'; component: string; pressed: boolean }
  | { type: 'switch'; component: string; closed: boolean }
  | { type: 'thermalTest'; component: string }
  | { type: 'thermalReset'; component: string }
  /** Konveyörün başına kutu koy. */
  | { type: 'addBox'; component: string }
  /** ESP32 ADC1 girişine verilen gerilim [mV]. */
  | { type: 'analog'; component: string; mv: number }
  /** Test master'ı: ESP32'nin Modbus belleğine doğrudan istek (bus'sız, anında). */
  | { type: 'modbusWrite'; component: string; request: ModbusRequest };

export interface LoggedCommand {
  tick: number;
  command: SimCommand;
}

/** Şemadaki değerleri geçersiz kılan ayarlar (testler ve deneyler için). */
export interface SimConfig {
  /** Tüm PLC'lerin scan periyodu [ms]; tick'in tam katı olmalı. Yoksa PLC parametresi. */
  scanTimeMs?: number;
  /** Tüm PLC'lere yüklenen program. Yoksa her PLC kendi programını çalıştırır. */
  program?: LadderProgram;
}

/** Yükün (bobin/lamba) gördüğü besleme. */
export type Supply = 'DC24' | 'AC230' | 'AC400' | null;

export interface SimEvent {
  tick: number;
  component: string;
  text: string;
}

export type ComponentState =
  | { type: 'mains3' | 'terminal' | 'junction' | 'xref' }
  | { type: 'psu24'; limited: boolean }
  | { type: 'buttonNO' | 'buttonNC' | 'estop'; pressed: boolean; contactClosed: boolean }
  | { type: 'contactor' | 'relay'; coilEnergized: boolean; closed: boolean; fault: string | null }
  | {
      type: 'breaker3';
      closed: boolean;
      tripped: boolean;
      theta: number;
      tripTheta: number;
      setCurrentA: number;
      currentA: number;
    }
  | { type: 'fuse'; closed: boolean; tripped: boolean }
  | { type: 'lamp'; lit: boolean; fault: string | null }
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
  | ({ type: 'plc' } & PlcRuntimeState)
  | {
      type: 'esp32';
      powered: boolean;
      firmware: Esp32Firmware;
      slaveId: number;
      loopCount: number;
      /** Pin başına yön ve durum (giriş: 24 V var mı, çıkış: sürülüyor mu). */
      pins: { pin: Esp32Pin; bit: number; mode: PinMode; on: boolean }[];
      adcMv: number;
      adcRaw: number;
      /** Modbus belleğinin ilk öğeleri (izleme için). */
      coils: boolean[];
      discreteInputs: boolean[];
      inputRegisters: number[];
      holdingRegisters: number[];
      /** Aynı RS485 bus'taki diğer cihazların adları. */
      busPeers: string[];
      /** RS485 kablolama hatası (A/B ters, köprü). */
      rs485Fault: string | null;
      /** Ladder firmware'inde programın çalışma durumu; diğer firmware'lerde null. */
      ladder: PlcRuntimeState | null;
    }
  | {
      type: 'cylinder';
      valve: boolean;
      /** 0 = tam geride, 1 = tam ileride. */
      position: number;
      retracted: boolean;
      extended: boolean;
      fault: string | null;
    }
  | {
      type: 'conveyor';
      powered: boolean;
      speed: number;
      rpm: number;
      currentA: number;
      direction: 1 | -1;
      /** Kutuların sol kenar konumları (bant uzunluğuna oranla) ve kutu boyu. */
      boxes: number[];
      boxLength: number;
      sensorAt: number;
      beltPos: number;
      sensor: boolean;
      delivered: number;
    }
  | { type: 'fan'; powered: boolean; speed: number; rpm: number; angleDeg: number; fault: string | null }
  | {
      type: 'pump';
      powered: boolean;
      speed: number;
      rpm: number;
      currentA: number;
      angleDeg: number;
      /** Depo seviyesi 0..1 ve sensör eşikleri. */
      level: number;
      lowAt: number;
      highAt: number;
      low: boolean;
      high: boolean;
      overflowing: boolean;
    }
  | {
      type: 'custom';
      pressed: boolean;
      coilEnergized: boolean;
      /** Bobinle çalışan kontakların durumu (çekili mi). */
      actuated: boolean;
      /** Kutup başına: kontak iletimde mi / bobin-lamba enerjili mi. */
      poles: boolean[];
      fault: string | null;
    };

/** UI'ya verilen, salt-okunur ve kopyalanmış durum. */
/** Ladder çalıştıran bir kontrolörün (PLC, ESP32) izleme verisi. */
export interface PlcRuntimeState {
  powered: boolean;
  scanTimeMs: number;
  scanCount: number;
  /** DI terminalleri (fiziksel) ve PII; process image bit sırasıyla. */
  diTerminals: boolean[];
  pii: boolean[];
  /** PIQ ve DQ terminalleri (fiziksel). */
  piq: boolean[];
  dqTerminals: boolean[];
  trace: LadderTrace;
  /** Zamanlayıcılar (geçen süre ms) ve sayıcılar (değer), T0.. / C0.. sırasıyla. */
  timers: { et: number; q: boolean }[];
  counters: { cv: number; q: boolean }[];
  /** %MW0.. kelime belleği. */
  words: number[];
}

function plcRuntimeState(p: Plc, powered: boolean, scanTimeMs: number, n: number): PlcRuntimeState {
  return {
    powered,
    scanTimeMs,
    scanCount: p.scanCount,
    diTerminals: p.diTerminals.slice(0, n),
    pii: p.imageCopy('I').slice(0, n),
    piq: p.imageCopy('Q').slice(0, n),
    dqTerminals: p.dqTerminals.slice(0, n),
    trace: structuredClone(p.lastTrace),
    timers: p.timers(),
    counters: p.counters(),
    words: p.wordsCopy(),
  };
}

export interface SimSnapshot {
  tick: number;
  timeMs: number;
  components: Record<string, ComponentState>;
  /** "bileşen:terminal" → net potansiyeli. */
  potentials: Record<string, NetPotential>;
  /** Kısa devre olan netler ("bileşen:terminal" listeleri). */
  shorts: string[][];
  /** Koruma açmaları gibi olaylar (en yenisi sonda). */
  events: SimEvent[];
}

type Device =
  | { type: 'mains3' | 'terminal' | 'junction' | 'xref' }
  | { type: 'psu24'; limited: boolean }
  | { type: 'buttonNO' | 'buttonNC' | 'estop'; button: PushButton }
  | { type: 'contactor' | 'relay'; contactor: Contactor; voltage: Voltage; fault: string | null }
  | { type: 'breaker3'; closed: boolean; tripped: boolean; relay: ThermalRelay; currentA: number }
  | { type: 'fuse'; closed: boolean; tripped: boolean }
  | { type: 'lamp'; lit: boolean; voltage: Voltage; fault: string | null }
  | { type: 'thermal'; relay: ThermalRelay; currentA: number }
  | { type: 'motor3'; motor: Motor }
  | { type: 'plc'; plc: Plc; powered: boolean; scanTimeMs: number }
  | { type: 'esp32'; esp: Esp32; adcMv: number }
  | { type: 'cylinder'; cylinder: Cylinder; voltage: Voltage; fault: string | null }
  | { type: 'conveyor'; motor: Motor; conveyor: Conveyor }
  | { type: 'fan'; motor: Motor; voltage: Voltage; fault: string | null }
  | { type: 'pump'; motor: Motor; tank: Tank }
  | {
      type: 'custom';
      def: CustomDef;
      pressed: boolean;
      relay: Contactor;
      poles: boolean[];
      fault: string | null;
    };

interface Entry {
  id: string;
  name: string;
  device: Device;
  /** Terminal adı → global terminal indeksi. */
  t: Record<string, number>;
}

const PHASES: Potential[] = ['L1', 'L2', 'L3'];
const isPhase = (p: NetPotential) => p === 'L1' || p === 'L2' || p === 'L3';

/** Yük doğrudan PLC çıkışına bağlandığında verilen arıza. */
export const PLC_DIRECT_FAULT = 'PLC/ESP32 çıkışından doğrudan beslenemez, araya röle koyun';

/** İki uç arasındaki beslemenin türü (mantıksal; akım hesaplanmaz). */
export function supplyBetween(a: NetPotential, b: NetPotential): Supply {
  if ((a === 'P24' && b === 'M0') || (a === 'M0' && b === 'P24')) return 'DC24';
  if ((isPhase(a) && b === 'N') || (a === 'N' && isPhase(b))) return 'AC230';
  if (isPhase(a) && isPhase(b) && a !== b) return 'AC400';
  return null;
}

/** Anma gerilimi verilen yük: çeker/yanar mı, aşırı gerilim var mı. */
export function loadResponse(rating: Voltage, supply: Supply): { on: boolean; fault: string | null } {
  if (rating === '24DC') {
    return { on: supply === 'DC24', fault: supply === 'AC230' || supply === 'AC400' ? 'Aşırı gerilim (AC)' : null };
  }
  return { on: supply === 'AC230', fault: supply === 'AC400' ? 'Aşırı gerilim (400 V)' : null };
}

/** U-V-W terminalli 3~ motoru olan cihazın motoru (termik akım ve faz sırası için). */
function threePhaseMotor(d: Device): Motor | null {
  return d.type === 'motor3' || d.type === 'conveyor' || d.type === 'pump' ? d.motor : null;
}

/** Mekanik elemanın tahrik motoru (katalogdaki driveParams). */
function driveMotor(c: ComponentInstance): Motor {
  return new Motor({
    ratedCurrentA: numParam(c, 'ratedCurrentA'),
    ratedRpm: numParam(c, 'ratedRpm'),
    startTauMs: numParam(c, 'startTauMs'),
    coastTauMs: numParam(c, 'coastTauMs'),
    lockedRotorRatio: numParam(c, 'lockedRotorRatio'),
    loadPct: 100,
  });
}

function createDevice(c: ComponentInstance, config: SimConfig): Device {
  switch (c.type) {
    case 'mains3':
    case 'terminal':
    case 'junction':
    case 'xref':
      return { type: c.type };
    case 'psu24':
      return { type: c.type, limited: false };
    case 'buttonNO':
      return { type: c.type, button: new PushButton('NO') };
    case 'buttonNC':
    case 'estop':
      return { type: c.type, button: new PushButton('NC') };
    case 'contactor':
    case 'relay':
      return {
        type: c.type,
        contactor: new Contactor({ pickupMs: numParam(c, 'pickupMs'), dropoutMs: numParam(c, 'dropoutMs') }),
        voltage: strParam(c, 'coilVoltage') as Voltage,
        fault: null,
      };
    case 'breaker3':
      // Şalter kapalı teslim edilir; kullanıcı elle açabilir, koruma kendiliğinden açar.
      return {
        type: c.type,
        closed: true,
        tripped: false,
        relay: new ThermalRelay({ setCurrentA: numParam(c, 'setCurrentA'), tauMs: numParam(c, 'tauS') * 1000 }),
        currentA: 0,
      };
    case 'fuse':
      return { type: c.type, closed: true, tripped: false };
    case 'lamp':
      return { type: c.type, lit: false, voltage: strParam(c, 'voltage') as Voltage, fault: null };
    case 'thermal':
      return {
        type: c.type,
        relay: new ThermalRelay({ setCurrentA: numParam(c, 'setCurrentA'), tauMs: numParam(c, 'tauS') * 1000 }),
        currentA: 0,
      };
    case 'motor3':
      return {
        type: c.type,
        motor: new Motor({
          ratedCurrentA: numParam(c, 'ratedCurrentA'),
          ratedRpm: numParam(c, 'ratedRpm'),
          startTauMs: numParam(c, 'startTauMs'),
          coastTauMs: numParam(c, 'coastTauMs'),
          lockedRotorRatio: numParam(c, 'lockedRotorRatio'),
          loadPct: numParam(c, 'loadPct'),
        }),
      };
    case 'plc':
      return {
        type: c.type,
        plc: new Plc(config.program ?? c.program ?? startStopProgram),
        powered: false,
        scanTimeMs: config.scanTimeMs ?? Math.round(numParam(c, 'scanTimeMs')),
      };
    case 'esp32': {
      const modes = Object.fromEntries(ESP32_GPIO.map((p) => [p, strParam(c, `mode_${p}`) as PinMode])) as Record<
        Esp32Pin,
        PinMode
      >;
      const io = controllerIo(c);
      const bits = Object.fromEntries([...io.inputs, ...io.outputs].map((p) => [p.terminal, p.bit])) as Record<
        Esp32Pin,
        number
      >;
      return {
        type: c.type,
        esp: new Esp32(
          {
            bits,
            slaveId: numParam(c, 'slaveId'),
            baud: Number(strParam(c, 'baud')),
            loopMs: Math.max(1, Math.round(numParam(c, 'loopMs'))),
            modes,
            firmware: strParam(c, 'firmware') as Esp32Firmware,
          },
          c.program,
        ),
        adcMv: 0,
      };
    }
    case 'cylinder':
      return {
        type: c.type,
        cylinder: new Cylinder({ extendMs: numParam(c, 'extendMs'), retractMs: numParam(c, 'retractMs') }),
        voltage: strParam(c, 'coilVoltage') as Voltage,
        fault: null,
      };
    case 'conveyor':
      return {
        type: c.type,
        motor: driveMotor(c),
        conveyor: new Conveyor({ transitMs: numParam(c, 'transitS') * 1000, feedMs: numParam(c, 'feedS') * 1000 }),
      };
    case 'fan':
      return {
        type: c.type,
        motor: new Motor({
          ratedCurrentA: 0.3,
          ratedRpm: numParam(c, 'ratedRpm'),
          startTauMs: numParam(c, 'startTauMs'),
          coastTauMs: numParam(c, 'coastTauMs'),
          lockedRotorRatio: 2,
          loadPct: 100,
        }),
        voltage: strParam(c, 'voltage') as Voltage,
        fault: null,
      };
    case 'pump':
      return {
        type: c.type,
        motor: driveMotor(c),
        tank: new Tank({
          fillMs: numParam(c, 'fillS') * 1000,
          drainMs: numParam(c, 'drainS') * 1000,
          initialLevel: numParam(c, 'initialPct') / 100,
        }),
      };
    case 'custom': {
      const def = c.custom!;
      return { type: c.type, def, pressed: false, relay: new Contactor(), poles: def.poles.map(() => false), fault: null };
    }
  }
}

/** Kısa devrede açarak arızayı ayırabilen elemanlar. */
type Protective = Extract<Device, { type: 'breaker3' | 'fuse' | 'psu24' }>;

export class Simulation {
  readonly config: SimConfig;
  readonly schematic: Schematic;
  private readonly entries: Entry[] = [];
  private readonly byId = new Map<string, Entry>();
  private readonly terminalKeys: string[] = [];
  private readonly wirePairs: [number, number][] = [];
  private readonly solver: NetSolver;
  private readonly events: SimEvent[] = [];

  /** Tamamlanmış tick sayısı (= simülasyon zamanı, ms). */
  tick = 0;
  /** Uygulanan tüm komutlar; tekrar oynatma (replay) için. */
  readonly log: LoggedCommand[] = [];
  private queue: SimCommand[] = [];

  constructor(schematic: Schematic, config: SimConfig = {}) {
    this.config = { ...config };
    const scan = this.config.scanTimeMs;
    if (scan !== undefined && (!Number.isInteger(scan / TICK_MS) || scan <= 0)) {
      throw new Error(`scanTimeMs tick süresinin pozitif tam katı olmalı: ${scan}`);
    }
    const errors = validateSchematic(schematic);
    if (errors.length) throw new Error(`Geçersiz şema:\n${errors.join('\n')}`);
    this.schematic = structuredClone(schematic);

    const index = new Map<string, number>();
    const xrefs = new Map<string, number[]>();
    for (const c of this.schematic.components) {
      const t: Record<string, number> = {};
      for (const name of terminalsOf(c)) {
        const key = terminalKey({ component: c.id, terminal: name });
        t[name] = this.terminalKeys.length;
        index.set(key, this.terminalKeys.length);
        this.terminalKeys.push(key);
      }
      const entry: Entry = { id: c.id, name: c.name, device: createDevice(c, this.config), t };
      this.entries.push(entry);
      this.byId.set(c.id, entry);
      if (c.type === 'xref') {
        const list = xrefs.get(c.name) ?? [];
        list.push(t['1']!);
        xrefs.set(c.name, list);
      }
    }
    for (const w of this.schematic.wires) {
      this.wirePairs.push([index.get(terminalKey(w.a))!, index.get(terminalKey(w.b))!]);
    }
    // Aynı etiketli sayfa geçişleri görünmez bir kabloyla bağlıdır.
    for (const list of xrefs.values()) {
      for (let i = 1; i < list.length; i++) this.wirePairs.push([list[0]!, list[i]!]);
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

    // 2. Bağlantıları çöz (kısa devre varsa koruma açar) → PLC girişleri, besleme ve scan
    let nets = this.protect(this.solveNets());
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
      if (this.tick % (d.scanTimeMs / TICK_MS) === 0) d.plc.scan(d.scanTimeMs);
    }
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'esp32') continue;
      const powered = nets.potential(e.t['24V']!) === 'P24' && nets.potential(e.t['GND']!) === 'M0';
      const pins = Object.fromEntries(
        ESP32_GPIO.map((p) => [p, d.esp.params.modes[p] === 'in' && nets.potential(e.t[p]!) === 'P24']),
      ) as Record<Esp32Pin, boolean>;
      d.esp.update({ powered, pins, adcMv: d.adcMv }, TICK_MS);
    }

    // 3. PLC çıkışları değişmiş olabilir: bobinler ve motorlar güncel netleri görsün
    nets = this.protect(this.solveNets());
    const supply = (e: Entry, a: string, b: string) => supplyBetween(nets.potential(e.t[a]!), nets.potential(e.t[b]!));
    // PLC çıkışı yalnız bobin (röle, kontaktör) sürer. Ucu bir PLC çıkış netinde olan yük
    // (lamba, fan, valf...) hiçbir koşulda çalışmaz ve arıza verir: araya röle konmalıdır.
    const plcNets = new Set<number>();
    for (const e of this.entries) {
      if (e.device.type === 'plc') for (const n of PLC_DQ) plcNets.add(nets.netOf(e.t[n]!));
      if (e.device.type === 'esp32') {
        const modes = e.device.esp.params.modes;
        for (const p of ESP32_GPIO) if (modes[p] === 'out') plcNets.add(nets.netOf(e.t[p]!));
      }
    }
    const load = (e: Entry, rating: Voltage, a: string, b: string, was: string | null) => {
      if (!plcNets.has(nets.netOf(e.t[a]!)) && !plcNets.has(nets.netOf(e.t[b]!))) return loadResponse(rating, supply(e, a, b));
      if (was !== PLC_DIRECT_FAULT) this.event(e, `${a}-${b}: ${PLC_DIRECT_FAULT}`);
      return { on: false, fault: PLC_DIRECT_FAULT };
    };

    // 4. Bobinler (anma geriliminde çeker; DC iki yönde de)
    for (const e of this.entries) {
      const d = e.device;
      if (d.type === 'contactor' || d.type === 'relay') {
        const r = loadResponse(d.voltage, supply(e, 'A1', 'A2'));
        d.fault = r.fault;
        d.contactor.update(r.on, TICK_MS);
      } else if (d.type === 'custom') {
        let energized = false;
        let fault: string | null = null;
        d.def.poles.forEach((p, i) => {
          if (p.kind !== 'coil' && p.kind !== 'lamp') return;
          const r =
            p.kind === 'lamp'
              ? load(e, d.def.voltage, p.top, p.bottom, d.fault)
              : loadResponse(d.def.voltage, supply(e, p.top, p.bottom));
          d.poles[i] = r.on;
          fault ??= r.fault;
          if (p.kind === 'coil' && r.on) energized = true;
        });
        d.fault = fault;
        d.relay.update(energized, TICK_MS);
      } else if (d.type === 'cylinder') {
        const r = load(e, d.voltage, 'A1', 'A2', d.fault);
        d.fault = r.fault;
        d.cylinder.update(r.on, TICK_MS);
      }
    }

    // 5. Motorlar: üç farklı faz gerekir; faz sırası yönü belirler. Tahrik ettikleri mekanizma
    //    (bant, depo) motor hızıyla ilerler.
    for (const e of this.entries) {
      const d = e.device;
      const motor = threePhaseMotor(d);
      if (!motor) continue;
      const phases = ['U', 'V', 'W'].map((n) => PHASES.indexOf(nets.potential(e.t[n]!) as Potential));
      const powered = phases.every((p) => p >= 0) && new Set(phases).size === 3;
      const [u, v] = phases as [number, number, number];
      const direction = powered && (v - u + 3) % 3 === 1 ? 1 : -1;
      motor.update(powered, TICK_MS, powered ? direction : motor.direction);
      if (d.type === 'conveyor') d.conveyor.update(motor.speed, TICK_MS);
      else if (d.type === 'pump') {
        const was = d.tank.overflowing;
        d.tank.update(Math.abs(motor.speed), TICK_MS);
        if (d.tank.overflowing && !was) this.event(e, 'depo taştı (pompa dolu depoya basıyor)');
      }
    }

    // Fanlar: tek fazlı, anma geriliminde döner
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'fan') continue;
      const r = load(e, d.voltage, 'X1', 'X2', d.fault);
      d.fault = r.fault;
      d.motor.update(r.on, TICK_MS, 1);
    }

    // 6. Termik elemanlar: ana kutuplarıyla aynı nette olan motorların akımını taşır
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'thermal' && d.type !== 'breaker3') continue;
      const poleNets = new Set(['2', '4', '6'].map((n) => nets.netOf(e.t[n]!)));
      let current = 0;
      for (const m of this.entries) {
        const motor = threePhaseMotor(m.device);
        if (!motor) continue;
        if (['U', 'V', 'W'].some((n) => poleNets.has(nets.netOf(m.t[n]!)))) current += motor.currentA;
      }
      d.currentA = current;
      const wasTripped = d.relay.tripped;
      d.relay.update(current, TICK_MS);
      if (d.type === 'breaker3' && d.relay.tripped && !wasTripped) {
        d.closed = false;
        d.tripped = true;
        this.event(e, `aşırı akımda açtı (I = ${current.toFixed(1)} A, Ir = ${d.relay.params.setCurrentA} A)`);
      }
    }

    // 7. Sinyal lambaları
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'lamp') continue;
      const r = load(e, d.voltage, 'X1', 'X2', d.fault);
      d.lit = r.on;
      d.fault = r.fault;
    }

    this.tick++;
  }

  run(ms: number): void {
    for (let i = 0; i < ms / TICK_MS; i++) this.step();
  }

  /** Bir sonraki PLC scan'i dahil olmak üzere ilerle (enerjili PLC yoksa bir scan süresi). */
  stepScan(): void {
    const plcs = this.entries.flatMap((e) => (e.device.type === 'plc' ? [e.device] : []));
    const counts = plcs.map((d) => d.plc.scanCount);
    const limit = Math.max(10, ...plcs.map((d) => d.scanTimeMs)) / TICK_MS;
    for (let i = 0; i < limit; i++) {
      this.step();
      if (plcs.some((d, j) => d.plc.scanCount !== counts[j])) return;
    }
  }

  private event(e: Entry, text: string): void {
    this.events.push({ tick: this.tick, component: e.id, text: `${e.name}: ${text}` });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  /**
   * Kısa devre koruması. Arızayı tek başına ayırabilen koruma elemanları denenir; bunlardan
   * açıldığında devrenin en büyük kısmını enerjili bırakan (arızaya en yakın olan) açtırılır.
   * Arıza kalkınca akım sınırlamasındaki güç kaynakları kendiliğinden toparlanır.
   */
  private protect(nets: NetResult): NetResult {
    // Akım sınırlamasındaki kaynaklar: arıza kalktıysa çıkış geri gelir.
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'psu24' || !d.limited) continue;
      d.limited = false;
      const trial = this.solveNets();
      if (trial.shorts.length > nets.shorts.length) d.limited = true;
      else {
        nets = trial;
        this.event(e, 'kısa devre giderildi, çıkış geri geldi');
      }
    }

    for (let guard = 0; nets.shorts.length > 0 && guard < 16; guard++) {
      let best: { entry: Entry; device: Protective; nets: NetResult; score: number } | null = null;
      for (const e of this.entries) {
        const d = e.device;
        if (!(d.type === 'breaker3' || d.type === 'fuse' ? d.closed : d.type === 'psu24' && !d.limited)) continue;
        const dev = d as Protective;
        this.setOpen(dev, true);
        const trial = this.solveNets();
        this.setOpen(dev, false);
        if (trial.shorts.length >= nets.shorts.length) continue;
        let score = 0;
        for (let i = 0; i < this.terminalKeys.length; i++) {
          const p = trial.potential(i);
          if (p && p !== 'short') score++;
        }
        if (!best || score > best.score) best = { entry: e, device: dev, nets: trial, score };
      }
      if (!best) break;
      this.setOpen(best.device, true);
      if (best.device.type === 'psu24') this.event(best.entry, 'kısa devre: çıkış akım sınırlamasında (kapalı)');
      else {
        best.device.tripped = true;
        this.event(best.entry, 'kısa devrede açtı');
      }
      nets = best.nets;
    }
    return nets;
  }

  private setOpen(d: Protective, open: boolean): void {
    if (d.type === 'psu24') d.limited = open;
    else d.closed = !open;
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
          s.addSource(t['N']!, 'N');
          break;
        case 'psu24':
          if (!d.limited) {
            s.addSource(t['L+']!, 'P24');
            s.addSource(t['M']!, 'M0');
          }
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
        case 'fuse':
          if (d.closed) link('1', '2');
          break;
        case 'terminal':
          link('1', '2');
          break;
        case 'lamp':
        case 'junction':
        case 'xref':
        case 'motor3':
        case 'fan':
          break;
        case 'cylinder':
          if (d.cylinder.retracted) link('13', '14');
          if (d.cylinder.extended) link('23', '24');
          break;
        case 'conveyor':
          if (d.conveyor.sensorBlocked) link('13', '14');
          break;
        case 'pump':
          if (d.tank.lowWet) link('13', '14');
          if (d.tank.highWet) link('23', '24');
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
        case 'relay':
          if (d.contactor.closed) {
            link('13', '14');
            link('23', '24');
          } else {
            link('31', '32');
          }
          break;
        case 'thermal':
          link('1', '2');
          link('3', '4');
          link('5', '6');
          if (d.relay.tripped) link('97', '98');
          else link('95', '96');
          break;
        case 'esp32':
          for (const p of ESP32_GPIO) if (d.esp.outputs[p]) s.addSource(t[p]!, 'P24');
          break;
        case 'plc':
          if (d.powered) {
            PLC_DQ.forEach((name, i) => {
              if (d.plc.dqTerminals[i]) s.addSource(t[name]!, 'P24');
            });
          }
          break;
        case 'custom':
          for (const p of d.def.poles) if (this.customPoleClosed(d, p.kind)) link(p.top, p.bottom);
          break;
      }
    }
    return s.solve();
  }

  /** Kontak türündeki kutbun iletimde olup olmadığı; bobin/lamba için null. */
  private customPoleClosed(d: Extract<Device, { type: 'custom' }>, kind: CustomDef['poles'][number]['kind']): boolean | null {
    switch (kind) {
      case 'link':
        return true;
      case 'pushNO':
        return d.pressed;
      case 'pushNC':
        return !d.pressed;
      case 'NO':
        return d.relay.closed;
      case 'NC':
        return !d.relay.closed;
      default:
        return null;
    }
  }

  private apply(command: SimCommand): void {
    const e = this.byId.get(command.component);
    const d = e?.device;
    if (!e || !d) return;
    switch (command.type) {
      case 'button':
        if (d.type === 'buttonNO' || d.type === 'buttonNC' || d.type === 'estop') d.button.pressed = command.pressed;
        else if (d.type === 'custom') d.pressed = command.pressed;
        break;
      case 'switch':
        if (d.type === 'fuse') {
          d.closed = command.closed;
          if (command.closed) d.tripped = false;
        } else if (d.type === 'breaker3') {
          if (!command.closed) d.closed = false;
          else if (d.relay.tripped && !d.relay.reset()) this.event(e, 'henüz soğumadı, kapatılamıyor');
          else {
            d.closed = true;
            d.tripped = false;
          }
        }
        break;
      case 'thermalTest':
        if (d.type === 'thermal') d.relay.test();
        break;
      case 'thermalReset':
        if (d.type === 'thermal') d.relay.reset();
        break;
      case 'addBox':
        if (d.type === 'conveyor' && !d.conveyor.addBox()) this.event(e, 'bandın başında yer yok');
        break;
      case 'analog':
        if (d.type === 'esp32') d.adcMv = Math.max(0, Math.min(10_000, Math.round(command.mv)));
        break;
      case 'modbusWrite':
        if (d.type === 'esp32') {
          if (!d.esp.inputs.powered) this.event(e, 'Modbus: kart enerjisiz, yanıt yok');
          else {
            const r = handleRequest(d.esp.regs, command.request);
            if (!r.ok) this.event(e, `Modbus istisna ${r.exception} (FC${r.fn})`);
          }
        }
        break;
    }
  }

  private componentState(d: Device): ComponentState {
    switch (d.type) {
      case 'mains3':
      case 'terminal':
      case 'junction':
      case 'xref':
        return { type: d.type };
      case 'psu24':
        return { type: d.type, limited: d.limited };
      case 'buttonNO':
      case 'buttonNC':
      case 'estop':
        return { type: d.type, pressed: d.button.pressed, contactClosed: d.button.contactClosed };
      case 'breaker3':
        return {
          type: d.type,
          closed: d.closed,
          tripped: d.tripped,
          theta: d.relay.theta,
          tripTheta: ThermalRelay.TRIP_THETA,
          setCurrentA: d.relay.params.setCurrentA,
          currentA: d.currentA,
        };
      case 'fuse':
        return { type: d.type, closed: d.closed, tripped: d.tripped };
      case 'lamp':
        return { type: d.type, lit: d.lit, fault: d.fault };
      case 'contactor':
      case 'relay':
        return { type: d.type, coilEnergized: d.contactor.coilEnergized, closed: d.contactor.closed, fault: d.fault };
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
      case 'esp32': {
        const x = d.esp;
        return {
          type: d.type,
          powered: x.inputs.powered,
          firmware: x.params.firmware,
          slaveId: x.params.slaveId,
          loopCount: x.loopCount,
          pins: ESP32_GPIO.map((pin) => ({
            pin,
            bit: x.params.bits[pin],
            mode: x.params.modes[pin],
            on: x.params.modes[pin] === 'in' ? x.inputs.pins[pin] : x.outputs[pin],
          })),
          adcMv: d.adcMv,
          adcRaw: x.adcRaw,
          coils: x.regs.coils.slice(0, 8),
          discreteInputs: x.regs.discreteInputs.slice(0, 8),
          inputRegisters: [...x.regs.inputRegisters.subarray(0, 2)],
          holdingRegisters: [...x.regs.holdingRegisters.subarray(0, 4)],
          busPeers: [],
          rs485Fault: null,
          ladder: x.plc ? plcRuntimeState(x.plc, x.inputs.powered, x.params.loopMs, 8) : null,
        };
      }
      case 'plc':
        return { type: d.type, ...plcRuntimeState(d.plc, d.powered, d.scanTimeMs, Math.max(PLC_DI.length, PLC_DQ.length)) };
      case 'cylinder': {
        const c = d.cylinder;
        return {
          type: d.type,
          valve: c.valve,
          position: c.position,
          retracted: c.retracted,
          extended: c.extended,
          fault: d.fault,
        };
      }
      case 'conveyor': {
        const m = d.motor;
        const c = d.conveyor;
        return {
          type: d.type,
          powered: m.powered,
          speed: m.speed,
          rpm: m.rpm,
          currentA: m.currentA,
          direction: m.direction,
          boxes: [...c.boxes],
          boxLength: Conveyor.BOX,
          sensorAt: Conveyor.SENSOR,
          beltPos: c.beltPos,
          sensor: c.sensorBlocked,
          delivered: c.delivered,
        };
      }
      case 'fan': {
        const m = d.motor;
        return { type: d.type, powered: m.powered, speed: m.speed, rpm: m.rpm, angleDeg: m.angleDeg, fault: d.fault };
      }
      case 'pump': {
        const m = d.motor;
        const t = d.tank;
        return {
          type: d.type,
          powered: m.powered,
          speed: m.speed,
          rpm: m.rpm,
          currentA: m.currentA,
          angleDeg: m.angleDeg,
          level: t.level,
          lowAt: Tank.LOW,
          highAt: Tank.HIGH,
          low: t.lowWet,
          high: t.highWet,
          overflowing: t.overflowing,
        };
      }
      case 'custom':
        return {
          type: d.type,
          pressed: d.pressed,
          coilEnergized: d.relay.coilEnergized,
          actuated: d.relay.closed,
          poles: d.def.poles.map((p, i) => this.customPoleClosed(d, p.kind) ?? d.poles[i]!),
          fault: d.fault,
        };
    }
  }

  /** RS485 kablolamasından bus üyeliklerini ve kablolama hatalarını ESP32 durumlarına yazar. */
  private annotateRs485(nets: NetResult, components: Record<string, ComponentState>): void {
    const nodes = this.entries
      .filter((e) => e.device.type === 'esp32')
      .map((e) => ({ id: e.id, name: e.name, a: nets.netOf(e.t['RS485_A']!), b: nets.netOf(e.t['RS485_B']!) }));
    const { groups, swapped } = rs485Groups(nodes);
    for (const n of nodes) {
      const st = components[n.id];
      if (st?.type !== 'esp32') continue;
      const group = groups.find((g) => g.includes(n)) ?? [];
      st.busPeers = group.filter((o) => o !== n).map((o) => o.name);
      if (n.a === n.b) st.rs485Fault = 'A ve B köprülenmiş';
      else if (swapped.has(n.id)) st.rs485Fault = 'A/B ters bağlı (A başka cihazın B ucunda)';
    }
  }

  snapshot(): SimSnapshot {
    const nets = this.solveNets();
    const potentials: Record<string, NetPotential> = {};
    this.terminalKeys.forEach((key, i) => (potentials[key] = nets.potential(i)));
    const components: Record<string, ComponentState> = {};
    for (const e of this.entries) components[e.id] = this.componentState(e.device);
    this.annotateRs485(nets, components);
    return {
      tick: this.tick,
      timeMs: this.tick * TICK_MS,
      components,
      potentials,
      shorts: nets.shorts.map((net) => net.map((i) => this.terminalKeys[i]!)),
      events: this.events.map((ev) => ({ ...ev })),
    };
  }
}

/** Kayıtlı komutları aynı tick'lerde yeniden uygulayarak simülasyonu yeniden üretir. */
export function replay(
  schematic: Schematic,
  log: readonly LoggedCommand[],
  totalTicks: number,
  config?: SimConfig,
): Simulation {
  const sim = new Simulation(schematic, config);
  let i = 0;
  while (sim.tick < totalTicks) {
    while (i < log.length && log[i]!.tick === sim.tick) sim.enqueue(log[i++]!.command);
    sim.step();
  }
  return sim;
}
