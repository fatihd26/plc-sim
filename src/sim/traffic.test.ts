// Trafik sahneleri (tek yön, kavşak, yaya geçidi): araçlar yeşilde geçer, kırmızıda durma
// çizgisinde bekler; renk çatışması, kaza riski, yaya tehlikesi ve LED arızası sahnede görünür.

import { describe, expect, it } from 'vitest';
import { always, coil, net, no, program } from './build';
import { pedCrossingSchematic, trafficJunctionSchematic, trafficLightSchematic } from './examplesLib';
import { validateSchematic } from './schematic';
import { Simulation, type ComponentState, type SimSnapshot } from './simulation';

const light = (s: SimSnapshot) => {
  const c = s.components.H1;
  if (c?.type !== 'trafficLight') throw new Error('H1 trafik ışığı değil');
  return c as ComponentState & { type: 'trafficLight' };
};

describe('trafik ışığı', () => {
  it('örnek şema geçerli; araçlar kırmızıda bekler, yeşilde geçer', () => {
    const s = trafficLightSchematic();
    expect(validateSchematic(s)).toEqual([]);
    const sim = new Simulation(s);
    sim.run(4500);
    let h = light(sim.snapshot());
    expect(h.red && !h.green && !h.yellow).toBe(true);
    expect(h.passed).toBe(0);
    expect(h.waiting).toBeGreaterThanOrEqual(1);
    // Bekleyen aracın önü durma çizgisini geçmez
    expect(Math.max(...h.cars)).toBeLessThanOrEqual(h.stopAt);

    sim.run(3500); // t = 8 s: yeşil
    h = light(sim.snapshot());
    expect(h.green && !h.red).toBe(true);
    expect(h.passed).toBeGreaterThanOrEqual(1);
    expect(h.conflicts).toBe(0);
  });

  it('yeşil ve kırmızı birlikte yanarsa çatışma sayılır; yanık LED yanmaz', () => {
    const s = trafficLightSchematic();
    const plc = s.components.find((c) => c.name === 'A1')!;
    plc.program = program(net('N1', 'Kırmızı', always(), coil('%Q0.0')), net('N2', 'Yeşil', always(), coil('%Q0.2')));
    const sim = new Simulation(s);
    sim.run(500);
    const h = light(sim.snapshot());
    expect(h.conflict).toBe(true);
    expect(h.conflicts).toBe(1);
    expect(sim.snapshot().events.some((e) => e.text.includes('birlikte'))).toBe(true);

    const f = trafficLightSchematic();
    f.components.find((c) => c.name === 'H1')!.faults = ['red'];
    const sim2 = new Simulation(f);
    sim2.run(500);
    expect(light(sim2.snapshot()).red).toBe(false);
  });

  it('elle araç eklenir; yolun başı doluysa eklenmez', () => {
    const s = trafficLightSchematic();
    s.components.find((c) => c.name === 'H1')!.params = { arrivalS: 0 };
    const sim = new Simulation(s);
    sim.enqueue({ type: 'device', component: 'H1', action: 'addCar' });
    sim.enqueue({ type: 'device', component: 'H1', action: 'addCar' });
    sim.run(10);
    expect(light(sim.snapshot()).cars.length).toBe(1);
  });
});

const junction = (s: SimSnapshot) => {
  const c = s.components.H1;
  if (c?.type !== 'trafficJunction') throw new Error('H1 kavşak değil');
  return c as ComponentState & { type: 'trafficJunction' };
};

describe('trafik ışığı: sarı', () => {
  it('sarı yanınca uzaktaki araçlar durur, yalnız çizgiye çok yakın olan geçer', () => {
    const s = trafficLightSchematic();
    s.components.find((c) => c.name === 'A1')!.program = program(net('N1', 'Sarı', always(), coil('%Q0.1')));
    const sim = new Simulation(s);
    sim.run(20_000);
    const h = light(sim.snapshot());
    expect(h.yellow).toBe(true);
    expect(h.passed).toBe(0);
    expect(h.waiting).toBeGreaterThanOrEqual(2);
  });
});

