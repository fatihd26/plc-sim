// Pnömatik silindir + 5/2 yaylı selenoid valf (tek eleman, hortumsuz). Ayrı valf/silindir ile
// pnömatik devre çizmek için pneumatics.ts'teki elemanlar kullanılır.

import { Cylinder } from '../devices';
import { num, paramReader, voltageParam, type Voltage } from '../spec';
import { defineModule } from './types';

const spec = {
  type: 'cylinder' as const,
  title: 'Pnömatik silindir + valf',
  prefix: 'Y',
  category: 'Mekanik' as const,
  description:
    'Çift etkili silindir, 5/2 yaylı selenoid valf (A1-A2). Bobin enerjiliyken ileri gider. ' +
    'Uç sensörleri: 13-14 geride, 23-24 ileride kapanır',
  terminals: ['A1', 'A2', '13', '14', '23', '24'],
  params: [
    voltageParam('coilVoltage', 'Valf bobin gerilimi'),
    num('extendMs', 'İleri gitme süresi', 1000, 50, 20_000, 50, 'ms'),
    num('retractMs', 'Geri dönme süresi', 1000, 50, 20_000, 50, 'ms'),
  ],
};

export const cylinderModule = defineModule({
  spec,
  faults: [
    { key: 'coil', label: 'Valf bobini yanık (çekmiyor)' },
    { key: 'stuck', label: 'Piston sıkışmış (hareket etmiyor)' },
    { key: 'reedRear', label: 'Arka sensör (13-14) arızalı, hiç kapanmıyor' },
    { key: 'reedFront', label: 'Ön sensör (23-24) arızalı, hiç kapanmıyor' },
  ],
  provides: ['probe', 'position'],
  create: (inst) => {
    const p = paramReader(spec, inst);
    return {
      cylinder: new Cylinder({ extendMs: p.num('extendMs'), retractMs: p.num('retractMs') }),
      voltage: p.str('coilVoltage') as Voltage,
      fault: null as string | null,
    };
  },
  links: (d, net) => {
    if (d.cylinder.retracted && !net.fault('reedRear')) net.link('13', '14');
    if (d.cylinder.extended && !net.fault('reedFront')) net.link('23', '24');
  },
  update: (d, io, dt) => {
    const r = io.load(d.voltage, 'A1', 'A2');
    d.fault = r.fault;
    const on = r.on && !io.fault('coil');
    if (io.fault('stuck')) d.cylinder.valve = on;
    else d.cylinder.update(on, dt);
  },
  probe: (d, at) => Math.abs(d.cylinder.position - at) <= 0.04,
  measure: (d, q) => (q === 'position' ? d.cylinder.position * 100 : null),
  state: (d) => ({
    type: 'cylinder' as const,
    valve: d.cylinder.valve,
    /** 0 = tam geride, 1 = tam ileride. */
    position: d.cylinder.position,
    retracted: d.cylinder.retracted,
    extended: d.cylinder.extended,
    fault: d.fault,
  }),
  signals: (s) => ({
    valf: { label: 'Valf bobini', value: s.valve },
    konum: { label: 'Piston konumu', value: s.position * 100, unit: '%' },
    geride: { label: 'Geride (13-14)', value: s.retracted },
    ileride: { label: 'İleride (23-24)', value: s.extended },
  }),
});
