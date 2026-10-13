// Konumlama ve robotik: motorlu lineer eksen (enkoder + HSC), elektro-pnömatik pick & place,
// el sıkışmalı robot hücresi; klasik PLC alıştırmaları: 3 katlı asansör ve garaj kapısı.
//
// Sensör çıkışları PNP'dir (modülün L+ / M beslemesiyle) ve PLC girişine doğrudan bağlanır.
// Valf bobinleri (pick & place) yük sayılır: PLC çıkışından röle üzerinden sürülür.

import { driveParams, num, paramReader, voltageParam, type Voltage } from '../spec';
import { motorFields, motorFromParams, stepMotor3 } from './drive';
import { quadrature } from './sensors';
import { defineModule, type LinkApi } from './types';

const pnp = (net: LinkApi, powered: boolean, outs: Record<string, boolean>) => {
  if (!powered) return;
  for (const [t, on] of Object.entries(outs)) if (on) net.source(t, 'P24');
};

// --- Lineer eksen ---------------------------------------------------------------------------

const axisSpec = {
  type: 'linearAxis' as const,
  title: 'Lineer eksen (vidalı mil + enkoder)',
  prefix: 'M',
  category: 'Robotik' as const,
  description:
    '3~ motorlu (U-V-W, VFD ile hız ayarlı da olabilir) taşıyıcı. Enkoder A/B (HSC için I0.0/I0.1), referans ' +
    '(REF, home) sensörü, LSN / LSP sınır sensörleri (NC mantık: sınırda değilken +24 V). Uçlarda mekanik ' +
    'dayanak: taşıyıcı çarparsa motor kilitlenir.',
  terminals: ['U', 'V', 'W', 'L+', 'M', 'A', 'B', 'REF', 'LSN', 'LSP'],
  params: [
    num('lengthMm', 'Eksen boyu', 1000, 100, 5000, 10, 'mm'),
    num('speedMm', 'Nominal hızda taşıyıcı hızı', 100, 5, 2000, 5, 'mm/s'),
    num('pulsesPerMm', 'Enkoder çözünürlüğü', 2, 0.1, 100, 0.1, 'darbe/mm'),
    num('refMm', 'Referans sensörü konumu', 50, 0, 5000, 1, 'mm'),
    num('startMm', 'Başlangıç konumu', 500, 0, 5000, 1, 'mm'),
    ...driveParams(1.5, 1400),
  ],
};

export const linearAxisModule = defineModule({
  spec: axisSpec,
  faults: [
    { key: 'encoder', label: 'Enkoder arızalı (darbe yok)' },
    { key: 'coupling', label: 'Kaplin kaymış (motor döner, taşıyıcı gitmez)' },
    { key: 'lsp', label: 'LSP sınır sensörü arızalı' },
  ],
  provides: ['probe', 'position', 'revs'],
  create: (inst) => {
    const p = paramReader(axisSpec, inst);
    const length = p.num('lengthMm');
    return {
      src: inst.id,
      motor: motorFromParams(p, 40),
      length,
      speed: p.num('speedMm'),
      ppm: p.num('pulsesPerMm'),
      ref: p.num('refMm'),
      x: Math.min(length, p.num('startMm')),
      powered: false,
      crashed: false,
    };
  },
  links: (d, net) => {
    const pos = Math.floor(d.x * d.ppm);
    const q = quadrature(pos);
    const enc = !net.fault('encoder');
    pnp(net, d.powered, {
      A: enc && q.a,
      B: enc && q.b,
      REF: Math.abs(d.x - d.ref) <= 3,
      LSN: d.x > 10,
      LSP: d.x < d.length - 10 || net.fault('lsp'),
    });
  },
  drive: (d, out) => {
    const powered = out.potential('L+') === 'P24' && out.potential('M') === 'M0';
    if (!powered || out.fault('encoder')) return;
    const pos = Math.floor(d.x * d.ppm);
    out.drive('A', { kind: 'pulse', pos, src: d.src });
    out.drive('B', { kind: 'pulse', pos, src: d.src });
  },
  update: (d, io, dt) => {
    d.powered = io.powered24('L+', 'M');
    const atEnd = (d.x <= 0 && d.motor.direction < 0) || (d.x >= d.length && d.motor.direction > 0);
    stepMotor3(d.motor, io, dt, { locked: atEnd && d.motor.powered });
    if (atEnd && d.motor.powered && !d.crashed) io.event('taşıyıcı mekanik dayanağa çarptı (motor kilitlendi)');
    d.crashed = atEnd && d.motor.powered;
    if (!io.fault('coupling')) d.x = Math.max(0, Math.min(d.length, d.x + (d.motor.speed * d.speed * dt) / 1000));
  },
  lineCurrent: (d) => ({ terminals: ['U', 'V', 'W'], currentA: d.motor.currentA }),
  probe: (d, at) => Math.abs(d.x / d.length - at) <= 0.02,
  measure: (d, q) => (q === 'position' ? d.x : q === 'revs' ? d.motor.revs : null),
  state: (d) => ({
    type: 'linearAxis' as const,
    ...motorFields(d.motor),
    x: d.x,
    length: d.length,
    ref: d.ref,
    pulses: Math.floor(d.x * d.ppm),
    crashed: d.crashed,
  }),
  signals: (s) => ({
    konum: { label: 'Taşıyıcı konumu', value: s.x, unit: 'mm' },
    darbe: { label: 'Enkoder darbesi', value: s.pulses },
    hiz: { label: 'Motor hızı', value: s.rpm, unit: 'dev/dk' },
    referans: { label: 'REF sensörü', value: Math.abs(s.x - s.ref) <= 3 },
  }),
});

