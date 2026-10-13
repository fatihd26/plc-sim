// Pnömatik devre elemanları (ISO 1219 port numaraları): hava kaynağı, selenoid valfler, silindirler
// ve kısma valfi. Elemanlar hortumla (pnömatik kablo) birbirine bağlanır; çözücü her hattın basınçlı
// (P), tahliyede (T, atmosfer) veya kapalı (hapsolmuş hava) olduğunu bulur.
//
// Valf portları: 1 = basınç girişi, 2 / 4 = çıkışlar, 3 / 5 = egzoz (valf içinde atmosfere açık,
// çizimde üçgen). Bağlantısız silindir portu atmosfere açıktır.

import { num, paramReader, voltageParam, type ComponentSpec, type Voltage } from '../spec';
import { defineModule, type FluidNet, type ModuleIo } from './types';

const pn = (...ports: string[]) => Object.fromEntries(ports.map((p) => [p, 'pneumatic' as const]));

// --- Hava kaynağı ---------------------------------------------------------------------------

const supplySpec = {
  type: 'airSupply' as const,
  title: 'Basınçlı hava kaynağı',
  prefix: 'P',
  category: 'Pnömatik' as const,
  description: 'Kompresör + şartlandırıcı (filtre, regülatör). Port 1 basınçlı hava verir.',
  terminals: ['1'],
  domains: pn('1'),
  params: [num('pressureBar', 'Çalışma basıncı', 6, 1, 10, 0.5, 'bar')],
};

export const airSupplyModule = defineModule({
  spec: supplySpec,
  faults: [{ key: 'off', label: 'Kompresör çalışmıyor (basınç yok)' }],
  provides: ['pressure'],
  create: (inst) => ({ bar: paramReader(supplySpec, inst).num('pressureBar'), on: true }),
  fluidLinks: (d, api) => {
    if (d.on && !api.fault('off')) api.source('1', 'P');
  },
  update: (d, io) => {
    d.on = !io.fault('off');
  },
  command: (d, action) => {
    if (action === 'toggle') d.on = !d.on;
  },
  measure: (d, q) => (q === 'pressure' ? (d.on ? d.bar : 0) : null),
  state: (d) => ({ type: 'airSupply' as const, on: d.on, bar: d.bar }),
  signals: (s) => ({ basinc: { label: 'Basınç', value: s.on ? s.bar : 0, unit: 'bar' } }),
});

// --- Selenoid valfler -----------------------------------------------------------------------

type Pos = 'a' | 'b' | 'center';

interface ValveData {
  voltage: Voltage;
  pos: Pos;
  y1: boolean;
  y2: boolean;
  manual: boolean;
  fault: string | null;
}

const valveFaults = [
  { key: 'coil', label: 'Bobin yanık (çekmiyor)' },
  { key: 'stuck', label: 'Sürgü sıkışmış (konum değişmiyor)' },
];

function valveSpec<T extends string>(type: T, title: string, description: string, coils: number, ports: string[]): ComponentSpec<T> {
  const electric = coils === 2 ? ['A1', 'A2', 'B1', 'B2'] : ['A1', 'A2'];
  return {
    type,
    title,
    prefix: 'Y',
    category: 'Pnömatik',
    description,
    terminals: [...electric, ...ports],
    domains: pn(...ports),
    params: [voltageParam('coilVoltage', 'Bobin gerilimi')],
  };
}

function readCoils(d: ValveData, io: ModuleIo, two: boolean): void {
  const r1 = io.load(d.voltage, 'A1', 'A2');
  const r2 = two ? io.load(d.voltage, 'B1', 'B2') : { on: false, fault: null };
  d.fault = r1.fault ?? r2.fault;
  d.y1 = (r1.on || d.manual) && !io.fault('coil');
  d.y2 = r2.on && !io.fault('coil');
}

const valveState = <T extends string>(type: T, d: ValveData) => ({
  type,
  pos: d.pos,
  y1: d.y1,
  y2: d.y2,
  pressed: d.manual,
  fault: d.fault,
});

