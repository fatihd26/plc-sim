// Simülasyon çekirdeği: sabit 1 ms tick, deterministik faz sırası.
// Devre bir şema dokümanından kurulur; bağlantılar her tick'te NetSolver ile çözülür.
// UI'dan bağımsızdır: dışarıya yalnız komut kuyruğu (giriş) ve snapshot (çıkış) açar.
//
// Çekirdek tipler (kaynak, buton, kontaktör, koruma, motor, lamba, PLC, ESP32...) burada,
// diğer bileşenler modules/ altındaki modüllerdedir. Faz sırası modules/types.ts'te anlatılır.

import { ANALOG_FULL, ANALOG_OVERFLOW } from './address';
import { PLC_AI, PLC_AQ, PLC_DI, PLC_DQ, readParamOf, terminalsOf, type ComponentType, type CustomDef, type Voltage } from './catalog';
import { Contactor, Motor, PushButton, ThermalRelay } from './devices';
import { Esp32, ESP32_GPIO, rs485Groups, type Esp32Firmware, type Esp32Pin, type PinMode } from './esp32';
import { controllerIo } from './ioConfig';
import type { LadderProgram, LadderTrace } from './ladder';
import { handleRequest, type ModbusDataModel, type ModbusRequest } from './modbus';
import { ModbusMaster, type PollStatus } from './modbusMaster';
import { moduleOf, type DeviceModule, type ModuleState } from './modules';
import type {
  FluidNet,
  FluidPotential,
  HydraulicResult,
  Material,
  ModuleIo,
  Signal,
  Supply,
  TargetView,
} from './modules/types';
import { NetSolver, type NetPotential, type NetResult, type Potential } from './netlist';
import { Plc } from './plc';
import { startStopProgram } from './programs';
import { terminalKey, validateSchematic, type ComponentInstance, type Schematic } from './schematic';

export type { Signal, Supply, FluidNet } from './modules/types';

export const TICK_MS = 1;

/** Olay günlüğünde tutulan en fazla kayıt. */
const MAX_EVENTS = 20;

export type SimCommand =
  | { type: 'button'; component: string; pressed: boolean }
  | { type: 'switch'; component: string; closed: boolean }
  | { type: 'thermalTest'; component: string }
  | { type: 'thermalReset'; component: string }
  /** Konveyörün başına kutu koy (= device/addBox). */
  | { type: 'addBox'; component: string }
  /** ESP32 ADC1 girişine verilen gerilim [mV]. */
  | { type: 'analog'; component: string; mv: number }
  /** Test master'ı: ESP32'nin Modbus belleğine doğrudan istek (bus'sız, anında). */
  | { type: 'modbusWrite'; component: string; request: ModbusRequest }
  /** Modül eylemi (parça besle, elle hedef, ayar değeri...). */
  | { type: 'device'; component: string; action: string; value?: number }
  /** Arıza enjeksiyonu. */
  | { type: 'fault'; component: string; fault: string; active: boolean }
  /** Kablo kopukluğu (component alanı kablo kimliğidir). */
  | { type: 'wireFault'; component: string; broken: boolean };

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

export interface SimEvent {
  tick: number;
  component: string;
  text: string;
}

/** Çekirdek tiplerin durumu. */
export type CoreState =
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
  | ({
      type: 'plc';
      /** Modbus tablosu satırlarının durumu (tablo yoksa boş). */
      modbus: PollStatus[];
      /** Analog girişlerin ham değeri (%IW) ve sinyal tipi; çıkışların ham değeri (%QW). */
      ai: { raw: number; type: string }[];
      aq: number[];
      /** Hızlı sayıcı değerleri (HC0, HC1); kapalı sayıcıda null. */
      hsc: (number | null)[];
    } & PlcRuntimeState)
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
      /** ADC1 ucuna bağlı analog kaynak var mı (yoksa kaydırıcı değeri kullanılır). */
      adcWired: boolean;
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
export type ComponentState = CoreState | ModuleState;

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
  /** %IW ve %QW kelimeleri. */
  iw: number[];
  qw: number[];
}

function plcRuntimeState(p: Plc, powered: boolean, scanTimeMs: number, n: number): PlcRuntimeState {
  const analog = p.analogWords();
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
    iw: analog.iw,
    qw: analog.qw,
  };
}