// --- Pick & place ---------------------------------------------------------------------------
//
// Elektro-pnömatik portal: X ekseni (YX enerjili → yerleştirme tarafına), Z ekseni (YZ enerjili →
// aşağı), tutucu (YG enerjili → kapalı). Bobinler YX/YZ/YG ile M arasında (24 V DC). Sensörler:
// X0 alma tarafında, X1 yerleştirme tarafında, Z0 yukarıda, Z1 aşağıda, GP parça tutucuda,
// PS alma noktasında parça var.

const ppSpec = {
  type: 'pickPlace' as const,
  title: 'Pick & place (elektro-pnömatik)',
  prefix: 'U',
  category: 'Robotik' as const,
  description:
    'İki eksenli pnömatik portal + tutucu. Bobinler (M\'ye göre): YX yerleştirmeye git, YZ aşağı in, YG tutucuyu kapat. ' +
    'PNP sensörler (L+ / M): X0 alma, X1 yerleştirme, Z0 yukarı, Z1 aşağı, GP parça tutucuda, PS alma noktasında parça. ' +
    'Z aşağıdayken X hareketi çarpışmadır.',
  terminals: ['YX', 'YZ', 'YG', 'L+', 'M', 'X0', 'X1', 'Z0', 'Z1', 'GP', 'PS'],
  params: [
    voltageParam('coilVoltage', 'Valf bobin gerilimi'),
    num('xMs', 'X hareket süresi', 1500, 100, 20_000, 50, 'ms'),
    num('zMs', 'Z hareket süresi', 600, 100, 20_000, 50, 'ms'),
    num('gripMs', 'Tutucu kapanma süresi', 250, 50, 5000, 50, 'ms'),
    num('feedS', 'Otomatik parça besleme (0 = elle)', 3, 0, 120, 0.5, 's'),
  ],
};

