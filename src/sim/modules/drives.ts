// Sürücüler ve özel motorlar: frekans konvertörü (VFD), yıldız-üçgen (6 uçlu) motor, frenli motor.

import { createModbusModel } from '../modbus';
import { choice, driveParams, num, paramReader, voltageParam, type Voltage } from '../spec';
import { motorFields, motorFromParams, NOMINAL_HZ, stepMotor3 } from './drive';
import { defineModule } from './types';

// --- Frekans konvertörü ---------------------------------------------------------------------
//
// Giriş L1-L2-L3, çıkış U-V-W (motor). Kumanda:
//   Klemens modu: DI1 ileri, DI2 geri (ikisi birden = dur), DI3 sabit hız 2; hız referansı AI
//   (0–10 V = 0..fmax). Röle çıkışları: 13-14 "çalışıyor", 95-98 "arıza" (kuru kontak).
//   Modbus modu (RS485 slave): HR0 kontrol kelimesi (bit0 çalış, bit1 geri, bit7 arıza reset),
//   HR1 frekans referansı (0,01 Hz; 5000 = 50 Hz). Durum: HR2 / IR0 çıkış frekansı (0,01 Hz),
//   HR3 / IR1 durum kelimesi (bit0 çalışıyor, bit1 arıza, bit2 hıza ulaştı, bit3 geri).
// Rampa: frekans rampa süresince 0'dan fmax'a çıkar.

const vfdSpec = {
  type: 'vfd' as const,
  title: 'Frekans konvertörü (VFD)',
  prefix: 'T',
  category: 'Sürücüler' as const,
  description:
    'Motor hızını frekansla ayarlar. Giriş L1-L3, çıkış U-V-W. Klemens: DI1 ileri, DI2 geri, DI3 sabit hız, ' +
    'AI hız referansı 0–10 V; röle 13-14 çalışıyor, 97-98 arıza. Modbus RTU slave: HR0 kontrol kelimesi ' +
    '(bit0 çalış, bit1 geri, bit7 reset), HR1 frekans ×0,01 Hz; HR2 çıkış frekansı, HR3 durum.',
  terminals: ['L1', 'L2', 'L3', 'U', 'V', 'W', 'DI1', 'DI2', 'DI3', 'AI', '13', '14', '97', '98', 'RS485_A', 'RS485_B'],
  params: [
    choice('control', 'Kumanda kaynağı', 'terminal', [
      ['terminal', 'Klemens (DI1/DI2/DI3 + AI)'],
      ['modbus', 'Modbus RTU (HR0 kontrol, HR1 frekans)'],
    ]),
    num('fmax', 'En yüksek frekans', 50, 10, 100, 1, 'Hz'),
    num('fpreset', 'Sabit hız 2 (DI3)', 25, 0, 100, 1, 'Hz'),
    num('rampUpS', 'Hızlanma rampası (0 → fmax)', 3, 0.1, 60, 0.1, 's'),
    num('rampDownS', 'Yavaşlama rampası', 3, 0.1, 60, 0.1, 's'),
    num('slaveId', 'Modbus adresi', 2, 1, 247, 1),
    choice('baud', 'Baud hızı', '19200', ['9600', '19200', '38400', '115200'].map((v) => [v, `${v} bit/s`])),
  ],
};

