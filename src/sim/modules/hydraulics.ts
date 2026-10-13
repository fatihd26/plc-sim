// Hidrolik devre elemanları: güç ünitesi (pompa + emniyet valfi + tank), 4/3 yön valfi, hidrolik
// silindir ve 3 silindirli ekskavatör kolu.
//
// Model: pompa sabit debi verir (motor hızıyla orantılı). Basınç hattına bağlı aktüatörlerden
// hareket için en az basınç isteyene debi gider (yağ en kolay yolu seçer). Hareket edebilecek
// aktüatör yoksa basınç emniyet valfi ayarına çıkar ve yağ tanka döner (ısınır, motor yüklenir).
// Basınç [bar] = kuvvet [N] / alan [mm²] × 10.  Hız [mm/s] = debi [l/dk] × 10⁶ / 60 / alan [mm²].

import { choice, driveParams, num, paramReader, voltageParam, type Voltage } from '../spec';
import { motorFields, motorFromParams, stepMotor3 } from './drive';
import { defineModule, type HydraulicDemand, type ModuleIo } from './types';

const hy = (...ports: string[]) => Object.fromEntries(ports.map((p) => [p, 'hydraulic' as const]));

/** Pi sabiti (alan hesabı; Math fonksiyonu değil, sabit). */
const PI = 3.141592653589793;
const area = (dMm: number) => (PI * dMm * dMm) / 4;

// --- Güç ünitesi ----------------------------------------------------------------------------

const hpuSpec = {
  type: 'hpu' as const,
  title: 'Hidrolik güç ünitesi',
  prefix: 'P',
  category: 'Hidrolik' as const,
  description:
    '3~ motor (U-V-W) + dişli pompa + emniyet valfi + tank. P basınç hattı, T tank dönüşü. Hiçbir ' +
    'aktüatör hareket edemiyorsa emniyet valfi açar: basınç ayar değerine çıkar, yağ ısınır.',
  terminals: ['U', 'V', 'W', 'P', 'T'],
  domains: hy('P', 'T'),
  params: [
    num('flowLpm', 'Pompa debisi (nominal devirde)', 20, 1, 500, 1, 'l/dk'),
    num('reliefBar', 'Emniyet valfi ayarı', 160, 10, 350, 5, 'bar'),
    ...driveParams(8, 1450),
  ],
};

export const hpuModule = defineModule({
  spec: hpuSpec,
  faults: [
    { key: 'wornPump', label: 'Pompa aşınmış (debi %40)' },
    { key: 'reliefLow', label: 'Emniyet valfi ayarı kaçmış (basınç düşük)' },
  ],
  provides: ['pressure', 'temperature', 'revs'],
  create: (inst) => {
    const p = paramReader(hpuSpec, inst);
    return {
      motor: motorFromParams(p, 15),
      flow: p.num('flowLpm'),
      relief: p.num('reliefBar'),
      pressure: 0,
      reliefOpen: false,
      oilC: 30,
      worn: false,
      reliefLow: false,
    };
  },
  fluidLinks: (d, api) => {
    d.worn = api.fault('wornPump');
    d.reliefLow = api.fault('reliefLow');
    if (Math.abs(d.motor.speed) > 0.05) api.source('P', 'P');
    api.source('T', 'T');
  },
  hydraulicSupply: (d) => ({
    port: 'P',
    flowLpm: d.flow * Math.abs(d.motor.speed) * (d.worn ? 0.4 : 1),
    reliefBar: d.reliefLow ? d.relief * 0.3 : d.relief,
  }),
  update: (d, io, dt, hyd) => {
    stepMotor3(d.motor, io, dt);
    d.pressure = hyd.pressure.P ?? 0;
    d.reliefOpen = (hyd.grants.relief ?? 0) > 0;
    // Motor yükü basınçla artar (hidrolik güç = p × Q).
    d.motor.params.loadPct = 15 + (85 * d.pressure) / d.relief;
    const heat = d.reliefOpen ? 0.004 : 0;
    d.oilC += (heat - (d.oilC - 30) * 0.00002) * dt;
  },
  lineCurrent: (d) => ({ terminals: ['U', 'V', 'W'], currentA: d.motor.currentA }),
  measure: (d, q) => (q === 'pressure' ? d.pressure : q === 'temperature' ? d.oilC : q === 'revs' ? d.motor.revs : null),
  state: (d) => ({
    type: 'hpu' as const,
    ...motorFields(d.motor),
    pressure: d.pressure,
    flow: d.flow * Math.abs(d.motor.speed),
    reliefOpen: d.reliefOpen,
    relief: d.relief,
    oilC: d.oilC,
  }),
  signals: (s) => ({
    basinc: { label: 'Sistem basıncı', value: s.pressure, unit: 'bar' },
    debi: { label: 'Pompa debisi', value: s.flow, unit: 'l/dk' },
    emniyet: { label: 'Emniyet valfi açık', value: s.reliefOpen },
    yag: { label: 'Yağ sıcaklığı', value: s.oilC, unit: '°C' },
    akim: { label: 'Motor akımı', value: s.currentA, unit: 'A' },
  }),
});