const valveSignals = (s: { y1: boolean; y2: boolean; pos: Pos }) => ({
  y1: { label: 'Bobin Y1 (A1-A2)', value: s.y1 },
  y2: { label: 'Bobin Y2 (B1-B2)', value: s.y2 },
  konum: { label: 'Sürgü konumu (a = 1→4)', value: s.pos === 'a' },
});

const newValve = (inst: { params?: Record<string, number | string> }, spec: ComponentSpec): ValveData => ({
  voltage: paramReader(spec, inst).str('coilVoltage') as Voltage,
  pos: 'b',
  y1: false,
  y2: false,
  manual: false,
  fault: null,
});

/** 5/2 konumlarında bağlantılar: a = 1→4, 2 egzoz; b = 1→2, 4 egzoz. */
function links52(pos: Pos, api: { link(a: string, b: string): void; source(t: string, p: 'P' | 'T'): void }) {
  if (pos === 'a') {
    api.link('1', '4');
    api.source('2', 'T');
  } else if (pos === 'b') {
    api.link('1', '2');
    api.source('4', 'T');
  }
}

const v52Spec = valveSpec(
  'valve52',
  '5/2 selenoid valf (yay dönüşlü)',
  'Monostabil: Y1 (A1-A2) enerjiliyken 1→4, 2 egzoz; enerji kesilince yay 1→2 konumuna döndürür. ' +
    'Simülasyonda gövdeye basılı tutmak elle kumandadır.',
  1,
  ['1', '2', '4'],
);

export const valve52Module = defineModule({
  spec: v52Spec,
  faults: valveFaults,
  create: (inst): ValveData => newValve(inst, v52Spec),
  fluidLinks: (d, api) => links52(d.pos, api),
  update: (d, io) => {
    readCoils(d, io, false);
    if (!io.fault('stuck')) d.pos = d.y1 ? 'a' : 'b';
  },
  command: (d, action, value) => {
    if (action === 'press') d.manual = !!value;
  },
  state: (d) => valveState('valve52' as const, d),
  signals: (s) => valveSignals(s),
});

const v52biSpec = valveSpec(
  'valve52bi',
  '5/2 selenoid valf (çift bobinli, hafızalı)',
  'Bistabil: Y1 (A1-A2) darbesi 1→4 konumuna, Y2 (B1-B2) darbesi 1→2 konumuna geçirir; enerji kesilince ' +
    'son konumda kalır (hafıza).',
  2,
  ['1', '2', '4'],
);

export const valve52biModule = defineModule({
  spec: v52biSpec,
  faults: valveFaults,
  create: (inst): ValveData => newValve(inst, v52biSpec),
  fluidLinks: (d, api) => links52(d.pos, api),
  update: (d, io) => {
    readCoils(d, io, true);
    if (io.fault('stuck')) return;
    if (d.y1 && !d.y2) d.pos = 'a';
    else if (d.y2 && !d.y1) d.pos = 'b';
  },
  state: (d) => valveState('valve52bi' as const, d),
  signals: (s) => valveSignals(s),
});

const v53Spec = valveSpec(
  'valve53',
  '5/3 selenoid valf (orta konum kapalı)',
  'Y1 (A1-A2): 1→4, 2 egzoz. Y2 (B1-B2): 1→2, 4 egzoz. Bobin yokken yaylar ortalar: tüm portlar kapalı, ' +
    'silindir olduğu yerde durur.',
  2,
  ['1', '2', '4'],
);

export const valve53Module = defineModule({
  spec: v53Spec,
  faults: valveFaults,
  create: (inst): ValveData => ({ ...newValve(inst, v53Spec), pos: 'center' }),
  fluidLinks: (d, api) => links52(d.pos, api),
  update: (d, io) => {
    readCoils(d, io, true);
    if (!io.fault('stuck')) d.pos = d.y1 && !d.y2 ? 'a' : d.y2 && !d.y1 ? 'b' : 'center';
  },
  state: (d) => valveState('valve53' as const, d),
  signals: (s) => valveSignals(s),
});