export const vfdModule = defineModule({
  spec: vfdSpec,
  faults: [
    { key: 'trip', label: 'Sürücü arızası (OC/OV): çıkış kesilir, arıza rölesi çeker' },
    { key: 'aiBroken', label: 'AI referans kablosu kopuk' },
  ],
  create: (inst) => {
    const p = paramReader(vfdSpec, inst);
    return {
      modbusControl: p.str('control') === 'modbus',
      fmax: p.num('fmax'),
      fpreset: p.num('fpreset'),
      rampUp: p.num('rampUpS') * 1000,
      rampDown: p.num('rampDownS') * 1000,
      unit: p.num('slaveId'),
      baud: Number(p.str('baud')),
      regs: createModbusModel({ coils: 8, discreteInputs: 8, holding: 8, input: 4 }),
      powered: false,
      freq: 0,
      target: 0,
      direction: 1 as 1 | -1,
      tripped: false,
      wasTrip: false,
    };
  },
  links: (d, net) => {
    const out = d.powered && !d.tripped && d.freq > 0.1;
    if (out) {
      // Faz sırası yönü belirler: geri dönüşte V ve W yer değiştirir.
      net.source('U', 'L1');
      net.source(d.direction > 0 ? 'V' : 'W', 'L2');
      net.source(d.direction > 0 ? 'W' : 'V', 'L3');
      net.link('13', '14');
    }
    if (d.tripped) net.link('97', '98');
  },
  drive: (d, out) => {
    if (d.powered && !d.tripped && d.freq > 0.1) out.drive('U', { kind: 'drive', hz: d.freq });
  },
  update: (d, io, dt) => {
    d.powered = io.threePhase('L1', 'L2', 'L3').powered;
    const r = d.regs.holdingRegisters;
    if (!d.powered) {
      d.freq = 0;
      d.regs.holdingRegisters.fill(0);
      return;
    }
    if (io.fault('trip') && !d.wasTrip) {
      d.tripped = true;
      io.event('sürücü arızası (trip)');
    }
    d.wasTrip = io.fault('trip');
    let run = false;
    let dir: 1 | -1 = d.direction;
    let ref = 0;
    if (d.modbusControl) {
      const cw = r[0]!;
      if (cw & 0x80 && d.tripped && !io.fault('trip')) d.tripped = false;
      run = (cw & 1) === 1;
      dir = cw & 2 ? -1 : 1;
      ref = Math.min(d.fmax, r[1]! / 100);
    } else {
      const fwd = io.high('DI1');
      const rev = io.high('DI2');
      run = fwd !== rev;
      dir = rev && !fwd ? -1 : 1;
      if (io.high('DI3')) ref = d.fpreset;
      else {
        const s = io.fault('aiBroken') ? null : io.signal('AI');
        ref = s?.kind === 'V' ? (Math.max(0, Math.min(10, s.v)) * d.fmax) / 10 : 0;
      }
      // Klemens modunda arıza, çalıştırma komutu kalkınca resetlenir.
      if (d.tripped && !run && !io.fault('trip')) d.tripped = false;
    }
    if (d.tripped) run = false;
    // Yön değişimi: önce sıfıra in, sonra ters yönde kalk.
    const goal = run ? ref : 0;
    if (run && dir !== d.direction && d.freq > 0.1) d.target = 0;
    else {
      d.target = goal;
      if (run && d.freq <= 0.1) d.direction = dir;
    }
    const up = (d.fmax * dt) / d.rampUp;
    const down = (d.fmax * dt) / d.rampDown;
    if (d.freq < d.target) d.freq = Math.min(d.target, d.freq + up);
    else d.freq = Math.max(d.target, d.freq - down);
    // Durum register'ları
    const status = (d.freq > 0.1 ? 1 : 0) | (d.tripped ? 2 : 0) | (run && Math.abs(d.freq - ref) < 0.05 ? 4 : 0) | (d.direction < 0 ? 8 : 0);
    r[2] = Math.round(d.freq * 100);
    r[3] = status;
    d.regs.inputRegisters[0] = r[2]!;
    d.regs.inputRegisters[1] = status;
  },
  command: (d, action) => {
    if (action === 'reset') d.tripped = false;
  },
  modbus: (d) => ({ a: 'RS485_A', b: 'RS485_B', unit: d.unit, baud: d.baud, model: d.regs, powered: d.powered }),
  state: (d) => ({
    type: 'vfd' as const,
    powered: d.powered,
    freq: d.freq,
    target: d.target,
    direction: d.direction,
    running: d.freq > 0.1,
    tripped: d.tripped,
    modbusControl: d.modbusControl,
    controlWord: d.regs.holdingRegisters[0]!,
    setpoint: d.regs.holdingRegisters[1]!,
  }),
  signals: (s) => ({
    frekans: { label: 'Çıkış frekansı', value: s.freq, unit: 'Hz' },
    hedef: { label: 'Hedef frekans', value: s.target, unit: 'Hz' },
    calisiyor: { label: 'Çalışıyor (13-14)', value: s.running },
    ariza: { label: 'Arıza (97-98)', value: s.tripped },
  }),
});

// --- Yıldız-üçgen motor ---------------------------------------------------------------------
//
// Sargılar U1-U2, V1-V2, W1-W2. Yıldız: U2-V2-W2 birbirine köprülü (yıldız noktası), sargı başına
// 230 V → akım ve moment ≈ 1/3. Üçgen: U1-W2, V1-U2, W1-V2 köprüleri, sargı başına 400 V (tam
// moment). Başka bir bağlantı (ör. sargı uçlarında aynı faz, eksik köprü) motoru döndürmez.

const motor6Spec = {
  type: 'motor6' as const,
  title: 'Asenkron motor 6 uçlu (Y/Δ)',
  prefix: 'M',
  category: 'Tüketiciler' as const,
  description:
    'Yıldız-üçgen yol verme için 6 uçlu motor: U1 V1 W1 / U2 V2 W2. Yıldızda (U2-V2-W2 köprülü) akım ve ' +
    'moment 1/3, üçgende (U1-W2, V1-U2, W1-V2) tam güç.',
  terminals: ['U1', 'V1', 'W1', 'U2', 'V2', 'W2'],
  params: [
    num('ratedCurrentA', 'Nominal akım (üçgen)', 11, 0.1, 200, 0.1, 'A'),
    num('ratedRpm', 'Nominal hız', 1460, 100, 3600, 10, 'dev/dk'),
    num('loadPct', 'Yük', 60, 0, 200, 5, '%'),
    num('lockedRotorRatio', 'Kalkış akımı / In', 7, 1, 10, 0.5),
    num('startTauMs', 'Kalkış zaman sabiti (üçgen)', 600, 10, 10_000, 10, 'ms'),
    num('coastTauMs', 'Duruş zaman sabiti', 2500, 10, 60_000, 10, 'ms'),
  ],
};

