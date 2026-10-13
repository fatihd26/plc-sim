// Konveyör bant: 3~ motorla döner, bant sonunda dahili fotosel. Harici sensörler (endüktif,
// kapasitif, optik) bandın herhangi bir noktasını hedef alabilir.

import { Conveyor } from '../devices';
import { choice, driveParams, num, paramReader } from '../spec';
import { motorFields, motorFromParams, stepMotor3 } from './drive';
import { defineModule } from './types';

const spec = {
  type: 'conveyor' as const,
  title: 'Konveyör bant',
  prefix: 'M',
  category: 'Mekanik' as const,
  description:
    '3~ motorla (U-V-W) döner, faz sırası yönü belirler. Bant sonundaki fotosel (13-14) kutu ' +
    'önündeyken kapanır. Simülasyonda banda tıklayınca kutu eklenir',
  terminals: ['U', 'V', 'W', '13', '14'],
  params: [
    num('transitS', 'Kutunun bandı geçme süresi', 6, 1, 120, 0.5, 's'),
    num('feedS', 'Otomatik kutu besleme aralığı (0 = kapalı)', 4, 0, 120, 0.5, 's'),
    choice('material', 'Kutu malzemesi', 'cardboard', [
      ['cardboard', 'Karton (endüktif sensör görmez)'],
      ['metal', 'Metal'],
      ['mixed', 'Karışık (sırayla karton / metal)'],
    ]),
    ...driveParams(2, 1400),
  ],
};

export const conveyorModule = defineModule({
  spec,
  faults: [
    { key: 'jam', label: 'Bant sıkıştı (motor kilitli rotor akımı çeker)' },
    { key: 'slip', label: 'Bant kayıyor (kutular yavaş ilerler)' },
    { key: 'dirty', label: 'Fotosel kirli (sürekli algılıyor)' },
  ],
  provides: ['probe', 'revs'],
  create: (inst) => {
    const p = paramReader(spec, inst);
    return {
      motor: motorFromParams(p),
      conveyor: new Conveyor({
        transitMs: p.num('transitS') * 1000,
        feedMs: p.num('feedS') * 1000,
        material: p.str('material') as 'cardboard' | 'metal' | 'mixed',
      }),
    };
  },
  links: (d, net) => {
    if (d.conveyor.sensorBlocked || net.fault('dirty')) net.link('13', '14');
  },
  update: (d, io, dt) => {
    stepMotor3(d.motor, io, dt, { locked: io.fault('jam') });
    d.conveyor.update(d.motor.speed * (io.fault('slip') ? 0.3 : 1), dt);
  },
  lineCurrent: (d) => ({ terminals: ['U', 'V', 'W'], currentA: d.motor.currentA }),
  probe: (d, at, material) => d.conveyor.boxAt(at, material === 'metal'),
  measure: (d, q) => (q === 'revs' ? d.motor.revs : null),
  command: (d, action, _v, io) => {
    if (action === 'addBox' && !d.conveyor.addBox()) io.event('bandın başında yer yok');
  },
  state: (d) => {
    const c = d.conveyor;
    return {
      type: 'conveyor' as const,
      ...motorFields(d.motor),
      /** Kutuların sol kenar konumları (bant uzunluğuna oranla) ve kutu boyu. */
      boxes: [...c.boxes],
      boxMetal: [...c.metal],
      boxLength: Conveyor.BOX,
      sensorAt: Conveyor.SENSOR,
      beltPos: c.beltPos,
      sensor: c.sensorBlocked,
      delivered: c.delivered,
    };
  },
  signals: (s) => ({
    calisiyor: { label: 'Motor enerjili', value: s.powered },
    hiz: { label: 'Motor hızı', value: s.rpm, unit: 'dev/dk' },
    akim: { label: 'Motor akımı', value: s.currentA, unit: 'A' },
    fotosel: { label: 'Fotosel (13-14)', value: s.sensor },
    kutu: { label: 'Banttaki kutu', value: s.boxes.length },
    teslim: { label: 'Teslim edilen', value: s.delivered },
  }),
});