export const pickPlaceModule = defineModule({
  spec: ppSpec,
  faults: [
    { key: 'vacuum', label: 'Tutucu kavrayamıyor (parça kayıyor)' },
    { key: 'z1', label: 'Z1 (aşağı) sensörü arızalı' },
  ],
  create: (inst) => {
    const p = paramReader(ppSpec, inst);
    return {
      voltage: p.str('coilVoltage') as Voltage,
      xMs: p.num('xMs'),
      zMs: p.num('zMs'),
      gripMs: p.num('gripMs'),
      feedMs: p.num('feedS') * 1000,
      feedTimer: 0,
      x: 0,
      z: 0,
      grip: 0,
      coils: { x: false, z: false, g: false },
      partAtPick: true,
      holding: false,
      placed: 0,
      dropped: 0,
      crashes: 0,
      powered: false,
      fault: null as string | null,
    };
  },
  links: (d, net) =>
    pnp(net, d.powered, {
      X0: d.x <= 0.02,
      X1: d.x >= 0.98,
      Z0: d.z <= 0.02,
      Z1: d.z >= 0.98 && !net.fault('z1'),
      GP: d.holding,
      PS: d.partAtPick,
    }),
  update: (d, io, dt) => {
    d.powered = io.powered24('L+', 'M');
    const coil = (t: string) => {
      const r = io.load(d.voltage, t, 'M');
      if (r.fault) d.fault = r.fault;
      return r.on;
    };
    d.fault = null;
    d.coils = { x: coil('YX'), z: coil('YZ'), g: coil('YG') };
    const step = (v: number, on: boolean, ms: number) => Math.max(0, Math.min(1, v + ((on ? 1 : -1) * dt) / ms));
    const xBefore = d.x;
    d.x = step(d.x, d.coils.x, d.xMs);
    if (d.x !== xBefore && d.z > 0.3) {
      d.crashes++;
      io.event('Z aşağıdayken X hareket etti: çarpışma!');
      d.x = xBefore;
    }
    d.z = step(d.z, d.coils.z, d.zMs);
    const gBefore = d.grip;
    d.grip = step(d.grip, d.coils.g, d.gripMs);
    // Kavrama: tutucu alma noktasında, aşağıda kapanınca
    if (d.grip >= 1 && gBefore < 1 && d.z >= 0.98 && d.x <= 0.02 && d.partAtPick && !io.fault('vacuum')) {
      d.holding = true;
      d.partAtPick = false;
    }
    // Bırakma
    if (d.holding && d.grip < 0.5) {
      d.holding = false;
      if (d.x >= 0.98 && d.z >= 0.98) d.placed++;
      else if (d.x <= 0.02 && d.z >= 0.98) d.partAtPick = true;
      else {
        d.dropped++;
        io.event('parça yerleştirme noktası dışında bırakıldı (düştü)');
      }
    }
    if (d.feedMs > 0 && !d.partAtPick) {
      d.feedTimer += dt;
      if (d.feedTimer >= d.feedMs && !(d.x <= 0.02 && d.z > 0.3)) {
        d.partAtPick = true;
        d.feedTimer = 0;
      }
    } else d.feedTimer = 0;
  },
  command: (d, action) => {
    if (action === 'feed') d.partAtPick = true;
  },
  state: (d) => ({
    type: 'pickPlace' as const,
    x: d.x,
    z: d.z,
    grip: d.grip,
    coils: d.coils,
    partAtPick: d.partAtPick,
    holding: d.holding,
    placed: d.placed,
    dropped: d.dropped,
    crashes: d.crashes,
    powered: d.powered,
    fault: d.fault,
  }),
  signals: (s) => ({
    x: { label: 'X konumu', value: s.x * 100, unit: '%' },
    z: { label: 'Z konumu', value: s.z * 100, unit: '%' },
    tutucu: { label: 'Parça tutucuda', value: s.holding },
    yerlestirilen: { label: 'Yerleştirilen parça', value: s.placed },
    dusen: { label: 'Düşen parça', value: s.dropped },
    carpisma: { label: 'Çarpışma', value: s.crashes },
  }),
});

// --- Robot hücresi --------------------------------------------------------------------------
//
// PLC ↔ robot el sıkışması (endüstride yaygın dijital arayüz):
//   Girişler (24 V): START (yükselen kenar), P0/P1 program no (1..3, ikili), RESET.
//   Çıkışlar (PNP): READY (hazır, komut bekliyor), BUSY (program çalışıyor), DONE (bitti; START
//   düşene kadar kalır), FAULT (hata; RESET ile silinir).
// Programlar: 1 = A'dan al → B'ye koy, 2 = A'dan al → C'ye koy, 3 = ana konuma git.
// Kol 3 eklemli (taban, omuz, dirsek; derece) ve eklem uzayında doğrusal hareket eder.

type Pose = readonly [number, number, number];

const HOME: Pose = [0, 60, -100];
const ABOVE = (base: number): Pose => [base, 40, -60];
const DOWN = (base: number): Pose => [base, 20, -30];
const STATIONS = { A: -70, B: 40, C: 80 } as const;

