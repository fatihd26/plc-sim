// Kütüphane örneklerinin uçtan uca çalıştığını doğrular: butonlara basılır, süre ilerletilir,
// beklenen makine davranışı kontrol edilir.

import { describe, expect, it } from 'vitest';
import { troubleshootSchematic } from './examples';
import {
  electroPneumaticSchematic,
  elevatorSchematic,
  furnaceSchematic,
  garageDoorSchematic,
  hydraulicPressSchematic,
  pickPlaceSchematic,
  pidTankSchematic,
  positioningSchematic,
  robotCellSchematic,
  starDeltaSchematic,
  vfdModbusSchematic,
} from './examplesLib';
import { Simulation, type ComponentState, type SimSnapshot } from './simulation';

function st<T extends ComponentState['type']>(x: Simulation, id: string, type: T) {
  const c = x.snapshot().components[id];
  if (c?.type !== type) throw new Error(`${id} ${type} değil`);
  return c as ComponentState & { type: T };
}

const tap = (x: Simulation, id: string, ms = 60) => {
  x.enqueue({ type: 'button', component: id, pressed: true });
  x.run(ms);
  x.enqueue({ type: 'button', component: id, pressed: false });
  x.run(20);
};

const until = (x: Simulation, ms: number, f: (s: SimSnapshot) => boolean) => {
  for (let i = 0; i < ms; i += 10) {
    x.run(10);
    if (f(x.snapshot())) return true;
  }
  return false;
};