describe('kavşak', () => {
  it('örnek şema: döngü boyunca çatışma, kaza ve yaya tehlikesi yok; yaya geçer', () => {
    const s = trafficJunctionSchematic();
    expect(validateSchematic(s)).toEqual([]);
    const sim = new Simulation(s);
    sim.run(2000);
    sim.enqueue({ type: 'device', component: 'H1', action: 'pedestrian' });
    sim.run(40_000);
    const h = junction(sim.snapshot());
    expect(h.conflicts).toBe(0);
    expect(h.crashes).toBe(0);
    expect(h.dangers).toBe(0);
    expect(h.pedPassed).toBe(1);
    expect(h.a.passed).toBeGreaterThan(3);
    expect(h.b.passed).toBeGreaterThan(1);
  });

  it('iki yol birlikte yeşil: çatışma ve kaza riski görünür', () => {
    const s = trafficJunctionSchematic();
    s.components.find((c) => c.name === 'A1')!.program = program(
      net('N1', 'A yeşil', always(), coil('%Q0.2')),
      net('N2', 'B yeşil', always(), coil('%Q0.5')),
    );
    const sim = new Simulation(s);
    sim.run(30_000);
    const h = junction(sim.snapshot());
    expect(h.conflicts).toBe(1);
    expect(h.crashes).toBeGreaterThan(0);
  });

  it('yaya yeşili A yeşiliyle birlikte: yaya tehlikesi; buton PLC girişine gelir', () => {
    const s = trafficJunctionSchematic();
    s.components.find((c) => c.name === 'A1')!.program = program(
      net('N1', 'A yeşil', always(), coil('%Q0.2')),
      net('N2', 'Buton basılınca yaya yeşil', no('%I0.0'), coil('%Q0.7', 'set')),
    );
    const sim = new Simulation(s);
    let danger = 0;
    for (let t = 0; t < 20 && danger === 0; t++) {
      sim.enqueue({ type: 'device', component: 'H1', action: 'pedestrian' });
      sim.run(1000);
      danger = junction(sim.snapshot()).dangers;
    }
    const h = junction(sim.snapshot());
    expect(h.pedGreen).toBe(true);
    expect(h.conflicts).toBe(1);
    expect(danger).toBeGreaterThan(0);
  });
});

const crossing = (s: SimSnapshot) => {
  const c = s.components.H1;
  if (c?.type !== 'pedCrossing') throw new Error('H1 yaya geçidi değil');
  return c as ComponentState & { type: 'pedCrossing' };
};

describe('butonlu yaya geçidi', () => {
  it('örnek şema: talepsiz araç yeşil; iki kaldırımdan gelen yayalar güvenle geçer', () => {
    const s = pedCrossingSchematic();
    expect(validateSchematic(s)).toEqual([]);
    const sim = new Simulation(s);
    sim.run(8000);
    let h = crossing(sim.snapshot());
    expect(h.green && h.pedRed && !h.wait).toBe(true);
    sim.enqueue({ type: 'device', component: 'H1', action: 'pedestrian' });
    sim.enqueue({ type: 'device', component: 'H1', action: 'pedestrian' });
    sim.run(200);
    h = crossing(sim.snapshot());
    expect(h.wait).toBe(true);
    expect(h.pedWaiting).toEqual([1, 1]);
    sim.run(30_000);
    h = crossing(sim.snapshot());
    expect(h.pedPassed).toBe(2);
    expect(h.conflicts).toBe(0);
    expect(h.dangers).toBe(0);
    expect(h.east.passed + h.west.passed).toBeGreaterThan(4);
  });

  it('araç yeşilken yaya yeşili: çatışma ve yaya tehlikesi', () => {
    const s = pedCrossingSchematic();
    s.components.find((c) => c.name === 'A1')!.program = program(
      net('N1', 'Araç yeşil', always(), coil('%Q0.2')),
      net('N2', 'Buton basılınca yaya yeşil', no('%I0.0'), coil('%Q0.4', 'set')),
    );
    const sim = new Simulation(s);
    let danger = 0;
    for (let t = 0; t < 20 && danger === 0; t++) {
      sim.enqueue({ type: 'device', component: 'H1', action: 'pedestrian' });
      sim.run(1000);
      danger = crossing(sim.snapshot()).dangers;
    }
    expect(crossing(sim.snapshot()).conflicts).toBe(1);
    expect(danger).toBeGreaterThan(0);
  });
});
