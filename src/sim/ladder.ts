// Ladder programı modeli ve güç akışı değerlendiricisi.
// Rung, seri/paralel bir ağaç olarak modellenir; görsel ızgara bundan türetilir.
//
// Komut seti:
//   Kontaklar   NO ┤ ├, NC ┤/├, P (yükselen kenar), N (düşen kenar), karşılaştırma (==, <>, >, >=, <, <=)
//   Çıkışlar    bobin ( ), ters bobin (/), set (S), reset (R)
//   Zamanlayıcı TON (çekmede gecikmeli), TOF (bırakmada gecikmeli), TP (darbe), TONR (kalıcı TON)
//   Sayıcı      CTU (yukarı), CTD (aşağı), CTUD (yukarı/aşağı)

import {
  FUNC_COUNT,
  MW_COUNT,
  formatOperand,
  isFunc,
  parseAddress,
  parseFunc,
  parseOperand,
  parseValue,
  type BitAddress,
  type BitOperand,
  type FuncAddress,
  type ValueOperand,
} from './address';

export type ContactType = 'NO' | 'NC' | 'P' | 'N';
export type CompareOp = '==' | '<>' | '>' | '>=' | '<' | '<=';
export const COMPARE_OPS: CompareOp[] = ['==', '<>', '>', '>=', '<', '<='];

export type LadderNode =
  | { kind: 'contact'; id: string; address: string; contact: ContactType; label?: string }
  | { kind: 'compare'; id: string; op: CompareOp; a: string; b: string; label?: string }
  | { kind: 'series'; id: string; items: LadderNode[] }
  | { kind: 'parallel'; id: string; branches: LadderNode[] };

export type BitCoilType = 'coil' | 'ncoil' | 'set' | 'reset';
export type TimerType = 'TON' | 'TOF' | 'TP' | 'TONR';
export type CounterType = 'CTU' | 'CTD' | 'CTUD';
export type CoilType = BitCoilType | TimerType | CounterType;

export const TIMER_TYPES: TimerType[] = ['TON', 'TOF', 'TP', 'TONR'];
export const COUNTER_TYPES: CounterType[] = ['CTU', 'CTD', 'CTUD'];
export const isTimer = (t: CoilType | undefined): t is TimerType => TIMER_TYPES.includes(t as TimerType);
export const isCounter = (t: CoilType | undefined): t is CounterType => COUNTER_TYPES.includes(t as CounterType);

/**
 * Network çıkışı. `type` yoksa düz bobindir (v0.3 dosyalarıyla uyumlu).
 * Zamanlayıcıda `address` T0..T15 ve `preset` ms; sayıcıda C0..C15 ve `preset` adet.
 * `reset` (TONR, CTU, CTUD), `load` (CTD) ve `down` (CTUD) ek girişlerin okuduğu bit adresidir.
 */
export interface Coil {
  id: string;
  address: string;
  label?: string;
  type?: CoilType;
  preset?: number;
  reset?: string;
  load?: string;
  down?: string;
}

export interface Network {
  id: string;
  title: string;
  logic: LadderNode;
  coil: Coil;
}

export interface LadderProgram {
  networks: Network[];
}

/** Bir elemanın son scan'deki durumu (online izleme için). */
export interface ElementState {
  powerIn: boolean;
  powerOut: boolean;
  /** Yalnız kontaklarda: kontak iletimde mi (güç olsun olmasın). */
  closed?: boolean;
  /** Zamanlayıcıda geçen süre (ms), sayıcıda sayaç değeri. */
  value?: number;
}

export type LadderTrace = Record<string, ElementState>;

export type BitReader = (addr: BitAddress) => boolean;
export type BitWriter = (addr: BitAddress, value: boolean) => void;

// --- Çalışma zamanı belleği ------------------------------------------------------------------

export interface TimerState {
  type: TimerType;
  /** Geçen süre [ms]. */
  et: number;
  q: boolean;
  prevIn: boolean;
  /** Yalnız TP: darbe sürüyor. */
  running: boolean;
}

export interface CounterState {
  type: CounterType;
  cv: number;
  pv: number;
  q: boolean;
  prevUp: boolean;
  prevDown: boolean;
}

/** Zamanlayıcı/sayıcı ve kenar algılama belleği; scan'ler arasında korunur. */
export interface Runtime {
  timers: TimerState[];
  counters: CounterState[];
  /** Kenar kontaklarının önceki bit değeri (eleman kimliğine göre). */
  edges: Record<string, boolean>;
  /** %MW kelime belleği (Modbus holding register'ları). */
  words: Uint16Array;
}