type Connection = 'off' | 'open' | 'star' | 'delta' | 'wrong';

export const motor6Module = defineModule({
  spec: motor6Spec,
  faults: [{ key: 'jam', label: 'Mil sıkışmış' }],
  provides: ['revs'],
  create: (inst) => {
    const p = paramReader(motor6Spec, inst);
    return { motor: motorFromParams(p, p.num('loadPct')), connection: 'off' as Connection, warned: false };
  },
  update: (d, io, dt) => {
    const head = io.threePhase('U1', 'V1', 'W1');
    const tail = ['U2', 'V2', 'W2'].map((t) => io.potential(t));
    let conn: Connection = 'off';
    if (head.powered) {
      const [u1, v1, w1] = ['U1', 'V1', 'W1'].map((t) => io.potential(t));
      const [u2, v2, w2] = tail;
      if (tail.every((p) => p === null) && io.sameNet('U2', 'V2') && io.sameNet('V2', 'W2')) conn = 'star';
      else if (u2 === v1 && v2 === w1 && w2 === u1) conn = 'delta';
      // Sargı uçları boşta (yıldız ve üçgen kontaktörü açık, ör. Y→Δ geçişi): akım yolu yok, motor serbest döner.
      else if (tail.every((p) => p === null) && !io.sameNet('U2', 'V2') && !io.sameNet('V2', 'W2') && !io.sameNet('U2', 'W2')) conn = 'open';
      else conn = 'wrong';
    }
    if (conn === 'wrong' && !d.warned) io.event('sargı bağlantısı hatalı (ne yıldız ne üçgen)');
    d.warned = conn === 'wrong';
    d.connection = conn;
    const star = conn === 'star';
    d.motor.update(conn === 'star' || conn === 'delta' || conn === 'wrong', dt, head.powered ? head.direction : d.motor.direction, {
      locked: conn === 'wrong' || io.fault('jam'),
      currentScale: star ? 1 / 3 : 1,
      tauScale: star ? 3 : 1,
      ratio: head.hz !== null ? head.hz / NOMINAL_HZ : 1,
    });
  },
  lineCurrent: (d) => ({ terminals: ['U1', 'V1', 'W1'], currentA: d.motor.currentA }),
  measure: (d, q) => (q === 'revs' ? d.motor.revs : null),
  state: (d) => ({ type: 'motor6' as const, ...motorFields(d.motor), connection: d.connection }),
  signals: (s) => ({
    calisiyor: { label: 'Enerjili', value: s.powered },
    yildiz: { label: 'Yıldız bağlı', value: s.connection === 'star' },
    ucgen: { label: 'Üçgen bağlı', value: s.connection === 'delta' },
    hiz: { label: 'Hız', value: s.rpm, unit: 'dev/dk' },
    akim: { label: 'Hat akımı', value: s.currentA, unit: 'A' },
  }),
});

// --- Frenli motor ---------------------------------------------------------------------------

const brakeSpec = {
  type: 'brakeMotor' as const,
  title: 'Frenli motor 3~',
  prefix: 'M',
  category: 'Tüketiciler' as const,
  description:
    'Elektromanyetik fren: BR1-BR2 bobini enerjiliyken fren açılır. Fren kapalıyken motora enerji verilirse ' +
    'motor kilitli rotor akımı çeker (termik atar). Enerji kesilince fren hemen durdurur (vinç, asansör).',
  terminals: ['U', 'V', 'W', 'BR1', 'BR2'],
  params: [voltageParam('brakeVoltage', 'Fren bobini gerilimi', '230AC'), num('loadPct', 'Yük', 80, 0, 200, 5, '%'), ...driveParams(4, 1420)],
};

export const brakeMotorModule = defineModule({
  spec: brakeSpec,
  faults: [{ key: 'brakeStuck', label: 'Fren açılmıyor (balata yapışık)' }],
  provides: ['revs'],
  create: (inst) => {
    const p = paramReader(brakeSpec, inst);
    return { motor: motorFromParams(p, p.num('loadPct')), voltage: p.str('brakeVoltage') as Voltage, released: false, fault: null as string | null };
  },
  update: (d, io, dt) => {
    const r = io.load(d.voltage, 'BR1', 'BR2');
    d.fault = r.fault;
    d.released = r.on && !io.fault('brakeStuck');
    stepMotor3(d.motor, io, dt, { locked: !d.released });
  },
  lineCurrent: (d) => ({ terminals: ['U', 'V', 'W'], currentA: d.motor.currentA }),
  measure: (d, q) => (q === 'revs' ? d.motor.revs : null),
  state: (d) => ({ type: 'brakeMotor' as const, ...motorFields(d.motor), released: d.released, fault: d.fault }),
  signals: (s) => ({
    calisiyor: { label: 'Enerjili', value: s.powered },
    fren: { label: 'Fren açık', value: s.released },
    hiz: { label: 'Hız', value: s.rpm, unit: 'dev/dk' },
    akim: { label: 'Akım', value: s.currentA, unit: 'A' },
  }),
});
