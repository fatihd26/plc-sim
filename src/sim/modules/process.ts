// Proses modelleri: seviye kontrol tankı ve elektrikli fırın. Kapalı çevrim (PID) ve aç-kapa
// kontrol alıştırmaları için; ölçüm transmitterlerle (analog.ts) alınır.

import { choice, num, paramReader, voltageParam, type Voltage } from '../spec';
import { defineModule } from './types';

// --- Proses tankı ---------------------------------------------------------------------------

const tankSpec = {
  type: 'processTank' as const,
  title: 'Proses tankı (seviye kontrol)',
  prefix: 'T',
  category: 'Proses' as const,
  description:
    'Giriş vanası: selenoid (A1-A2, aç-kapa) veya oransal kontrol vanası (Y: 0–10 V = %0–100 açıklık). ' +
    'Çıkış selenoid vanası B1-B2. Tüketim simülasyonda ayarlanır (bozucu etki). Şamandıralar: ' +
    '13-14 alt seviyede (≥ LSL) kapanır, 23-24 üst seviyede (≥ LSH) kapanır. Seviye transmitteri ile ölçülür.',
  terminals: ['A1', 'A2', 'Y', 'B1', 'B2', '13', '14', '23', '24'],
  params: [
    choice('inlet', 'Giriş vanası', 'onoff', [
      ['onoff', 'Selenoid (A1-A2, aç-kapa)'],
      ['analog', 'Oransal kontrol vanası (Y, 0–10 V)'],
    ]),
    voltageParam('coilVoltage', 'Selenoid bobin gerilimi'),
    num('fillS', 'Dolum süresi (giriş tam açık)', 30, 2, 600, 1, 's'),
    num('drainS', 'Boşaltma süresi (çıkış açık)', 40, 2, 600, 1, 's'),
    num('demandPct', 'Başlangıç tüketimi', 0, 0, 100, 5, '%'),
    num('initialPct', 'Başlangıç seviyesi', 20, 0, 100, 5, '%'),
    num('lowPct', 'Alt şamandıra (LSL)', 20, 0, 100, 5, '%'),
    num('highPct', 'Üst şamandıra (LSH)', 80, 0, 100, 5, '%'),
  ],
};

export const processTankModule = defineModule({
  spec: tankSpec,
  faults: [
    { key: 'inletStuck', label: 'Giriş vanası kapalı sıkışmış' },
    { key: 'leak', label: 'Tank sızdırıyor (ek boşalma)' },
    { key: 'lshStuck', label: 'Üst şamandıra takıldı (23-24 kapanmaz)' },
  ],
  provides: ['level'],
  create: (inst) => {
    const p = paramReader(tankSpec, inst);
    return {
      analog: p.str('inlet') === 'analog',
      voltage: p.str('coilVoltage') as Voltage,
      fillMs: p.num('fillS') * 1000,
      drainMs: p.num('drainS') * 1000,
      demand: p.num('demandPct') / 100,
      level: p.num('initialPct') / 100,
      low: p.num('lowPct') / 100,
      high: p.num('highPct') / 100,
      inlet: 0,
      outlet: false,
      overflowing: false,
      fault: null as string | null,
    };
  },
  links: (d, net) => {
    if (d.level >= d.low) net.link('13', '14');
    if (d.level >= d.high && !net.fault('lshStuck')) net.link('23', '24');
  },
  update: (d, io, dt) => {
    let inlet: number;
    let fault: string | null = null;
    if (d.analog) {
      const s = io.signal('Y');
      inlet = s?.kind === 'V' ? Math.max(0, Math.min(1, s.v / 10)) : 0;
    } else {
      const r = io.load(d.voltage, 'A1', 'A2');
      fault = r.fault;
      inlet = r.on ? 1 : 0;
    }
    if (io.fault('inletStuck')) inlet = 0;
    const out = io.load(d.voltage, 'B1', 'B2');
    d.fault = fault ?? out.fault;
    d.inlet = inlet;
    d.outlet = out.on;
    // Çıkış debisi: vana + tüketim; boşalma seviyeyle azalır (√h yerine doğrusal yaklaşım).
    const outFlow = (out.on ? 1 : 0) + d.demand + (io.fault('leak') ? 0.3 : 0);
    const next = d.level + (inlet * dt) / d.fillMs - (outFlow * dt * Math.min(1, d.level * 4)) / d.drainMs;
    const was = d.overflowing;
    d.overflowing = next > 1 && inlet > 0;
    if (d.overflowing && !was) io.event('tank taştı');
    d.level = Math.max(0, Math.min(1, next));
  },
  command: (d, action, value) => {
    if (action === 'demand' && value !== undefined) d.demand = Math.max(0, Math.min(1, value / 100));
  },
  measure: (d, q) => (q === 'level' ? d.level * 100 : null),
  state: (d) => ({
    type: 'processTank' as const,
    level: d.level,
    inlet: d.inlet,
    outlet: d.outlet,
    demand: d.demand,
    low: d.level >= d.low,
    high: d.level >= d.high,
    lowAt: d.low,
    highAt: d.high,
    analog: d.analog,
    overflowing: d.overflowing,
    fault: d.fault,
  }),
  signals: (s) => ({
    seviye: { label: 'Seviye', value: s.level * 100, unit: '%' },
    giris: { label: 'Giriş vanası açıklığı', value: s.inlet * 100, unit: '%' },
    cikis: { label: 'Çıkış vanası', value: s.outlet },
    tuketim: { label: 'Tüketim', value: s.demand * 100, unit: '%' },
    alt: { label: 'Alt şamandıra (13-14)', value: s.low },
    ust: { label: 'Üst şamandıra (23-24)', value: s.high },
  }),
});

