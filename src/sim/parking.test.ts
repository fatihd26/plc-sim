// Otopark bariyeri sahnesi: bilet + yer varsa kol açılır, araç geçince iner; sayıcı ve DOLU;
// emniyetsiz programda kol araca iner, sayıcısız programda otopark taşar.

import { describe, expect, it } from 'vitest';
import { coil, nc, net, neg, no, program, series } from './build';
import { parkingBarrierSchematic } from './examplesLib';
import { validateSchematic } from './schematic';
import { Simulation, type ComponentState, type SimSnapshot } from './simulation';

const barrier = (s: SimSnapshot) => {
  const c = s.components.M1;
  if (c?.type !== 'parkingBarrier') throw new Error('M1 bariyer değil');
  return c as ComponentState & { type: 'parkingBarrier' };
};

describe('otopark bariyeri', () => {
  it('örnek şema: 4 araçta DOLU, gelenler döner, çıkınca yer açılır; çarpma ve taşma yok', () => {
    const s = parkingBarrierSchematic();
    expect(validateSchematic(s)).toEqual([]);
    const sim = new Simulation(s);
    sim.run(25_000);
    let b = barrier(sim.snapshot());
    expect(b.inLot).toBe(4);
    expect(b.full).toBe(true);
    sim.run(60_000);
    b = barrier(sim.snapshot());
    expect(b.left).toBeGreaterThan(2);
    expect(b.turnedAway).toBeGreaterThan(0);
    expect(b.hits).toBe(0);
    expect(b.overflows).toBe(0);
  });

  it('araç loop’tan çıkınca kapatan program (fotosele bakmıyor): kol araca iner', () => {
    const s = parkingBarrierSchematic();
    s.components.find((c) => c.name === 'A1')!.program = program(
      net('N1', 'Bilet → aç', series(no('%I0.0'), no('%I0.1')), coil('%M0.0', 'set')),
      net('N2', 'Açık → açma biter', no('%I0.3'), coil('%M0.0', 'reset')),
      net('N3', 'Aç', series(no('%M0.0'), nc('%I0.3')), coil('%Q0.0')),
      net('N4', 'Araç loop’tan çıktı → kapat (emniyetsiz)', neg('%I0.0'), coil('%M0.1', 'set')),
      net('N5', 'Kapalı', no('%I0.4'), coil('%M0.1', 'reset')),
      net('N6', 'İndir', series(no('%M0.1'), nc('%M0.0'), nc('%I0.4')), coil('%Q0.1')),
    );
    const sim = new Simulation(s);
    sim.run(20_000);
    const b = barrier(sim.snapshot());
    expect(b.hits).toBeGreaterThan(0);
    expect(sim.snapshot().events.some((e) => e.text.includes('aracın üstüne'))).toBe(true);
  });

  it('sayıcısız program: otopark taşar; DOLU yanmadığı için gelenler dönmez', () => {
    const s = parkingBarrierSchematic();
    const prog = s.components.find((c) => c.name === 'A1')!.program!;
    // Sayıcı ve DOLU network'leri çıkarılır, açma koşulundan C0 kaldırılır
    prog.networks = prog.networks.filter((n) => n.id !== 'N1' && n.id !== 'N2');
    prog.networks[0] = net('N3', 'Aç', series(no('%I0.0'), no('%I0.1')), coil('%M0.0', 'set'));
    const sim = new Simulation(s);
    sim.run(40_000);
    const b = barrier(sim.snapshot());
    expect(b.overflows).toBeGreaterThan(0);
    expect(b.turnedAway).toBe(0);
  });

  it('elle gelen araç DOLU olsa da kuyruğa girer; bilet butonu PLC girişine gelir', () => {
    const s = parkingBarrierSchematic();
    s.components.find((c) => c.name === 'M1')!.params = { arrivalS: 0 };
    s.components.find((c) => c.name === 'A1')!.program = program(net('N1', 'Bilet', neg('%I0.1'), coil('%M0.0', 'set')));
    const sim = new Simulation(s);
    sim.enqueue({ type: 'device', component: 'M1', action: 'car' });
    sim.run(4000);
    const b = barrier(sim.snapshot());
    expect(b.entry.length).toBe(1);
    expect(b.loop).toBe(true);
    expect(b.arm).toBe(0);
  });
});