type Step = { pose: Pose; grip?: boolean };

function programSteps(n: number): Step[] {
  const pickPlace = (to: number): Step[] => [
    { pose: ABOVE(STATIONS.A) },
    { pose: DOWN(STATIONS.A) },
    { pose: DOWN(STATIONS.A), grip: true },
    { pose: ABOVE(STATIONS.A) },
    { pose: ABOVE(to) },
    { pose: DOWN(to) },
    { pose: DOWN(to), grip: false },
    { pose: ABOVE(to) },
    { pose: HOME },
  ];
  if (n === 1) return pickPlace(STATIONS.B);
  if (n === 2) return pickPlace(STATIONS.C);
  return [{ pose: HOME }];
}

const robotSpec = {
  type: 'robotArm' as const,
  title: 'Robot hücresi (PLC el sıkışmalı)',
  prefix: 'R',
  category: 'Robotik' as const,
  description:
    'Kendi kontrolcüsü olan 3 eksenli robot. Girişler (24 V): START, P0, P1 (program 1..3), RESET. Çıkışlar ' +
    '(PNP): READY, BUSY, DONE, FAULT. Program 1: A→B, 2: A→C, 3: ana konum. START kenarında program ' +
    'numarası okunur; DONE, START düşene kadar kalır. Geçersiz program veya parça yokken alma FAULT verir.',
  terminals: ['L+', 'M', 'START', 'P0', 'P1', 'RESET', 'READY', 'BUSY', 'DONE', 'FAULT'],
  params: [
    num('speedDeg', 'Eklem hızı', 90, 5, 360, 5, '°/s'),
    num('feedS', 'A istasyonuna otomatik parça (0 = elle)', 4, 0, 120, 0.5, 's'),
  ],
};

export const robotArmModule = defineModule({
  spec: robotSpec,
  faults: [
    { key: 'collision', label: 'Çarpışma algılandı (robot durur, FAULT)' },
    { key: 'servo', label: 'Servo enerjisi yok (hareket etmez)' },
  ],
  create: (inst) => {
    const p = paramReader(robotSpec, inst);
    return {
      speed: p.num('speedDeg'),
      feedMs: p.num('feedS') * 1000,
      feedTimer: 0,
      joints: [...HOME] as [number, number, number],
      steps: [] as Step[],
      stepIndex: 0,
      program: 0,
      busy: false,
      done: false,
      fault: null as string | null,
      gripping: false,
      partAt: { A: true, B: 0, C: 0 },
      prevStart: false,
      powered: false,
      cycles: 0,
    };
  },
  links: (d, net) =>
    pnp(net, d.powered, {
      READY: !d.busy && !d.done && !d.fault,
      BUSY: d.busy,
      DONE: d.done,
      FAULT: !!d.fault,
    }),
  update: (d, io, dt) => {
    const was = d.powered;
    d.powered = io.powered24('L+', 'M');
    if (!d.powered) {
      if (was) Object.assign(d, { busy: false, done: false, steps: [], stepIndex: 0 });
      return;
    }
    const start = io.high('START');
    const rising = start && !d.prevStart;
    d.prevStart = start;
    if (io.high('RESET') && d.fault && !io.fault('collision')) d.fault = null;
    if (io.fault('collision') && !d.fault) {
      d.fault = 'çarpışma';
      d.busy = false;
      io.event('robot: çarpışma algılandı');
    }
    if (d.done && !start) d.done = false;
    if (rising && !d.busy && !d.fault) {
      const n = (io.high('P0') ? 1 : 0) + (io.high('P1') ? 2 : 0);
      if (n === 0) {
        d.fault = 'geçersiz program (0)';
        io.event('robot: program numarası 0 (P0/P1 ikisi de 0)');
      } else if ((n === 1 || n === 2) && !d.partAt.A) {
        d.fault = 'A istasyonunda parça yok';
        io.event('robot: alma istasyonunda parça yok');
      } else {
        d.program = n;
        d.steps = programSteps(n);
        d.stepIndex = 0;
        d.busy = true;
      }
    }
    if (d.busy && !io.fault('servo')) {
      const step = d.steps[d.stepIndex]!;
      const maxDelta = (d.speed * dt) / 1000;
      let arrived = true;
      d.joints = d.joints.map((j, i) => {
        const diff = step.pose[i]! - j;
        if (Math.abs(diff) <= maxDelta) return step.pose[i]!;
        arrived = false;
        return j + Math.sign(diff) * maxDelta;
      }) as [number, number, number];
      if (arrived) {
        if (step.grip === true) {
          d.gripping = d.partAt.A;
          d.partAt.A = false;
        } else if (step.grip === false && d.gripping) {
          d.gripping = false;
          if (d.program === 1) d.partAt.B++;
          else d.partAt.C++;
        }
        d.stepIndex++;
        if (d.stepIndex >= d.steps.length) {
          d.busy = false;
          d.done = true;
          d.cycles++;
        }
      }
    }
    if (d.feedMs > 0 && !d.partAt.A && !(d.busy && d.stepIndex <= 3)) {
      d.feedTimer += dt;
      if (d.feedTimer >= d.feedMs) {
        d.partAt.A = true;
        d.feedTimer = 0;
      }
    } else d.feedTimer = 0;
  },
  command: (d, action) => {
    if (action === 'feed') d.partAt.A = true;
  },
  state: (d) => ({
    type: 'robotArm' as const,
    joints: [...d.joints] as [number, number, number],
    busy: d.busy,
    done: d.done,
    ready: d.powered && !d.busy && !d.done && !d.fault,
    fault: d.fault,
    program: d.program,
    gripping: d.gripping,
    partA: d.partAt.A,
    countB: d.partAt.B,
    countC: d.partAt.C,
    cycles: d.cycles,
    powered: d.powered,
  }),
  signals: (s) => ({
    hazir: { label: 'READY', value: s.ready },
    mesgul: { label: 'BUSY', value: s.busy },
    bitti: { label: 'DONE', value: s.done },
    hata: { label: 'FAULT', value: !!s.fault },
    b: { label: 'B istasyonundaki parça', value: s.countB },
    c: { label: 'C istasyonundaki parça', value: s.countC },
    cevrim: { label: 'Tamamlanan program', value: s.cycles },
  }),
});