// --- Elektrikli fırın -----------------------------------------------------------------------

const furnaceSpec = {
  type: 'furnace' as const,
  title: 'Elektrikli fırın',
  prefix: 'E',
  category: 'Proses' as const,
  description:
    'Isıtıcı H1-H2 (230 V AC, kontaktör/röle ile). Güç kontrolü: aç-kapa veya tristör (Y: 0–10 V = %0–100 güç; ' +
    'H1-H2 enerjili olmalı). Birinci dereceden ısıl model. Emniyet termostatı 11-12 (NC) aşırı sıcaklıkta açar. ' +
    'Sıcaklık PT100 transmitteriyle ölçülür. Kapak simülasyonda açılabilir (ısı kaybı).',
  terminals: ['H1', 'H2', 'Y', '11', '12'],
  params: [
    choice('power', 'Güç kontrolü', 'onoff', [
      ['onoff', 'Aç-kapa (H1-H2)'],
      ['analog', 'Tristör güç ayarlı (H1-H2 + Y 0–10 V)'],
    ]),
    voltageParam('voltage', 'Isıtıcı gerilimi', '230AC'),
    num('riseC', 'Tam güçte kalıcı sıcaklık artışı', 300, 10, 1200, 10, '°C'),
    num('tauS', 'Isıl zaman sabiti', 60, 2, 3600, 1, 's'),
    num('ambientC', 'Ortam sıcaklığı', 20, -20, 50, 1, '°C'),
    num('limitC', 'Emniyet termostatı', 280, 50, 1200, 5, '°C'),
  ],
};

export const furnaceModule = defineModule({
  spec: furnaceSpec,
  faults: [
    { key: 'element', label: 'Isıtıcı rezistans kopuk' },
    { key: 'halfPower', label: 'Isıtıcı bir grubu yanık (yarı güç)' },
  ],
  provides: ['temperature'],
  create: (inst) => {
    const p = paramReader(furnaceSpec, inst);
    return {
      analog: p.str('power') === 'analog',
      voltage: p.str('voltage') as Voltage,
      rise: p.num('riseC'),
      tauMs: p.num('tauS') * 1000,
      ambient: p.num('ambientC'),
      limit: p.num('limitC'),
      temp: p.num('ambientC'),
      power: 0,
      doorOpen: false,
      tripped: false,
      fault: null as string | null,
    };
  },
  links: (d, net) => {
    if (!d.tripped) net.link('11', '12');
  },
  update: (d, io, dt) => {
    const r = io.load(d.voltage, 'H1', 'H2');
    d.fault = r.fault;
    let power = r.on ? 1 : 0;
    if (d.analog) {
      const s = io.signal('Y');
      power *= s?.kind === 'V' ? Math.max(0, Math.min(1, s.v / 10)) : 0;
    }
    if (io.fault('element')) power = 0;
    if (io.fault('halfPower')) power /= 2;
    d.power = power;
    // dT/dt = (T∞ − T) / τ;  T∞ = Tortam + P·ΔT  (kapak açıkken kayıp artar)
    const loss = d.doorOpen ? 2.5 : 1;
    const target = d.ambient + (power * d.rise) / loss;
    d.temp += ((target - d.temp) * dt * loss) / d.tauMs;
    // Emniyet termostatı: sınırda açar, 10 °C histerezisle kapanır.
    if (d.temp >= d.limit && !d.tripped) {
      d.tripped = true;
      io.event(`emniyet termostatı açtı (${Math.round(d.temp)} °C)`);
    } else if (d.tripped && d.temp < d.limit - 10) d.tripped = false;
  },
  command: (d, action) => {
    if (action === 'door') d.doorOpen = !d.doorOpen;
  },
  measure: (d, q) => (q === 'temperature' ? d.temp : null),
  state: (d) => ({
    type: 'furnace' as const,
    temp: d.temp,
    power: d.power,
    doorOpen: d.doorOpen,
    tripped: d.tripped,
    limit: d.limit,
    fault: d.fault,
  }),
  signals: (s) => ({
    sicaklik: { label: 'Fırın sıcaklığı', value: s.temp, unit: '°C' },
    guc: { label: 'Isıtıcı gücü', value: s.power * 100, unit: '%' },
    kapak: { label: 'Kapak açık', value: s.doorOpen },
    termostat: { label: 'Emniyet termostatı açtı', value: s.tripped },
  }),
});
