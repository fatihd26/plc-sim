// Su pompası + depo: 3~ pompa depoyu doldurur, tüketim boşaltır; iki seviye şamandırası.

import { Tank } from '../devices';
import { driveParams, num, paramReader } from '../spec';
import { motorFields, motorFromParams, stepMotor3 } from './drive';
import { defineModule } from './types';

const spec = {
  type: 'pump' as const,
  title: 'Su pompası + depo',
  prefix: 'M',
  category: 'Mekanik' as const,
  description:
    '3~ pompa (U-V-W) depoyu doldurur, depodan sürekli su çekilir. Seviye sensörleri su ' +
    'seviyesine ulaşınca kapanır: 13-14 alt (%20), 23-24 üst (%80)',
  terminals: ['U', 'V', 'W', '13', '14', '23', '24'],
  params: [
    num('fillS', 'Boş depoyu doldurma süresi', 20, 1, 600, 1, 's'),
    num('drainS', 'Dolu deponun boşalma süresi (0 = tüketim yok)', 40, 0, 600, 1, 's'),
    num('initialPct', 'Başlangıç seviyesi', 10, 0, 100, 5, '%'),
    ...driveParams(3, 2800),
  ],
};

export const pumpModule = defineModule({
  spec,
  faults: [
    { key: 'dry', label: 'Pompa emişi tıkalı (döner ama basmaz)' },
    { key: 'lowStuck', label: 'Alt şamandıra takıldı (13-14 hiç kapanmaz)' },
    { key: 'highStuck', label: 'Üst şamandıra takıldı (23-24 hiç kapanmaz)' },
  ],
  provides: ['level'],
  create: (inst) => {
    const p = paramReader(spec, inst);
    return {
      motor: motorFromParams(p),
      tank: new Tank({ fillMs: p.num('fillS') * 1000, drainMs: p.num('drainS') * 1000, initialLevel: p.num('initialPct') / 100 }),
    };
  },
  links: (d, net) => {
    if (d.tank.lowWet && !net.fault('lowStuck')) net.link('13', '14');
    if (d.tank.highWet && !net.fault('highStuck')) net.link('23', '24');
  },
  update: (d, io, dt) => {
    stepMotor3(d.motor, io, dt);
    const was = d.tank.overflowing;
    d.tank.update(io.fault('dry') ? 0 : Math.abs(d.motor.speed), dt);
    if (d.tank.overflowing && !was) io.event('depo taştı (pompa dolu depoya basıyor)');
  },
  lineCurrent: (d) => ({ terminals: ['U', 'V', 'W'], currentA: d.motor.currentA }),
  measure: (d, q) => (q === 'level' ? d.tank.level * 100 : null),
  state: (d) => {
    const t = d.tank;
    const { direction: _dir, ...motor } = motorFields(d.motor);
    return {
      type: 'pump' as const,
      ...motor,
      /** Depo seviyesi 0..1 ve sensör eşikleri. */
      level: t.level,
      lowAt: Tank.LOW,
      highAt: Tank.HIGH,
      low: t.lowWet,
      high: t.highWet,
      overflowing: t.overflowing,
    };
  },
  signals: (s) => ({
    calisiyor: { label: 'Pompa enerjili', value: s.powered },
    seviye: { label: 'Depo seviyesi', value: s.level * 100, unit: '%' },
    alt: { label: 'Alt seviye (13-14)', value: s.low },
    ust: { label: 'Üst seviye (23-24)', value: s.high },
    akim: { label: 'Motor akımı', value: s.currentA, unit: 'A' },
  }),
});