// --- Asansör --------------------------------------------------------------------------------

const elevSpec = {
  type: 'elevator' as const,
  title: 'Asansör (3 katlı)',
  prefix: 'M',
  category: 'Robotik' as const,
  description:
    'Kabin 3~ motorla (U-V-W) hareket eder; faz sırası yönü belirler (sağ dönüş = yukarı). Frenli: enerji ' +
    'kesilince kabin durur. Kat sensörleri (PNP, L+ / M): F1, F2, F3 kabin kattayken +24 V. ' +
    'En alt / üst katı geçen kabin tampona çarpar.',
  terminals: ['U', 'V', 'W', 'L+', 'M', 'F1', 'F2', 'F3'],
  params: [num('floorS', 'Katlar arası süre', 4, 0.5, 60, 0.5, 's'), num('startFloor', 'Başlangıç katı', 1, 1, 3, 1), ...driveParams(3, 1400)],
};

export const elevatorModule = defineModule({
  spec: elevSpec,
  faults: [{ key: 'f2', label: 'F2 kat sensörü arızalı' }],
  provides: ['probe', 'position'],
  create: (inst) => {
    const p = paramReader(elevSpec, inst);
    return { motor: motorFromParams(p, 70), floorMs: p.num('floorS') * 1000, pos: p.num('startFloor') - 1, powered: false, bumped: false };
  },
  links: (d, net) =>
    pnp(net, d.powered, {
      F1: Math.abs(d.pos) <= 0.04,
      F2: Math.abs(d.pos - 1) <= 0.04 && !net.fault('f2'),
      F3: Math.abs(d.pos - 2) <= 0.04,
    }),
  update: (d, io, dt) => {
    d.powered = io.powered24('L+', 'M');
    const atEnd = (d.pos <= -0.1 && d.motor.direction < 0) || (d.pos >= 2.1 && d.motor.direction > 0);
    // Frenli motor: enerji kesilince durur.
    stepMotor3(d.motor, io, dt, { locked: (atEnd && d.motor.powered) || !d.motor.powered });
    if (atEnd && d.motor.powered && !d.bumped) io.event('kabin tampona çarptı!');
    d.bumped = atEnd && d.motor.powered;
    d.pos = Math.max(-0.1, Math.min(2.1, d.pos + (d.motor.speed * dt) / d.floorMs));
  },
  lineCurrent: (d) => ({ terminals: ['U', 'V', 'W'], currentA: d.motor.currentA }),
  probe: (d, at) => Math.abs(d.pos / 2 - at) <= 0.02,
  measure: (d, q) => (q === 'position' ? d.pos + 1 : null),
  state: (d) => ({ type: 'elevator' as const, ...motorFields(d.motor), pos: d.pos, bumped: d.bumped }),
  signals: (s) => ({
    kat: { label: 'Kabin konumu (kat)', value: s.pos + 1 },
    f1: { label: 'F1', value: Math.abs(s.pos) <= 0.04 },
    f2: { label: 'F2', value: Math.abs(s.pos - 1) <= 0.04 },
    f3: { label: 'F3', value: Math.abs(s.pos - 2) <= 0.04 },
    calisiyor: { label: 'Motor enerjili', value: s.powered },
  }),
});