// --- 4/3 yön valfi --------------------------------------------------------------------------

const v43Spec = {
  type: 'valve43' as const,
  title: '4/3 hidrolik yön valfi',
  prefix: 'Y',
  category: 'Hidrolik' as const,
  description:
    'Y1 (A1-A2): P→A, B→T. Y2 (B1-B2): P→B, A→T. Bobin yokken orta konum: kapalı (hepsi kapalı, yük tutulur), ' +
    'tandem (P→T, pompa boşta) veya yüzer (A ve B tanka açık).',
  terminals: ['A1', 'A2', 'B1', 'B2', 'P', 'T', 'A', 'B'],
  domains: hy('P', 'T', 'A', 'B'),
  params: [
    voltageParam('coilVoltage', 'Bobin gerilimi'),
    choice('center', 'Orta konum', 'closed', [
      ['closed', 'Kapalı merkez'],
      ['tandem', 'Tandem (P→T)'],
      ['float', 'Yüzer (A, B → T)'],
    ]),
  ],
};

export const valve43Module = defineModule({
  spec: v43Spec,
  faults: [
    { key: 'coil', label: 'Bobinler yanık' },
    { key: 'stuck', label: 'Sürgü sıkışmış' },
  ],
  create: (inst) => {
    const p = paramReader(v43Spec, inst);
    return {
      voltage: p.str('coilVoltage') as Voltage,
      center: p.str('center'),
      pos: 'center' as 'a' | 'b' | 'center',
      y1: false,
      y2: false,
      fault: null as string | null,
    };
  },
  fluidLinks: (d, api) => {
    if (d.pos === 'a') {
      api.link('P', 'A');
      api.link('B', 'T');
    } else if (d.pos === 'b') {
      api.link('P', 'B');
      api.link('A', 'T');
    } else if (d.center === 'tandem') api.link('P', 'T');
    else if (d.center === 'float') {
      api.link('A', 'T');
      api.link('B', 'T');
    }
  },
  update: (d, io) => {
    const r1 = io.load(d.voltage, 'A1', 'A2');
    const r2 = io.load(d.voltage, 'B1', 'B2');
    d.fault = r1.fault ?? r2.fault;
    d.y1 = r1.on && !io.fault('coil');
    d.y2 = r2.on && !io.fault('coil');
    if (!io.fault('stuck')) d.pos = d.y1 && !d.y2 ? 'a' : d.y2 && !d.y1 ? 'b' : 'center';
  },
  state: (d) => ({ type: 'valve43' as const, pos: d.pos, y1: d.y1, y2: d.y2, center: d.center, fault: d.fault }),
  signals: (s) => ({
    y1: { label: 'Y1 (P→A)', value: s.y1 },
    y2: { label: 'Y2 (P→B)', value: s.y2 },
  }),
});

// --- Hidrolik silindir ----------------------------------------------------------------------

/** Silindir odası talepleri: ileri (A basınç, B tank) ve geri (B basınç, A tank). */
function cylinderDemands(
  id: string,
  ports: [string, string],
  pos: number,
  extendBar: number,
  retractBar: number,
): HydraulicDemand[] {
  const out: HydraulicDemand[] = [];
  if (pos < 1) out.push({ id: `${id}+`, inlet: ports[0], outlet: ports[1], pressureBar: extendBar, maxFlowLpm: Infinity });
  if (pos > 0) out.push({ id: `${id}-`, inlet: ports[1], outlet: ports[0], pressureBar: retractBar, maxFlowLpm: Infinity });
  return out;
}

const hydCylSpec = {
  type: 'hydCylinder' as const,
  title: 'Hidrolik silindir',
  prefix: 'Z',
  category: 'Hidrolik' as const,
  description:
    'Çift etkili: A (piston tarafı) basınçlıyken ileri, B (mil tarafı) basınçlıyken geri. Hız debi/alan, ' +
    'gereken basınç yük/alan. Sensörler: 13-14 geride, 23-24 ileride.',
  terminals: ['A', 'B', '13', '14', '23', '24'],
  domains: hy('A', 'B'),
  params: [
    num('boreMm', 'Piston çapı', 50, 10, 300, 1, 'mm'),
    num('rodMm', 'Mil çapı', 28, 5, 250, 1, 'mm'),
    num('strokeMm', 'Strok', 300, 10, 3000, 10, 'mm'),
    num('loadKN', 'Yük (ileri harekete karşı, − = yardımcı)', 10, -200, 500, 1, 'kN'),
  ],
};