export interface SimSnapshot {
  tick: number;
  timeMs: number;
  components: Record<string, ComponentState>;
  /** "bileşen:terminal" → net potansiyeli. */
  potentials: Record<string, NetPotential>;
  /** Sinyal taşıyan netlerdeki terminaller → sinyal (analog, darbe, VFD frekansı). */
  signals: Record<string, Signal>;
  /** Akışkan terminalleri → hat durumu (P basınçlı, T tahliye, null kapalı). */
  fluid: Record<string, FluidNet>;
  /** Kısa devre olan netler ("bileşen:terminal" listeleri). */
  shorts: string[][];
  /** Koruma açmaları gibi olaylar (en yenisi sonda). */
  events: SimEvent[];
  /** Etkin arızalar (bileşen kimliği → arıza anahtarları). */
  faults: Record<string, string[]>;
  /** Kopuk kabloların kimlikleri. */
  brokenWires: string[];
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
  | {
      type: 'plc';
      plc: Plc;
      powered: boolean;
      scanTimeMs: number;
      master: ModbusMaster | null;
      aiTypes: string[];
      hscModes: string[];
      /** HSC başına son görülen enkoder konumu (kaynak kimliğiyle). */
      hscLast: ({ src: string; pos: number } | null)[];
    }
  | { type: 'esp32'; esp: Esp32; adcMv: number; adcWired: boolean }
  | {
      type: 'custom';
      def: CustomDef;
      pressed: boolean;
      relay: Contactor;
      poles: boolean[];
      fault: string | null;
    }
  | { type: 'module'; def: DeviceModule<string, unknown, { type: string }>; d: unknown };

interface Entry {
  id: string;
  name: string;
  inst: ComponentInstance;
  device: Device;
  /** Terminal adı → global terminal indeksi. */
  t: Record<string, number>;
  /** Etkin arızalar. */
  faults: Set<string>;
  /** Yük uçları başına son arıza (aynı olay tekrar yazılmasın). */
  loadFaults: Map<string, string | null>;
  io: ModuleIo;
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

/** Analog girişin ham değeri: 0..27648 tam skala, taşma/kablo kopukluğu 32767. */
export function analogRaw(signal: Signal | null, type: string): number {
  if (type === '4-20mA') {
    if (!signal || signal.kind !== 'mA' || signal.ma < 3.5) return ANALOG_OVERFLOW;
    return Math.round(Math.min(32511, ((signal.ma - 4) * ANALOG_FULL) / 16));
  }
  if (!signal) return 0;
  if (signal.kind !== 'V') return ANALOG_OVERFLOW;
  return Math.round(Math.max(0, Math.min(32511, (signal.v * ANALOG_FULL) / 10)));
}

function createDevice(c: ComponentInstance, config: SimConfig): Device {
  const p = readParamOf(c);
  const mod = moduleOf(c.type);
  if (mod) return { type: 'module', def: mod, d: mod.create(c) };
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
        contactor: new Contactor({ pickupMs: p.num('pickupMs'), dropoutMs: p.num('dropoutMs') }),
        voltage: p.str('coilVoltage') as Voltage,
        fault: null,
      };
    case 'breaker3':
      // Şalter kapalı teslim edilir; kullanıcı elle açabilir, koruma kendiliğinden açar.
      return {
        type: c.type,
        closed: true,
        tripped: false,
        relay: new ThermalRelay({ setCurrentA: p.num('setCurrentA'), tauMs: p.num('tauS') * 1000 }),
        currentA: 0,
      };
    case 'fuse':
      return { type: c.type, closed: true, tripped: false };
    case 'lamp':
      return { type: c.type, lit: false, voltage: p.str('voltage') as Voltage, fault: null };
    case 'thermal':
      return {
        type: c.type,
        relay: new ThermalRelay({ setCurrentA: p.num('setCurrentA'), tauMs: p.num('tauS') * 1000 }),
        currentA: 0,
      };
    case 'motor3':
      return {
        type: c.type,
        motor: new Motor({
          ratedCurrentA: p.num('ratedCurrentA'),
          ratedRpm: p.num('ratedRpm'),
          startTauMs: p.num('startTauMs'),
          coastTauMs: p.num('coastTauMs'),
          lockedRotorRatio: p.num('lockedRotorRatio'),
          loadPct: p.num('loadPct'),
        }),
      };
    case 'plc':
      return {
        type: c.type,
        plc: new Plc(config.program ?? c.program ?? startStopProgram),
        powered: false,
        scanTimeMs: config.scanTimeMs ?? Math.round(p.num('scanTimeMs')),
        master: c.modbusPolls?.length ? new ModbusMaster(c.modbusPolls, Number(p.str('baud')), p.num('timeoutMs')) : null,
        aiTypes: PLC_AI.map((_, i) => p.str(`ai${i}Type`)),
        hscModes: [p.str('hsc0'), p.str('hsc1')],
        hscLast: [null, null],
      };
    case 'esp32': {
      const modes = Object.fromEntries(ESP32_GPIO.map((pin) => [pin, p.str(`mode_${pin}`) as PinMode])) as Record<
        Esp32Pin,
        PinMode
      >;
      const io = controllerIo(c);
      const bits = Object.fromEntries([...io.inputs, ...io.outputs].map((pt) => [pt.terminal, pt.bit])) as Record<
        Esp32Pin,
        number
      >;
      return {
        type: c.type,
        esp: new Esp32(
          {
            bits,
            slaveId: p.num('slaveId'),
            baud: Number(p.str('baud')),
            loopMs: Math.max(1, Math.round(p.num('loopMs'))),
            modes,
            firmware: p.str('firmware') as Esp32Firmware,
          },
          c.program,
        ),
        adcMv: 0,
        adcWired: false,
      };
    }
    case 'custom': {
      const def = c.custom!;
      return { type: c.type, def, pressed: false, relay: new Contactor(), poles: def.poles.map(() => false), fault: null };
    }
    default:
      throw new Error(`Bilinmeyen bileşen tipi: ${c.type}`);
  }
}