const v32Spec = valveSpec(
  'valve32',
  '3/2 selenoid valf (normalde kapalı)',
  'Y1 (A1-A2) enerjiliyken 1→2 (basınç verir); enerjisizken 1 kapalı, 2 egzoza açık. Tek etkili silindir ' +
    've vakum ejektörü için.',
  1,
  ['1', '2'],
);

export const valve32Module = defineModule({
  spec: v32Spec,
  faults: valveFaults,
  create: (inst): ValveData => newValve(inst, v32Spec),
  fluidLinks: (d, api) => {
    if (d.pos === 'a') api.link('1', '2');
    else api.source('2', 'T');
  },
  update: (d, io) => {
    readCoils(d, io, false);
    if (!io.fault('stuck')) d.pos = d.y1 ? 'a' : 'b';
  },
  command: (d, action, value) => {
    if (action === 'press') d.manual = !!value;
  },
  state: (d) => valveState('valve32' as const, d),
  signals: (s) => valveSignals(s),
});

// --- Kısma valfi ----------------------------------------------------------------------------

const throttleSpec = {
  type: 'throttleCheck' as const,
  title: 'Tek yönlü akış kontrol valfi',
  prefix: 'V',
  category: 'Pnömatik' as const,
  description:
    'Kısma + çek valf (silindir portuna takılır, egzozu kısar). Bu hattan tahliye olan silindirin hızı ' +
    'açıklık oranında düşer; hava girişi serbesttir.',
  terminals: ['1', '2'],
  domains: pn('1', '2'),
  params: [num('openPct', 'Kısma açıklığı', 50, 5, 100, 5, '%')],
};

export const throttleModule = defineModule({
  spec: throttleSpec,
  create: (inst) => ({ open: paramReader(throttleSpec, inst).num('openPct') / 100 }),
  fluidLinks: (d, api) => {
    api.link('1', '2');
    api.restrict('2', d.open);
  },
  command: (d, action, value) => {
    if (action === 'set' && value !== undefined) d.open = Math.max(0.05, Math.min(1, value / 100));
  },
  state: (d) => ({ type: 'throttleCheck' as const, open: d.open }),
  signals: (s) => ({ aciklik: { label: 'Açıklık', value: s.open * 100, unit: '%' } }),
});

// --- Silindirler ----------------------------------------------------------------------------

/** Silindir portunun durumu: bağlantısız port atmosfere açık; kısa devre (P↔T kaçak) basınçsız sayılır. */
function port(io: ModuleIo, t: string): FluidNet {
  if (!io.wired(t)) return 'T';
  const f = io.fluid(t);
  return f === 'short' ? 'T' : f;
}

const reeds = (d: { pos: number }, net: { link(a: string, b: string): void; fault(k: string): boolean }) => {
  if (d.pos <= 0.03 && !net.fault('reedRear')) net.link('13', '14');
  if (d.pos >= 0.97 && !net.fault('reedFront')) net.link('23', '24');
};

const cylFaults = [
  { key: 'stuck', label: 'Piston sıkışmış' },
  { key: 'leak', label: 'Conta kaçırıyor (yavaş hareket)' },
  { key: 'reedRear', label: 'Arka sensör (13-14) arızalı' },
  { key: 'reedFront', label: 'Ön sensör (23-24) arızalı' },
];

const cylSignals = (s: { pos: number; retracted: boolean; extended: boolean }) => ({
  konum: { label: 'Piston konumu', value: s.pos * 100, unit: '%' },
  geride: { label: 'Geride (13-14)', value: s.retracted },
  ileride: { label: 'İleride (23-24)', value: s.extended },
});

const cylState = <T extends string>(type: T, d: { pos: number; moving: -1 | 0 | 1 }) => ({
  type,
  pos: d.pos,
  moving: d.moving,
  retracted: d.pos <= 0.03,
  extended: d.pos >= 0.97,
});