export const hydCylinderModule = defineModule({
  spec: hydCylSpec,
  faults: [
    { key: 'bypass', label: 'Piston contası kaçırıyor (yük altında kayar)' },
    { key: 'reedFront', label: 'Ön sensör (23-24) arızalı' },
  ],
  provides: ['probe', 'position'],
  create: (inst) => {
    const p = paramReader(hydCylSpec, inst);
    const bore = p.num('boreMm');
    const rod = Math.min(p.num('rodMm'), bore - 2);
    return {
      aPiston: area(bore),
      aRing: area(bore) - area(rod),
      stroke: p.num('strokeMm'),
      loadN: p.num('loadKN') * 1000,
      pos: 0,
      speed: 0,
      pressure: 0,
    };
  },
  links: (d, net) => {
    if (d.pos <= 0.01) net.link('13', '14');
    if (d.pos >= 0.99 && !net.fault('reedFront')) net.link('23', '24');
  },
  hydraulicDemands: (d) =>
    cylinderDemands(
      'z',
      ['A', 'B'],
      d.pos,
      Math.max(5, (d.loadN / d.aPiston) * 10),
      Math.max(5, (-d.loadN / d.aRing) * 10),
    ),
  update: (d, io, dt, hyd) => {
    const ext = hyd.grants['z+'] ?? 0;
    const ret = hyd.grants['z-'] ?? 0;
    const mmPerS = (q: number, a: number) => (q * 1e6) / 60 / a;
    let v = mmPerS(ext, d.aPiston) - mmPerS(ret, d.aRing);
    // Conta kaçağı: yük altında silindir kendiliğinden geri kayar.
    if (io.fault('bypass') && v === 0 && d.loadN > 0) v = -5;
    d.speed = v;
    d.pressure = hyd.pressure['z+'] ?? hyd.pressure['z-'] ?? 0;
    d.pos = Math.max(0, Math.min(1, d.pos + (v * dt) / 1000 / d.stroke));
  },
  probe: (d, at) => Math.abs(d.pos - at) <= 0.03,
  measure: (d, q) => (q === 'position' ? d.pos * d.stroke : null),
  state: (d) => ({
    type: 'hydCylinder' as const,
    pos: d.pos,
    mm: d.pos * d.stroke,
    speed: d.speed,
    pressure: d.pressure,
    retracted: d.pos <= 0.01,
    extended: d.pos >= 0.99,
  }),
  signals: (s) => ({
    konum: { label: 'Konum', value: s.mm, unit: 'mm' },
    hiz: { label: 'Hız', value: s.speed, unit: 'mm/s' },
    geride: { label: 'Geride (13-14)', value: s.retracted },
    ileride: { label: 'İleride (23-24)', value: s.extended },
  }),
});

// --- Ekskavatör kolu ------------------------------------------------------------------------
//
// Üç silindir: bom (kaldırma), arm (uzatma), kova (kapama). Her biri bir 4/3 valfle sürülür.
// Konumlar 0..1: bom 0 = aşağı, arm 0 = içeride, kova 0 = açık (boşaltma). Kazı: bom aşağıda ve
// arm dışarıdayken kova kapanırsa kova dolar. Boşaltma: bom yukarıdayken kova açılırsa sayılır.
// Sınır sensörleri PNP (L+ / M beslemeli).

const SENSORS = ['BU', 'BD', 'AE', 'AR', 'KC', 'KO'] as const;