export function createRuntime(): Runtime {
  return {
    timers: Array.from({ length: FUNC_COUNT }, () => ({ type: 'TON', et: 0, q: false, prevIn: false, running: false })),
    counters: Array.from({ length: FUNC_COUNT }, () => ({
      type: 'CTU',
      cv: 0,
      pv: 0,
      q: false,
      prevUp: false,
      prevDown: false,
    })),
    edges: {},
    words: new Uint16Array(MW_COUNT),
  };
}

const COUNTER_MAX = 32767;
const COUNTER_MIN = -32768;

const counterQ = (c: CounterState) => (c.type === 'CTD' ? c.cv <= 0 : c.cv >= c.pv);

function resetFunc(rt: Runtime, f: FuncAddress): void {
  if (f.area === 'T') {
    const t = rt.timers[f.index]!;
    t.et = 0;
    t.q = false;
    t.running = false;
  } else {
    const c = rt.counters[f.index]!;
    c.cv = 0;
    c.q = counterQ(c);
  }
}

// --- Derleme -------------------------------------------------------------------------------
// Adresler bir kez çözülür, scan sırasında string ayrıştırma yapılmaz.

type CompiledNode =
  | { kind: 'contact'; id: string; addr: BitOperand; contact: ContactType }
  | { kind: 'compare'; id: string; op: CompareOp; a: ValueOperand; b: ValueOperand }
  | { kind: 'series'; id: string; items: CompiledNode[] }
  | { kind: 'parallel'; id: string; branches: CompiledNode[] };

type CompiledOutput =
  | { kind: 'bit'; type: BitCoilType; addr: BitOperand }
  | { kind: 'timer'; type: TimerType; index: number; preset: number; reset?: BitOperand }
  | { kind: 'counter'; type: CounterType; index: number; preset: number; reset?: BitOperand; load?: BitOperand; down?: BitOperand };

interface CompiledNetwork {
  logic: CompiledNode;
  coilId: string;
  out: CompiledOutput;
}

export interface CompiledProgram {
  networks: CompiledNetwork[];
}

const COIL_NAMES: Record<CoilType, string> = {
  coil: 'Bobin',
  ncoil: 'Ters bobin',
  set: 'Set bobini',
  reset: 'Reset bobini',
  TON: 'TON',
  TOF: 'TOF',
  TP: 'TP',
  TONR: 'TONR',
  CTU: 'CTU',
  CTD: 'CTD',
  CTUD: 'CTUD',
};

/** Çıkış adresinin türe uygunluğunu denetler; uygunsa normal biçimini döndürür. */
export function checkOutputAddress(type: CoilType, text: string): string {
  if (isTimer(type) || isCounter(type)) {
    const area = isTimer(type) ? 'T' : 'C';
    const f = parseFunc(text);
    if (!f || f.area !== area) throw new Error(`${COIL_NAMES[type]} adresi ${area}0..${area}${FUNC_COUNT - 1} olmalı`);
    return formatOperand(f);
  }
  if (type === 'reset') {
    const op = parseOperand(text);
    if (op.area === 'I') throw new Error('Reset giriş alanına (%I) yazamaz');
    return formatOperand(op);
  }
  if (parseFunc(text)) throw new Error(`${COIL_NAMES[type]} T/C'ye yazamaz (yalnız reset bobini sıfırlayabilir)`);
  const a = parseAddress(text);
  if (a.area === 'I') throw new Error(`${COIL_NAMES[type]} giriş alanına (%I) yazamaz`);
  return formatOperand(a);
}

