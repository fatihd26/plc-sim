// Tek fazlı fan: X1-X2 arasında anma gerilimi varken döner.

import { Motor } from '../devices';
import { num, paramReader, voltageParam, type Voltage } from '../spec';
import { defineModule } from './types';

const spec = {
  type: 'fan' as const,
  title: 'Fan',
  prefix: 'M',
  category: 'Mekanik' as const,
  description: 'Tek fazlı fan, X1-X2 arasında anma gerilimi varken döner (24 V DC / 230 V AC)',
  terminals: ['X1', 'X2'],
  params: [
    voltageParam('voltage', 'Anma gerilimi', '230AC'),
    num('ratedRpm', 'Nominal hız', 1400, 100, 3600, 10, 'dev/dk'),
    num('startTauMs', 'Kalkış zaman sabiti', 800, 10, 10_000, 10, 'ms'),
    num('coastTauMs', 'Duruş zaman sabiti', 2500, 10, 60_000, 10, 'ms'),
  ],
};

export const fanModule = defineModule({
  spec,
  faults: [{ key: 'jam', label: 'Pervane sıkışmış' }],
  create: (inst) => {
    const p = paramReader(spec, inst);
    return {
      motor: new Motor({
        ratedCurrentA: 0.3,
        ratedRpm: p.num('ratedRpm'),
        startTauMs: p.num('startTauMs'),
        coastTauMs: p.num('coastTauMs'),
        lockedRotorRatio: 2,
        loadPct: 100,
      }),
      voltage: p.str('voltage') as Voltage,
      fault: null as string | null,
    };
  },
  update: (d, io, dt) => {
    const r = io.load(d.voltage, 'X1', 'X2');
    d.fault = r.fault;
    d.motor.update(r.on, dt, 1, { locked: io.fault('jam') });
  },
  state: (d) => {
    const m = d.motor;
    return { type: 'fan' as const, powered: m.powered, speed: m.speed, rpm: m.rpm, angleDeg: m.angleDeg, fault: d.fault };
  },
  signals: (s) => ({
    calisiyor: { label: 'Enerjili', value: s.powered },
    hiz: { label: 'Hız', value: s.rpm, unit: 'dev/dk' },
  }),
});