describe('kütüphane örnekleri', () => {
  it('PID seviye: potansiyometre %50 → seviye %50', { timeout: 30_000 }, () => {
    const x = new Simulation(pidTankSchematic());
    x.run(120_000);
    expect(st(x, 'T1', 'processTank').level).toBeCloseTo(0.5, 1);
  });

  it('fırın: 180–200 °C bandında aç-kapa', { timeout: 30_000 }, () => {
    const x = new Simulation(furnaceSchematic());
    x.enqueue({ type: 'button', component: 'S1', pressed: true });
    x.run(150_000);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 90; i++) {
      x.run(1000);
      const t = st(x, 'E1', 'furnace').temp;
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    expect(lo).toBeGreaterThan(170);
    expect(hi).toBeLessThan(212);
    expect(st(x, 'E1', 'furnace').tripped).toBe(false);
  });

  it('yıldız-üçgen: önce yıldız, 4 s sonra üçgen', () => {
    const x = new Simulation(starDeltaSchematic());
    tap(x, 'S1');
    x.run(1000);
    expect(st(x, 'M1', 'motor6').connection).toBe('star');
    x.run(4000);
    expect(st(x, 'M1', 'motor6').connection).toBe('delta');
    x.run(3000);
    expect(st(x, 'M1', 'motor6').rpm).toBeGreaterThan(1400);
    expect(st(x, 'F1', 'thermal').tripped).toBe(false);
    expect(x.snapshot().events).toEqual([]);
    x.enqueue({ type: 'button', component: 'S2', pressed: true });
    x.run(100);
    expect(st(x, 'M1', 'motor6').powered).toBe(false);
  });

  it('VFD Modbus: start → potansiyometre %60 → 30 Hz', () => {
    const x = new Simulation(vfdModbusSchematic());
    tap(x, 'S1');
    x.run(5000);
    expect(st(x, 'T1', 'vfd').freq).toBeCloseTo(30, 0);
    expect(st(x, 'A1', 'plc').words[10]).toBeGreaterThan(2900);
    tap(x, 'S2');
    x.run(3000);
    expect(st(x, 'T1', 'vfd').freq).toBe(0);
  });

  it('elektro-pnömatik: start → ileri → kendiliğinden geri', () => {
    const x = new Simulation(electroPneumaticSchematic());
    x.run(50);
    tap(x, 'S1');
    expect(until(x, 5000, (s) => (s.components.Z1 as { extended: boolean }).extended)).toBe(true);
    expect(until(x, 5000, (s) => (s.components.Z1 as { retracted: boolean }).retracted)).toBe(true);
  });

  it('hidrolik pres: uçta basınç yükselir, aşağı komutu kesilir', () => {
    const x = new Simulation(hydraulicPressSchematic());
    tap(x, 'S3');
    x.run(1000);
    expect(st(x, 'P1', 'hpu').pressure).toBe(0); // tandem merkez: pompa boşta
    tap(x, 'S1');
    expect(until(x, 10_000, (s) => (s.components.Z1 as { extended: boolean }).extended)).toBe(true);
    expect(until(x, 2000, () => st(x, 'A1', 'plc').piq[3]!)).toBe(true);
    x.run(200);
    expect(st(x, 'A1', 'plc').piq[0]).toBe(false);
    expect(st(x, 'Z1', 'hydCylinder').extended).toBe(true);
    tap(x, 'S2', 3000);
    expect(st(x, 'Z1', 'hydCylinder').retracted).toBe(true);
  });

  it('konumlama: referans, sonra 400 mm hedef', () => {
    const x = new Simulation(positioningSchematic());
    tap(x, 'S2');
    expect(until(x, 10_000, () => st(x, 'M1', 'linearAxis').x <= 53 && !st(x, 'M1', 'linearAxis').powered)).toBe(true);
    x.run(500);
    tap(x, 'S1');
    x.run(6000);
    const ax = st(x, 'M1', 'linearAxis');
    expect(ax.x).toBeGreaterThan(445);
    expect(ax.x).toBeLessThan(470);
  });

  it('pick & place: çarpışmasız, düşürmeden parça yerleştirir', () => {
    const x = new Simulation(pickPlaceSchematic());
    x.run(30_000);
    const p = st(x, 'U1', 'pickPlace');
    expect(p.placed).toBeGreaterThanOrEqual(3);
    expect(p.dropped).toBe(0);
    expect(p.crashes).toBe(0);
  });

  it('robot hücresi: start → program 1 → B istasyonuna parça', () => {
    const x = new Simulation(robotCellSchematic());
    x.run(100);
    tap(x, 'S1');
    expect(until(x, 20_000, () => st(x, 'R1', 'robotArm').countB === 1)).toBe(true);
    expect(until(x, 2000, () => st(x, 'R1', 'robotArm').ready)).toBe(true);
  });

  it('asansör: 3. kata çağır, sonra 1. kata', () => {
    const x = new Simulation(elevatorSchematic());
    x.run(50);
    tap(x, 'S3');
    expect(until(x, 15_000, (s) => s.potentials['M1:F3'] === 'P24' && !st(x, 'M1', 'elevator').powered)).toBe(true);
    x.run(1000);
    expect(Math.abs(st(x, 'M1', 'elevator').pos - 2)).toBeLessThan(0.05);
    tap(x, 'S1');
    expect(until(x, 15_000, (s) => s.potentials['M1:F1'] === 'P24' && !st(x, 'M1', 'elevator').powered)).toBe(true);
    expect(st(x, 'M1', 'elevator').bumped).toBe(false);
  });

  it('garaj kapısı: açılır, kapanırken engelde geri açılır', () => {
    const x = new Simulation(garageDoorSchematic());
    x.run(50);
    tap(x, 'S1');
    expect(until(x, 10_000, (s) => s.potentials['M1:LSO'] === 'P24')).toBe(true);
    tap(x, 'S2');
    x.run(2000);
    x.enqueue({ type: 'device', component: 'M1', action: 'obstacle' });
    expect(until(x, 10_000, (s) => s.potentials['M1:LSO'] === 'P24')).toBe(true);
    expect(st(x, 'M1', 'garageDoor').hits).toBe(0);
  });

  it('arıza bulma örneği: start motoru çalıştırmaz (kopuk stop kablosu)', () => {
    const x = new Simulation(troubleshootSchematic());
    tap(x, 'S1');
    x.run(500);
    expect(st(x, 'M1', 'motor3').powered).toBe(false);
    expect(x.snapshot().brokenWires.length).toBe(1);
  });
});