const excSpec = {
  type: 'excavator' as const,
  title: 'Ekskavatör kolu (kepçe)',
  prefix: 'Z',
  category: 'Hidrolik' as const,
  description:
    '3 hidrolik silindir: bom A1/B1 (A1 = kaldır), arm A2/B2 (A2 = uzat), kova A3/B3 (A3 = kapat/kaz). ' +
    'PNP sınır sensörleri (L+ / M): BU bom yukarı, BD bom aşağı, AE arm dışarı, AR arm içeri, KC kova kapalı, ' +
    'KO kova açık. Bom aşağıda + arm dışarıdayken kova kapanırsa kova dolar; bom yukarıda kova açılınca boşaltılır.',
  terminals: ['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'L+', 'M', ...SENSORS],
  domains: hy('A1', 'B1', 'A2', 'B2', 'A3', 'B3'),
  params: [
    num('boomBar', 'Bom kaldırma basıncı (boş)', 90, 5, 300, 5, 'bar'),
    num('armBar', 'Arm hareket basıncı', 60, 5, 300, 5, 'bar'),
    num('bucketBar', 'Kova kapama basıncı', 50, 5, 300, 5, 'bar'),
    num('loadBar', 'Dolu kova ek basıncı', 40, 0, 200, 5, 'bar'),
    num('boomL', 'Bom silindir hacmi', 3, 0.1, 50, 0.1, 'l'),
    num('armL', 'Arm silindir hacmi', 2.5, 0.1, 50, 0.1, 'l'),
    num('bucketL', 'Kova silindir hacmi', 1.5, 0.1, 50, 0.1, 'l'),
  ],
};

type Joint = { pos: number; volL: number; bar: number; ports: [string, string] };

export const excavatorModule = defineModule({
  spec: excSpec,
  faults: [
    { key: 'boomDrift', label: 'Bom silindiri kaçırıyor (yük altında iner)' },
    { key: 'sensorBU', label: 'BU sensörü arızalı' },
  ],
  create: (inst) => {
    const p = paramReader(excSpec, inst);
    const j = (volL: number, bar: number, a: string, b: string, pos: number): Joint => ({ pos, volL, bar, ports: [a, b] });
    return {
      boom: j(p.num('boomL'), p.num('boomBar'), 'A1', 'B1', 0.6),
      arm: j(p.num('armL'), p.num('armBar'), 'A2', 'B2', 0.3),
      bucket: j(p.num('bucketL'), p.num('bucketBar'), 'A3', 'B3', 0.3),
      loadBar: p.num('loadBar'),
      full: false,
      dumped: 0,
      powered: false,
      pressure: 0,
    };
  },
  links: (d, net) => {
    if (!d.powered) return;
    const on: Record<(typeof SENSORS)[number], boolean> = {
      BU: d.boom.pos >= 0.95 && !net.fault('sensorBU'),
      BD: d.boom.pos <= 0.05,
      AE: d.arm.pos >= 0.95,
      AR: d.arm.pos <= 0.05,
      KC: d.bucket.pos >= 0.95,
      KO: d.bucket.pos <= 0.05,
    };
    for (const s of SENSORS) if (on[s]) net.source(s, 'P24');
  },
  hydraulicDemands: (d) => {
    const extra = d.full ? d.loadBar : 0;
    return [
      ...cylinderDemands('boom', d.boom.ports, d.boom.pos, d.boom.bar + extra, 10),
      ...cylinderDemands('arm', d.arm.ports, d.arm.pos, d.arm.bar + extra / 2, d.arm.bar / 2),
      ...cylinderDemands('bucket', d.bucket.ports, d.bucket.pos, d.bucket.bar, 10),
    ];
  },
  update: (d, io: ModuleIo, dt, hyd) => {
    d.powered = io.powered24('L+', 'M');
    const move = (j: Joint, id: string) => {
      const q = (hyd.grants[`${id}+`] ?? 0) - (hyd.grants[`${id}-`] ?? 0);
      const before = j.pos;
      j.pos = Math.max(0, Math.min(1, j.pos + (q * dt) / 60_000 / j.volL));
      return j.pos - before;
    };
    move(d.boom, 'boom');
    move(d.arm, 'arm');
    const db = move(d.bucket, 'bucket');
    if (io.fault('boomDrift')) d.boom.pos = Math.max(0, d.boom.pos - dt / 60_000);
    // Kazı ve boşaltma
    if (db > 0 && d.boom.pos < 0.2 && d.arm.pos > 0.6 && d.bucket.pos > 0.7 && !d.full) d.full = true;
    if (db < 0 && d.full && d.bucket.pos < 0.2) {
      d.full = false;
      if (d.boom.pos > 0.6) d.dumped++;
      else io.event('kova yerde boşaltıldı (malzeme döküldü)');
    }
    d.pressure = Math.max(0, ...Object.values(hyd.pressure));
  },
  command: (d, action) => {
    if (action === 'empty') d.full = false;
  },
  state: (d) => ({
    type: 'excavator' as const,
    boom: d.boom.pos,
    arm: d.arm.pos,
    bucket: d.bucket.pos,
    full: d.full,
    dumped: d.dumped,
    pressure: d.pressure,
  }),
  signals: (s) => ({
    bom: { label: 'Bom', value: s.boom * 100, unit: '%' },
    arm: { label: 'Arm', value: s.arm * 100, unit: '%' },
    kova: { label: 'Kova', value: s.bucket * 100, unit: '%' },
    dolu: { label: 'Kova dolu', value: s.full },
    bosaltilan: { label: 'Boşaltılan kova', value: s.dumped },
    basinc: { label: 'Basınç', value: s.pressure, unit: 'bar' },
  }),
});