/** Kısa devrede açarak arızayı ayırabilen elemanlar. */
type Protective = Extract<Device, { type: 'breaker3' | 'fuse' | 'psu24' }>;

/** Bir netteki sinyal; iki kaynak çakışırsa 'conflict'. */
type SignalMap = Map<number, Signal | 'conflict'>;

export class Simulation {
  readonly config: SimConfig;
  readonly schematic: Schematic;
  private readonly entries: Entry[] = [];
  private readonly byId = new Map<string, Entry>();
  private readonly byName = new Map<string, Entry>();
  private readonly terminalKeys: string[] = [];
  /** Kablolar (kimlik ve uç indeksleri); kopuk olanlar çözüme katılmaz. */
  private readonly wires: { id: string; a: number; b: number }[] = [];
  private readonly broken = new Set<string>();
  /** Aynı etiketli sayfa geçişlerinin görünmez bağlantıları. */
  private readonly xrefPairs: [number, number][] = [];
  /** Akışkan terminallerinin indeksleri (snapshot için). */
  private readonly fluidTerminals: number[] = [];
  private readonly solver: NetSolver;
  private readonly fluidSolver: NetSolver<FluidPotential>;
  private readonly events: SimEvent[] = [];
  private readonly hasFluid: boolean;

  // Son çözümler (fazlar arasında paylaşılır)
  private nets!: NetResult;
  private signals: SignalMap = new Map();
  private fluidNets: NetResult<FluidPotential> | null = null;
  private restrictions = new Map<number, number>();
  private plcNets = new Set<number>();
  private hydraulic = new Map<string, HydraulicResult>();

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
      const device = createDevice(c, this.config);
      const domains = device.type === 'module' ? device.def.spec.domains : undefined;
      for (const name of terminalsOf(c)) {
        const key = terminalKey({ component: c.id, terminal: name });
        t[name] = this.terminalKeys.length;
        index.set(key, this.terminalKeys.length);
        if (domains?.[name]) this.fluidTerminals.push(this.terminalKeys.length);
        this.terminalKeys.push(key);
      }
      const entry: Entry = {
        id: c.id,
        name: c.name,
        inst: c,
        device,
        t,
        faults: new Set(c.faults ?? []),
        loadFaults: new Map(),
        io: null!,
      };
      entry.io = this.makeIo(entry);
      this.entries.push(entry);
      this.byId.set(c.id, entry);
      if (!this.byName.has(c.name)) this.byName.set(c.name, entry);
      if (c.type === 'xref') {
        const list = xrefs.get(c.name) ?? [];
        list.push(t['1']!);
        xrefs.set(c.name, list);
      }
    }
    for (const w of this.schematic.wires) {
      this.wires.push({ id: w.id, a: index.get(terminalKey(w.a))!, b: index.get(terminalKey(w.b))! });
      if (w.broken) this.broken.add(w.id);
    }
    // Aynı etiketli sayfa geçişleri görünmez bir kabloyla bağlıdır.
    for (const list of xrefs.values()) {
      for (let i = 1; i < list.length; i++) this.xrefPairs.push([list[0]!, list[i]!]);
    }
    this.solver = new NetSolver(this.terminalKeys.length);
    this.fluidSolver = new NetSolver<FluidPotential>(this.terminalKeys.length);
    this.hasFluid = this.fluidTerminals.length > 0;
    this.nets = this.solveNets();
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

    // 2. Bağlantıları çöz (kısa devre varsa koruma açar), sinyalleri sür → PLC girişleri ve scan
    this.nets = this.protect(this.solveNets());
    this.signals = this.driveSignals();
    for (const e of this.entries) {
      if (e.device.type !== 'plc') continue;
      const d = e.device;
      const powered = this.pot(e, 'L+') === 'P24' && this.pot(e, 'M') === 'M0';
      if (!powered) {
        if (d.powered) d.plc.powerOff();
        d.powered = false;
        d.hscLast = [null, null];
        continue;
      }
      d.powered = true;
      PLC_DI.forEach((name, i) => (d.plc.diTerminals[i] = this.pot(e, name) === 'P24'));
      PLC_AI.forEach((name, i) => (d.plc.aiTerminals[i] = analogRaw(this.sig(e, name), d.aiTypes[i]!)));
      this.countHsc(e, d);
      if (this.tick % (d.scanTimeMs / TICK_MS) === 0) d.plc.scan(d.scanTimeMs);
    }
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'esp32') continue;
      const powered = this.pot(e, '24V') === 'P24' && this.pot(e, 'GND') === 'M0';
      const pins = Object.fromEntries(
        ESP32_GPIO.map((p) => [p, d.esp.params.modes[p] === 'in' && this.pot(e, p) === 'P24']),
      ) as Record<Esp32Pin, boolean>;
      const adc = this.sig(e, 'ADC1');
      d.adcWired = adc?.kind === 'V';
      d.esp.update({ powered, pins, adcMv: adc?.kind === 'V' ? Math.round(adc.v * 1000) : d.adcMv }, TICK_MS);
    }
    this.stepModbus();

    // 3. PLC çıkışları değişmiş olabilir: bobinler, motorlar ve modüller güncel netleri görsün
    this.nets = this.protect(this.solveNets());
    this.signals = this.driveSignals();
    // PLC çıkışı yalnız bobin (röle, kontaktör) sürer. Ucu bir PLC çıkış netinde olan yük
    // (lamba, fan, valf...) hiçbir koşulda çalışmaz ve arıza verir: araya röle konmalıdır.
    this.plcNets = new Set<number>();
    for (const e of this.entries) {
      if (e.device.type === 'plc') for (const n of PLC_DQ) this.plcNets.add(this.nets.netOf(e.t[n]!));
      if (e.device.type === 'esp32') {
        const modes = e.device.esp.params.modes;
        for (const p of ESP32_GPIO) if (modes[p] === 'out') this.plcNets.add(this.nets.netOf(e.t[p]!));
      }
    }
    if (this.hasFluid) {
      this.solveFluid();
      this.allocateHydraulics();
    }

    // 4. Bobinler (anma geriliminde çeker; DC iki yönde de)
    for (const e of this.entries) {
      const d = e.device;
      if (d.type === 'contactor' || d.type === 'relay') {
        const r = loadResponse(d.voltage, e.io.supply('A1', 'A2'));
        d.fault = r.fault;
        d.contactor.update(r.on && !e.faults.has('coil'), TICK_MS);
      } else if (d.type === 'custom') {
        let energized = false;
        let fault: string | null = null;
        d.def.poles.forEach((p, i) => {
          if (p.kind !== 'coil' && p.kind !== 'lamp') return;
          const r = p.kind === 'lamp' ? e.io.load(d.def.voltage, p.top, p.bottom) : loadResponse(d.def.voltage, e.io.supply(p.top, p.bottom));
          d.poles[i] = r.on;
          fault ??= r.fault;
          if (p.kind === 'coil' && r.on) energized = true;
        });
        d.fault = fault;
        d.relay.update(energized, TICK_MS);
      }
    }

    // 5. Motorlar: üç farklı faz gerekir; faz sırası yönü belirler, VFD çıkışında frekans hızı.
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'motor3') continue;
      const tp = e.io.threePhase('U', 'V', e.faults.has('phase') ? 'U' : 'W');
      const single = e.faults.has('phase') && supplyBetween(this.pot(e, 'U'), this.pot(e, 'V')) === 'AC400';
      const vfd = tp.powered && tp.hz !== null;
      d.motor.update(tp.powered || single, TICK_MS, tp.powered ? tp.direction : d.motor.direction, {
        ratio: vfd ? tp.hz! / 50 : 1,
        locked: e.faults.has('jam') || single,
        currentLimit: vfd ? 1.5 : undefined,
      });
    }

    // 6. Modüller: mekanik, proses, sensör ve sürücü modelleri
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'module' || !d.def.update) continue;
      d.def.update(d.d, e.io, TICK_MS, this.hydraulic.get(e.id) ?? EMPTY_HYD);
    }

    // 7. Termik elemanlar: ana kutuplarıyla aynı nette olan motorların akımını taşır
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'thermal' && d.type !== 'breaker3') continue;
      const poleNets = new Set(['2', '4', '6'].map((n) => this.nets.netOf(e.t[n]!)));
      let current = 0;
      for (const m of this.entries) {
        const lc = lineCurrentOf(m);
        if (lc && lc.terminals.some((n) => poleNets.has(this.nets.netOf(m.t[n]!)))) current += lc.currentA;
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

    // 8. Sinyal lambaları
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'lamp') continue;
      const r = e.io.load(d.voltage, 'X1', 'X2');
      d.lit = r.on && !e.faults.has('burnt');
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

  private pot(e: Entry, terminal: string): NetPotential {
    const i = e.t[terminal];
    return i === undefined ? null : this.nets.potential(i);
  }

  private sig(e: Entry, terminal: string): Signal | null {
    const i = e.t[terminal];
    if (i === undefined) return null;
    const s = this.signals.get(this.nets.netOf(i));
    return s && s !== 'conflict' ? s : null;
  }

  /** Bir bileşenin modüllere verilen G/Ç arayüzü (bir kez oluşturulur, güncel çözümleri okur). */
  private makeIo(e: Entry): ModuleIo {
    const sim = this;
    const fault = (k: string) => e.faults.has(k);
    return {
      get tick() {
        return sim.tick;
      },
      fault,
      potential: (t) => sim.pot(e, t),
      sameNet: (a, b) => sim.nets.netOf(e.t[a]!) === sim.nets.netOf(e.t[b]!),
      supply: (a, b) => supplyBetween(sim.pot(e, a), sim.pot(e, b)),
      high: (t) => sim.pot(e, t) === 'P24',
      powered24: (a, b) => sim.pot(e, a) === 'P24' && sim.pot(e, b) === 'M0',
      load(rating, a, b) {
        const key = `${a}-${b}`;
        const direct = sim.plcNets.has(sim.nets.netOf(e.t[a]!)) || sim.plcNets.has(sim.nets.netOf(e.t[b]!));
        const r = direct ? { on: false, fault: PLC_DIRECT_FAULT } : loadResponse(rating, supplyBetween(sim.pot(e, a), sim.pot(e, b)));
        if (r.fault === PLC_DIRECT_FAULT && e.loadFaults.get(key) !== PLC_DIRECT_FAULT) sim.event(e, `${key}: ${PLC_DIRECT_FAULT}`);
        e.loadFaults.set(key, r.fault);
        return r;
      },
      threePhase(u, v, w) {
        const phases = [u, v, w].map((n) => PHASES.indexOf(sim.pot(e, n) as Potential));
        const powered = phases.every((p) => p >= 0) && new Set(phases).size === 3;
        const [pu, pv] = phases as [number, number, number];
        const direction = powered && (pv - pu + 3) % 3 === 1 ? 1 : -1;
        const s = sim.sig(e, u);
        return { powered, direction, hz: powered && s?.kind === 'drive' ? s.hz : null };
      },
      signal: (t) => sim.sig(e, t),
      fluid: (t) => {
        const i = e.t[t];
        return i === undefined || !sim.fluidNets ? null : sim.fluidNets.potential(i);
      },
      wired: (t) => {
        const i = e.t[t];
        return i !== undefined && sim.wires.some((w) => !sim.broken.has(w.id) && (w.a === i || w.b === i));
      },
      restriction: (t) => {
        const i = e.t[t];
        return i === undefined || !sim.fluidNets ? 1 : (sim.restrictions.get(sim.fluidNets.netOf(i)) ?? 1);
      },
      target: (param) => {
        const name = readParamOf(e.inst).str(param);
        const other = name ? sim.byName.get(name) : undefined;
        return other && other !== e ? sim.targetView(other) : null;
      },
      event: (text) => sim.event(e, text),
    };
  }

  private targetView(e: Entry): TargetView {
    const d = e.device;
    return {
      name: e.name,
      type: e.inst.type,
      probe: (at: number, material: Material) => (d.type === 'module' && d.def.probe ? d.def.probe(d.d, at, material) : null),
      measure: (q: string) => {
        if (d.type === 'module') return d.def.measure?.(d.d, q) ?? null;
        if (d.type === 'motor3') return q === 'revs' ? d.motor.revs : q === 'rpm' ? d.motor.rpm : null;
        return null;
      },
    };
  }

  /** Analog, darbe ve frekans sinyallerini netlere yazar. */
  private driveSignals(): SignalMap {
    const map: SignalMap = new Map();
    const put = (terminal: number | undefined, s: Signal) => {
      if (terminal === undefined) return;
      const net = this.nets.netOf(terminal);
      map.set(net, map.has(net) ? 'conflict' : s);
    };
    for (const e of this.entries) {
      const d = e.device;
      if (d.type === 'plc' && d.powered) {
        PLC_AQ.forEach((name, i) => {
          const raw = d.plc.aqTerminals[i]!;
          put(e.t[name], { kind: 'V', v: (Math.max(0, Math.min(ANALOG_FULL, raw)) * 10) / ANALOG_FULL });
        });
      } else if (d.type === 'module' && d.def.drive) {
        d.def.drive(d.d, {
          fault: (k) => e.faults.has(k),
          potential: (t) => this.pot(e, t),
          drive: (t, s) => put(e.t[t], s),
        });
      }
    }
    return map;
  }

  /** PLC hızlı sayıcıları: enkoder darbelerini her tick sayar. */
  private countHsc(e: Entry, d: Extract<Device, { type: 'plc' }>): void {
    const pins: [string, string][] = [
      ['I0.0', 'I0.1'],
      ['I0.2', 'I0.3'],
    ];
    d.hscModes.forEach((mode, i) => {
      if (mode === 'off') return;
      const [pa, pb] = pins[i]!;
      const a = this.sig(e, pa);
      if (a?.kind !== 'pulse') {
        d.hscLast[i] = null;
        return;
      }
      const last = d.hscLast[i];
      d.hscLast[i] = { src: a.src, pos: a.pos };
      if (!last || last.src !== a.src) return;
      const delta = a.pos - last.pos;
      if (mode === 'up') d.plc.countPulses(i, Math.abs(delta));
      else {
        const b = this.sig(e, pb);
        // Kuadratür: B kanalı aynı enkoderden gelmiyorsa yön çözülemez, sayılmaz.
        if (b?.kind === 'pulse' && b.src === a.src) d.plc.countPulses(i, delta);
      }
    });
  }

  /** Akışkan devrelerini (pnömatik, hidrolik) çözer. */
  private solveFluid(): void {
    const s = this.fluidSolver;
    s.reset();
    for (const w of this.wires) if (!this.broken.has(w.id)) s.connect(w.a, w.b);
    const restrict: [number, number][] = [];
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'module' || !d.def.fluidLinks) continue;
      d.def.fluidLinks(d.d, {
        fault: (k) => e.faults.has(k),
        link: (a, b) => s.connect(e.t[a]!, e.t[b]!),
        source: (t, p) => s.addSource(e.t[t]!, p),
        restrict: (t, f) => restrict.push([e.t[t]!, f]),
      });
    }
    this.fluidNets = s.solve();
    this.restrictions = new Map();
    for (const [t, f] of restrict) {
      const net = this.fluidNets.netOf(t);
      this.restrictions.set(net, Math.min(this.restrictions.get(net) ?? 1, f));
    }
  }

  /**
   * Hidrolik debi paylaşımı: yağ en az dirençli yolu seçer. Bir pompanın basınç hattına bağlı
   * hareket taleplerinden en düşük basınç isteyene tüm debi verilir (eşitse paylaşılır). Hiçbir
   * aktüatör hareket edemiyorsa (uçta, kapalı merkez, yük fazla) emniyet valfi açar ve basınç
   * ayar değerine çıkar. Basınç hattı tanka açıksa (açık merkez) basınç ~0'dır.
   */
  private allocateHydraulics(): void {
    this.hydraulic = new Map();
    const fn = this.fluidNets!;
    const demands: { e: Entry; id: string; inlet: number; pressure: number }[] = [];
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'module' || !d.def.hydraulicDemands) continue;
      for (const q of d.def.hydraulicDemands(d.d, e.io)) {
        if (fn.potential(e.t[q.outlet]!) !== 'T') continue;
        demands.push({ e, id: q.id, inlet: fn.netOf(e.t[q.inlet]!), pressure: q.pressureBar });
      }
    }
    const result = (e: Entry) => {
      let r = this.hydraulic.get(e.id);
      if (!r) this.hydraulic.set(e.id, (r = { grants: {}, pressure: {} }));
      return r;
    };
    for (const e of this.entries) {
      const d = e.device;
      if (d.type !== 'module' || !d.def.hydraulicSupply) continue;
      const sup = d.def.hydraulicSupply(d.d);
      if (!sup) continue;
      const own = result(e);
      const port = e.t[sup.port]!;
      const net = fn.netOf(port);
      if (sup.flowLpm <= 0) {
        own.pressure[sup.port] = 0;
        continue;
      }
      if (fn.potential(port) === 'short') {
        own.pressure[sup.port] = 0;
        own.grants.unload = sup.flowLpm;
        continue;
      }
      const mine = demands.filter((q) => q.inlet === net && q.pressure <= sup.reliefBar);
      if (!mine.length) {
        own.pressure[sup.port] = sup.reliefBar;
        own.grants.relief = sup.flowLpm;
        continue;
      }
      const p = Math.min(...mine.map((q) => q.pressure));
      const winners = mine.filter((q) => q.pressure === p);
      for (const q of winners) {
        const r = result(q.e);
        r.grants[q.id] = (r.grants[q.id] ?? 0) + sup.flowLpm / winners.length;
      }
      own.pressure[sup.port] = p;
      for (const q of demands) if (q.inlet === net) result(q.e).pressure[q.id] = p;
    }
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
    for (const w of this.wires) if (!this.broken.has(w.id)) s.connect(w.a, w.b);
    for (const [a, b] of this.xrefPairs) s.connect(a, b);
    for (const e of this.entries) {
      const t = e.t;
      const d = e.device;
      const link = (a: string, b: string) => s.connect(t[a]!, t[b]!);
      const f = (k: string) => e.faults.has(k);
      switch (d.type) {
        case 'mains3':
          s.addSource(t['L1']!, 'L1');
          s.addSource(t['L2']!, 'L2');
          s.addSource(t['L3']!, 'L3');
          s.addSource(t['N']!, 'N');
          break;
        case 'psu24':
          if (!d.limited && !f('dead')) {
            s.addSource(t['L+']!, 'P24');
            s.addSource(t['M']!, 'M0');
          }
          break;
        case 'buttonNO':
          if (d.button.contactClosed && !f('open')) link('13', '14');
          break;
        case 'buttonNC':
        case 'estop':
          if (d.button.contactClosed && !f('open')) link('11', '12');
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
          break;
        case 'contactor':
          if (d.contactor.closed || f('welded')) {
            link('1', '2');
            link('3', '4');
            link('5', '6');
            link('13', '14');
          } else {
            link('21', '22');
          }
          break;
        case 'relay':
          if (d.contactor.closed || f('welded')) {
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
          else if (!f('stuck')) link('95', '96');
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
        case 'module':
          d.def.links?.(d.d, { fault: f, link, source: (term, p) => s.addSource(t[term]!, p) });
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
    if (command.type === 'wireFault') {
      if (!this.wires.some((w) => w.id === command.component)) return;
      if (command.broken) this.broken.add(command.component);
      else this.broken.delete(command.component);
      return;
    }
    const e = this.byId.get(command.component);
    const d = e?.device;
    if (!e || !d) return;
    switch (command.type) {
      case 'button':
        if (d.type === 'buttonNO' || d.type === 'buttonNC' || d.type === 'estop') d.button.pressed = command.pressed;
        else if (d.type === 'custom') d.pressed = command.pressed;
        else if (d.type === 'module') d.def.command?.(d.d, 'press', command.pressed ? 1 : 0, e.io);
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
        if (d.type === 'module') d.def.command?.(d.d, 'addBox', undefined, e.io);
        break;
      case 'device':
        if (d.type === 'module') d.def.command?.(d.d, command.action, command.value, e.io);
        break;
      case 'fault':
        if (command.active) e.faults.add(command.fault);
        else e.faults.delete(command.fault);
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

  private componentState(e: Entry): ComponentState {
    const d = e.device;
    switch (d.type) {
      case 'module':
        return d.def.state(d.d) as ComponentState;
      case 'mains3':
      case 'terminal':
      case 'junction':
      case 'xref':
        return { type: d.type };
      case 'psu24':
        return { type: d.type, limited: d.limited || e.faults.has('dead') };
      case 'buttonNO':
      case 'buttonNC':
      case 'estop':
        return { type: d.type, pressed: d.button.pressed, contactClosed: d.button.contactClosed && !e.faults.has('open') };
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
        return {
          type: d.type,
          coilEnergized: d.contactor.coilEnergized,
          closed: d.contactor.closed || e.faults.has('welded'),
          fault: d.fault,
        };
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
          adcMv: d.adcWired ? x.inputs.adcMv : d.adcMv,
          adcRaw: x.adcRaw,
          adcWired: d.adcWired,
          coils: x.regs.coils.slice(0, 8),
          discreteInputs: x.regs.discreteInputs.slice(0, 8),
          inputRegisters: [...x.regs.inputRegisters.subarray(0, 2)],
          holdingRegisters: [...x.regs.holdingRegisters.subarray(0, 4)],
          busPeers: [],
          rs485Fault: null,
          ladder: x.plc ? plcRuntimeState(x.plc, x.inputs.powered, x.params.loopMs, 8) : null,
        };
      }
      case 'plc': {
        const hsc = d.plc.hscValues();
        return {
          type: d.type,
          ...plcRuntimeState(d.plc, d.powered, d.scanTimeMs, Math.max(PLC_DI.length, PLC_DQ.length)),
          modbus: d.master ? [...d.master.status.values()].map((s) => ({ ...s, values: [...s.values] })) : [],
          ai: d.plc.aiTerminals.map((raw, i) => ({ raw, type: d.aiTypes[i]! })),
          aq: [...d.plc.aqTerminals],
          hsc: d.hscModes.map((m, i) => (m === 'off' ? null : hsc[i]!)),
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

  /** RS485 uçları olan cihazlar (PLC, ESP32, Modbus'lı modüller) ve A/B netleri. */
  private rs485Nodes() {
    const nets = this.nets;
    return this.entries.flatMap((e) => {
      const d = e.device;
      let ends: { a: string; b: string } | null = null;
      if (d.type === 'esp32' || d.type === 'plc') ends = { a: 'RS485_A', b: 'RS485_B' };
      else if (d.type === 'module' && d.def.modbus) ends = d.def.modbus(d.d);
      if (!ends) return [];
      return [{ id: e.id, name: e.name, entry: e, a: nets.netOf(e.t[ends.a]!), b: nets.netOf(e.t[ends.b]!) }];
    });
  }

  /** Bus'taki bir cihazın slave belleği (enerjili ve baud'u uygunsa). */
  private slaveOf(e: Entry, baud: number): { unit: number; model: ModbusDataModel } | null {
    const d = e.device;
    if (d.type === 'esp32') {
      if (!d.esp.inputs.powered || d.esp.params.baud !== baud) return null;
      return { unit: d.esp.params.slaveId, model: d.esp.regs };
    }
    if (d.type === 'module' && d.def.modbus) {
      const m = d.def.modbus(d.d);
      if (!m.powered || m.baud !== baud) return null;
      return { unit: m.unit, model: m.model };
    }
    return null;
  }

  /**
   * Modbus master'ları ilerletir. Bus, RS485 kablolamasından bulunur: master'ın A/B netlerini
   * paylaşan, enerjili ve aynı baud hızındaki slave'ler (ESP32, VFD...) yanıt verir. A/B ters
   * bağlı veya baud'u farklı slave yanıt vermez (zaman aşımı). Aynı bus'ta iki master veya
   * köprülenmiş A/B, bus hatasıdır.
   */
  private stepModbus(): void {
    const masters = this.entries.filter(
      (e): e is Entry & { device: Extract<Device, { type: 'plc' }> } => e.device.type === 'plc' && e.device.master !== null,
    );
    if (!masters.length) return;
    const nodes = this.rs485Nodes();
    const { groups } = rs485Groups(nodes);
    for (const e of masters) {
      const d = e.device;
      const master = d.master!;
      if (!d.powered) {
        master.reset();
        continue;
      }
      const node = nodes.find((n) => n.id === e.id)!;
      const group = groups.find((g) => g.includes(node)) ?? [];
      const otherMaster = group.find((n) => n !== node && n.entry.device.type === 'plc' && n.entry.device.master);
      const fault =
        node.a === node.b ? 'RS485 A ve B köprülenmiş' : otherMaster ? `bus'ta birden çok master (${otherMaster.name})` : null;
      const slaves = group.flatMap((n) => {
        const s = n === node ? null : this.slaveOf(n.entry, master.baud);
        return s ? [s] : [];
      });
      master.step(this.tick, d.plc, fault ? null : slaves, fault);
    }
  }

  /** RS485 kablolamasından bus üyeliklerini ve kablolama hatalarını ESP32 durumlarına yazar. */
  private annotateRs485(components: Record<string, ComponentState>): void {
    const nodes = this.rs485Nodes();
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
    const saved = this.nets;
    this.nets = nets;
    const signals = this.driveSignals();
    const potentials: Record<string, NetPotential> = {};
    const sigOut: Record<string, Signal> = {};
    this.terminalKeys.forEach((key, i) => {
      potentials[key] = nets.potential(i);
      const s = signals.get(nets.netOf(i));
      if (s && s !== 'conflict') sigOut[key] = s;
    });
    const fluid: Record<string, FluidNet> = {};
    if (this.fluidNets) for (const i of this.fluidTerminals) fluid[this.terminalKeys[i]!] = this.fluidNets.potential(i);
    const components: Record<string, ComponentState> = {};
    const faults: Record<string, string[]> = {};
    for (const e of this.entries) {
      components[e.id] = this.componentState(e);
      if (e.faults.size) faults[e.id] = [...e.faults];
    }
    this.annotateRs485(components);
    this.nets = saved;
    return {
      tick: this.tick,
      timeMs: this.tick * TICK_MS,
      components,
      potentials,
      signals: sigOut,
      fluid,
      shorts: nets.shorts.map((net) => net.map((i) => this.terminalKeys[i]!)),
      events: this.events.map((ev) => ({ ...ev })),
      faults,
      brokenWires: [...this.broken],
    };
  }
}

const EMPTY_HYD: HydraulicResult = { grants: {}, pressure: {} };

/** Termik elemanın ölçtüğü hat akımı (3~ motorlar ve motorlu modüller). */
function lineCurrentOf(e: Entry): { terminals: readonly string[]; currentA: number } | null {
  const d = e.device;
  if (d.type === 'motor3') return { terminals: ['U', 'V', 'W'], currentA: d.motor.currentA };
  if (d.type === 'module') return d.def.lineCurrent?.(d.d) ?? null;
  return null;
}

/** Tipin çekirdek mi modül mü olduğu (UI ve testler için). */
export const isModuleType = (type: ComponentType) => !!moduleOf(type);

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