// --- Garaj kapısı ---------------------------------------------------------------------------

const doorSpec = {
  type: 'garageDoor' as const,
  title: 'Garaj kapısı',
  prefix: 'M',
  category: 'Robotik' as const,
  description:
    '3~ motorlu (U-V-W, sağ dönüş = aç) seksiyonel kapı. PNP sensörler (L+ / M): LSO tam açık, LSC tam kapalı, ' +
    'PH fotosel (NC mantık: ışın serbestken +24 V). Simülasyonda kapı altına tıklayınca engel konur/kaldırılır.',
  terminals: ['U', 'V', 'W', 'L+', 'M', 'LSO', 'LSC', 'PH'],
  params: [num('travelS', 'Açılma süresi', 8, 1, 60, 0.5, 's'), ...driveParams(1.2, 1400)],
};

export const garageDoorModule = defineModule({
  spec: doorSpec,
  faults: [{ key: 'lsc', label: 'LSC (kapalı) sınır sensörü arızalı' }],
  create: (inst) => {
    const p = paramReader(doorSpec, inst);
    return { motor: motorFromParams(p, 50), travelMs: p.num('travelS') * 1000, pos: 0, obstacle: false, hits: 0, hitting: false, powered: false };
  },
  links: (d, net) =>
    pnp(net, d.powered, {
      LSO: d.pos >= 0.98,
      LSC: d.pos <= 0.02 && !net.fault('lsc'),
      PH: !d.obstacle,
    }),
  update: (d, io, dt) => {
    d.powered = io.powered24('L+', 'M');
    const blocked = d.obstacle && d.pos <= 0.25 && d.motor.direction < 0;
    const atEnd = (d.pos <= 0 && d.motor.direction < 0) || (d.pos >= 1 && d.motor.direction > 0);
    stepMotor3(d.motor, io, dt, { locked: (blocked || atEnd) && d.motor.powered });
    if (blocked && d.motor.powered && !d.hitting) {
      d.hits++;
      io.event('kapı engele çarptı!');
    }
    d.hitting = blocked && d.motor.powered;
    if (!blocked) d.pos = Math.max(0, Math.min(1, d.pos + (d.motor.speed * dt) / d.travelMs));
  },
  command: (d, action) => {
    if (action === 'obstacle') d.obstacle = !d.obstacle;
  },
  lineCurrent: (d) => ({ terminals: ['U', 'V', 'W'], currentA: d.motor.currentA }),
  state: (d) => ({ type: 'garageDoor' as const, ...motorFields(d.motor), pos: d.pos, obstacle: d.obstacle, hits: d.hits }),
  signals: (s) => ({
    aciklik: { label: 'Açıklık', value: s.pos * 100, unit: '%' },
    acik: { label: 'LSO tam açık', value: s.pos >= 0.98 },
    kapali: { label: 'LSC tam kapalı', value: s.pos <= 0.02 },
    engel: { label: 'Engel var', value: s.obstacle },
    carpma: { label: 'Engele çarpma', value: s.hits },
  }),
});