function compileOutput(coil: Coil): CompiledOutput {
  const type = coil.type ?? 'coil';
  checkOutputAddress(type, coil.address);
  const optional = (text: string | undefined, what: string) => {
    if (!text) return undefined;
    try {
      return parseOperand(text);
    } catch (e) {
      throw new Error(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (isTimer(type) || isCounter(type)) {
    const preset = coil.preset ?? 0;
    if (!Number.isInteger(preset) || preset < 0 || preset > (isTimer(type) ? 3_600_000 : COUNTER_MAX)) {
      throw new Error(`${coil.address} ön ayar değeri geçersiz: ${coil.preset}`);
    }
    const index = parseFunc(coil.address)!.index;
    if (isTimer(type)) return { kind: 'timer', type, index, preset, reset: type === 'TONR' ? optional(coil.reset, 'R girişi') : undefined };
    return {
      kind: 'counter',
      type,
      index,
      preset,
      reset: type !== 'CTD' ? optional(coil.reset, 'R girişi') : undefined,
      load: type === 'CTD' ? optional(coil.load, 'LD girişi') : undefined,
      down: type === 'CTUD' ? optional(coil.down, 'CD girişi') : undefined,
    };
  }
  return { kind: 'bit', type, addr: parseOperand(coil.address) };
}

export function compileProgram(program: LadderProgram): CompiledProgram {
  const ids = new Set<string>();
  const claim = (id: string) => {
    if (ids.has(id)) throw new Error(`Tekrarlanan eleman kimliği: "${id}"`);
    ids.add(id);
  };

  const compileNode = (node: LadderNode): CompiledNode => {
    claim(node.id);
    switch (node.kind) {
      case 'contact':
        return { kind: 'contact', id: node.id, addr: parseOperand(node.address), contact: node.contact };
      case 'compare':
        if (!COMPARE_OPS.includes(node.op)) throw new Error(`Geçersiz karşılaştırma: "${node.op}"`);
        return { kind: 'compare', id: node.id, op: node.op, a: parseValue(node.a), b: parseValue(node.b) };
      case 'series':
        if (node.items.length === 0) throw new Error(`Boş seri grup: "${node.id}"`);
        return { kind: 'series', id: node.id, items: node.items.map(compileNode) };
      case 'parallel':
        if (node.branches.length === 0) throw new Error(`Boş paralel grup: "${node.id}"`);
        return { kind: 'parallel', id: node.id, branches: node.branches.map(compileNode) };
    }
  };

  return {
    networks: program.networks.map((net) => {
      claim(net.id);
      const logic = compileNode(net.logic);
      claim(net.coil.id);
      return { logic, coilId: net.coil.id, out: compileOutput(net.coil) };
    }),
  };
}

// --- Yürütme -------------------------------------------------------------------------------

interface Ctx {
  read: BitReader;
  rt: Runtime;
  trace: LadderTrace;
}

function readOperand(ctx: Ctx, op: BitOperand): boolean {
  if (!isFunc(op)) return ctx.read(op);
  return op.area === 'T' ? ctx.rt.timers[op.index]!.q : ctx.rt.counters[op.index]!.q;
}

function readValue(ctx: Ctx, op: ValueOperand): number {
  if (op.area === 'K') return op.value;
  if (op.area === 'MW') return ctx.rt.words[op.index]!;
  return op.area === 'T' ? ctx.rt.timers[op.index]!.et : ctx.rt.counters[op.index]!.cv;
}

function compare(op: CompareOp, a: number, b: number): boolean {
  switch (op) {
    case '==':
      return a === b;
    case '<>':
      return a !== b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
  }
}

function evalNode(node: CompiledNode, powerIn: boolean, ctx: Ctx): boolean {
  let powerOut: boolean;
  switch (node.kind) {
    case 'contact': {
      const bit = readOperand(ctx, node.addr);
      let closed: boolean;
      if (node.contact === 'NO') closed = bit;
      else if (node.contact === 'NC') closed = !bit;
      else {
        // Kenar kontağı: önceki scan'deki bit değeriyle karşılaştırılır.
        const prev = ctx.rt.edges[node.id] ?? bit;
        ctx.rt.edges[node.id] = bit;
        closed = node.contact === 'P' ? bit && !prev : !bit && prev;
      }
      powerOut = powerIn && closed;
      ctx.trace[node.id] = { powerIn, powerOut, closed };
      return powerOut;
    }
    case 'compare': {
      const closed = compare(node.op, readValue(ctx, node.a), readValue(ctx, node.b));
      powerOut = powerIn && closed;
      ctx.trace[node.id] = { powerIn, powerOut, closed };
      return powerOut;
    }
    case 'series': {
      let p = powerIn;
      // Kısa devre değerlendirmesi yapılmaz: tüm elemanların durumu izleme için hesaplanır.
      for (const item of node.items) p = evalNode(item, p, ctx);
      powerOut = p;
      break;
    }
    case 'parallel': {
      let any = false;
      for (const branch of node.branches) {
        if (evalNode(branch, powerIn, ctx)) any = true;
      }
      powerOut = any;
      break;
    }
  }
  ctx.trace[node.id] = { powerIn, powerOut };
  return powerOut;
}

function runTimer(t: TimerState, type: TimerType, input: boolean, preset: number, reset: boolean, dt: number): void {
  if (t.type !== type) {
    Object.assign(t, { type, et: 0, q: false, running: false });
  }
  switch (type) {
    case 'TON':
      t.et = input ? (t.prevIn ? Math.min(preset, t.et + dt) : 0) : 0;
      t.q = input && t.et >= preset;
      break;
    case 'TONR':
      if (reset) {
        t.et = 0;
      } else if (input && t.prevIn) {
        t.et = Math.min(preset, t.et + dt);
      }
      // Q, giriş düşse de birikmiş süre ön ayara ulaştıysa 1 kalır (reset'e kadar).
      t.q = preset > 0 ? t.et >= preset : input;
      break;
    case 'TOF':
      if (input) {
        t.et = 0;
        t.q = true;
      } else if (t.q) {
        t.et = t.prevIn ? 0 : Math.min(preset, t.et + dt);
        if (t.et >= preset) t.q = false;
      }
      break;
    case 'TP':
      if (input && !t.prevIn && !t.running) {
        t.running = true;
        t.et = 0;
      } else if (t.running) {
        t.et = Math.min(preset, t.et + dt);
        if (t.et >= preset) t.running = false;
      }
      if (!t.running && !input && t.et >= preset) t.et = 0;
      t.q = t.running;
      break;
  }
  t.prevIn = input;
}

function runCounter(
  c: CounterState,
  type: CounterType,
  input: boolean,
  preset: number,
  reset: boolean,
  load: boolean,
  down: boolean,
): void {
  if (c.type !== type) Object.assign(c, { type, cv: 0 });
  c.pv = preset;
  const up = type === 'CTD' ? false : input;
  const dn = type === 'CTD' ? input : type === 'CTUD' ? down : false;
  if (reset) c.cv = 0;
  else if (load) c.cv = preset;
  else {
    if (up && !c.prevUp && c.cv < COUNTER_MAX) c.cv++;
    if (dn && !c.prevDown && c.cv > COUNTER_MIN) c.cv--;
  }
  c.prevUp = up;
  c.prevDown = dn;
  c.q = counterQ(c);
}

function runOutput(net: CompiledNetwork, power: boolean, ctx: Ctx, write: BitWriter, dt: number): ElementState {
  const out = net.out;
  const bit = (op: BitOperand | undefined) => (op ? readOperand(ctx, op) : false);
  switch (out.kind) {
    case 'bit': {
      const addr = out.addr;
      if (out.type === 'reset') {
        if (power) {
          if (isFunc(addr)) resetFunc(ctx.rt, addr);
          else write(addr, false);
        }
      } else if (!isFunc(addr)) {
        if (out.type === 'coil') write(addr, power);
        else if (out.type === 'ncoil') write(addr, !power);
        else if (power) write(addr, true);
      }
      return { powerIn: power, powerOut: power };
    }
    case 'timer': {
      const t = ctx.rt.timers[out.index]!;
      runTimer(t, out.type, power, out.preset, bit(out.reset), dt);
      return { powerIn: power, powerOut: t.q, value: t.et };
    }
    case 'counter': {
      const c = ctx.rt.counters[out.index]!;
      runCounter(c, out.type, power, out.preset, bit(out.reset), bit(out.load), bit(out.down));
      return { powerIn: power, powerOut: c.q, value: c.cv };
    }
  }
}

/**
 * Programı bir kez çalıştırır: network'ler yukarıdan aşağı, her biri soldan sağa.
 * Bobin yazımı hemen etkilidir; sonraki network'ler yeni değeri görür.
 * `rt` zamanlayıcı/sayıcı belleğidir (yoksa geçici bir bellek kullanılır), `dtMs` önceki
 * scan'den bu yana geçen süredir.
 */
export function executeProgram(
  program: CompiledProgram,
  read: BitReader,
  write: BitWriter,
  rt: Runtime = createRuntime(),
  dtMs = 0,
): LadderTrace {
  const ctx: Ctx = { read, rt, trace: {} };
  for (const net of program.networks) {
    const power = evalNode(net.logic, true, ctx);
    ctx.trace[net.coilId] = runOutput(net, power, ctx, write, dtMs);
  }
  return ctx.trace;
}