const doubleSpec = {
  type: 'cylDouble' as const,
  title: 'Çift etkili pnömatik silindir',
  prefix: 'Z',
  category: 'Pnömatik' as const,
  description:
    'A portu (arka) basınçlı, B portu (ön) tahliyedeyken ileri; tersinde geri gider. Her iki port kapalıysa ' +
    'durur. Manyetik sensörler: 13-14 geride, 23-24 ileride kapanır.',
  terminals: ['A', 'B', '13', '14', '23', '24'],
  domains: pn('A', 'B'),
  params: [
    num('extendMs', 'İleri gitme süresi (kısmasız)', 800, 50, 20_000, 50, 'ms'),
    num('retractMs', 'Geri dönme süresi (kısmasız)', 700, 50, 20_000, 50, 'ms'),
  ],
};

export const cylDoubleModule = defineModule({
  spec: doubleSpec,
  faults: cylFaults,
  provides: ['probe', 'position'],
  create: (inst) => {
    const p = paramReader(doubleSpec, inst);
    return { extendMs: p.num('extendMs'), retractMs: p.num('retractMs'), pos: 0, moving: 0 as -1 | 0 | 1 };
  },
  links: (d, net) => reeds(d, net),
  update: (d, io, dt) => {
    const a = port(io, 'A');
    const b = port(io, 'B');
    let dir: -1 | 0 | 1 = 0;
    if (a === 'P' && b === 'T') dir = 1;
    else if (b === 'P' && a === 'T') dir = -1;
    if (io.fault('stuck')) dir = 0;
    const exhaust = dir > 0 ? 'B' : 'A';
    const factor = (io.wired(exhaust) ? io.restriction(exhaust) : 1) * (io.fault('leak') ? 0.3 : 1);
    const time = dir > 0 ? d.extendMs : d.retractMs;
    const next = Math.max(0, Math.min(1, d.pos + (dir * factor * dt) / time));
    d.moving = next !== d.pos ? dir : 0;
    d.pos = next;
  },
  probe: (d, at) => Math.abs(d.pos - at) <= 0.04,
  measure: (d, q) => (q === 'position' ? d.pos * 100 : null),
  state: (d) => cylState('cylDouble' as const, d),
  signals: (s) => cylSignals(s),
});

const singleSpec = {
  type: 'cylSingle' as const,
  title: 'Tek etkili pnömatik silindir',
  prefix: 'Z',
  category: 'Pnömatik' as const,
  description:
    'A portu basınçlıyken ileri gider; A tahliyeye açılınca yay geri getirir. Sensörler: 13-14 geride, 23-24 ileride.',
  terminals: ['A', '13', '14', '23', '24'],
  domains: pn('A'),
  params: [
    num('extendMs', 'İleri gitme süresi', 600, 50, 20_000, 50, 'ms'),
    num('retractMs', 'Yayla geri dönme süresi', 900, 50, 20_000, 50, 'ms'),
  ],
};

export const cylSingleModule = defineModule({
  spec: singleSpec,
  faults: cylFaults,
  provides: ['probe', 'position'],
  create: (inst) => {
    const p = paramReader(singleSpec, inst);
    return { extendMs: p.num('extendMs'), retractMs: p.num('retractMs'), pos: 0, moving: 0 as -1 | 0 | 1 };
  },
  links: (d, net) => reeds(d, net),
  update: (d, io, dt) => {
    const a = port(io, 'A');
    let dir: -1 | 0 | 1 = a === 'P' ? 1 : a === 'T' ? -1 : 0;
    if (io.fault('stuck')) dir = 0;
    const factor = (dir < 0 && io.wired('A') ? io.restriction('A') : 1) * (io.fault('leak') ? 0.3 : 1);
    const time = dir > 0 ? d.extendMs : d.retractMs;
    const next = Math.max(0, Math.min(1, d.pos + (dir * factor * dt) / time));
    d.moving = next !== d.pos ? dir : 0;
    d.pos = next;
  },
  probe: (d, at) => Math.abs(d.pos - at) <= 0.04,
  measure: (d, q) => (q === 'position' ? d.pos * 100 : null),
  state: (d) => cylState('cylSingle' as const, d),
  signals: (s) => cylSignals(s),
});
