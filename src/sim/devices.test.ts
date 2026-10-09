import { describe, expect, it } from 'vitest';
import { Contactor, Motor, PushButton, ThermalRelay } from './devices';

function runMs(ms: number, fn: () => void) {
  for (let i = 0; i < ms; i++) fn();
}

describe('PushButton', () => {
  it('NO basılıyken, NC bırakılmışken iletir', () => {
    const start = new PushButton('NO');
    const stop = new PushButton('NC');
    expect(start.contactClosed).toBe(false);
    expect(stop.contactClosed).toBe(true);
    start.pressed = stop.pressed = true;
    expect(start.contactClosed).toBe(true);
    expect(stop.contactClosed).toBe(false);
  });
});

describe('Contactor', () => {
  it('çekme gecikmesinden sonra kapanır', () => {
    const k = new Contactor({ pickupMs: 20, dropoutMs: 15 });
    runMs(19, () => k.update(true, 1));
    expect(k.closed).toBe(false);
    k.update(true, 1);
    expect(k.closed).toBe(true);
  });

  it('bırakma gecikmesinden sonra açılır', () => {
    const k = new Contactor({ pickupMs: 20, dropoutMs: 15 });
    runMs(20, () => k.update(true, 1));
    runMs(14, () => k.update(false, 1));
    expect(k.closed).toBe(true);
    k.update(false, 1);
    expect(k.closed).toBe(false);
  });

  it('gecikmeden kısa bobin darbesi kontağı kapatmaz', () => {
    const k = new Contactor({ pickupMs: 20, dropoutMs: 15 });
    runMs(10, () => k.update(true, 1));
    runMs(50, () => k.update(false, 1));
    expect(k.closed).toBe(false);
    // Kesintiden sonra sayaç baştan başlar
    runMs(19, () => k.update(true, 1));
    expect(k.closed).toBe(false);
  });
});

describe('ThermalRelay', () => {
  const tripTimeMs = (ratio: number, limitMs: number) => {
    const f = new ThermalRelay({ setCurrentA: 4, tauMs: 300_000 });
    for (let t = 1; t <= limitMs; t++) {
      f.update(4 * ratio, 1);
      if (f.tripped) return t;
    }
    return Infinity;
  };

  it('nominal akımda açmaz', () => {
    expect(tripTimeMs(1.0, 2 * 3_600_000)).toBe(Infinity);
  });

  it('7.2×Ir\'de Class 10 bandında (4–10 s) açar', () => {
    const t = tripTimeMs(7.2, 20_000);
    expect(t).toBeGreaterThanOrEqual(4_000);
    expect(t).toBeLessThanOrEqual(10_000);
  });

  it('akım arttıkça açma süresi kısalır', () => {
    expect(tripTimeMs(3, 600_000)).toBeLessThan(tripTimeMs(1.5, 600_000));
  });

  it('test butonu açtırır, soğuk rölede reset kabul edilir', () => {
    const f = new ThermalRelay();
    f.test();
    expect(f.tripped).toBe(true);
    expect(f.ncClosed).toBe(false);
    expect(f.reset()).toBe(true);
    expect(f.ncClosed).toBe(true);
  });

  it('aşırı yükle açan röle soğumadan resetlenemez', () => {
    const f = new ThermalRelay({ setCurrentA: 4, tauMs: 300_000 });
    while (!f.tripped) f.update(4 * 7.2, 1);
    expect(f.reset()).toBe(false);
    while (f.theta >= ThermalRelay.RESET_THETA) f.update(0, 1);
    expect(f.reset()).toBe(true);
  });
});

describe('Motor', () => {
  it('enerjilendiğinde hızlanır, kalkış akımı nominale iner', () => {
    const m = new Motor();
    m.update(true, 1);
    expect(m.currentA).toBeGreaterThan(4 * 5.9);
    runMs(3000, () => m.update(true, 1));
    expect(m.speed).toBeGreaterThan(0.99);
    expect(m.currentA).toBeLessThan(4 * 1.05);
    expect(m.rpm).toBeGreaterThan(1430);
  });

  it('enerji kesilince akım sıfırlanır ve motor durur', () => {
    const m = new Motor();
    runMs(3000, () => m.update(true, 1));
    m.update(false, 1);
    expect(m.currentA).toBe(0);
    expect(m.running).toBe(true); // ataletle dönmeye devam eder
    runMs(20_000, () => m.update(false, 1));
    expect(m.speed).toBe(0);
    expect(m.running).toBe(false);
  });

  it('mil açısı 0..360 aralığında kalır', () => {
    const m = new Motor();
    runMs(5000, () => {
      m.update(true, 1);
      expect(m.angleDeg).toBeGreaterThanOrEqual(0);
      expect(m.angleDeg).toBeLessThan(360);
    });
  });
});

describe('Motor yön', () => {
  it('ters faz sırasında ters yönde döner', () => {
    const m = new Motor();
    runMs(3000, () => m.update(true, 1, -1));
    expect(m.speed).toBeLessThan(-0.99);
    expect(m.rpm).toBeLessThan(-1430);
    expect(m.currentA).toBeLessThan(4 * 1.05);
    expect(m.angleDeg).toBeGreaterThanOrEqual(0);
  });

  it('dönerken yön değişince kalkış akımı çeker ve yön değiştirir', () => {
    const m = new Motor();
    runMs(3000, () => m.update(true, 1, 1));
    m.update(true, 1, -1);
    expect(m.currentA).toBeCloseTo(4 * 6, 0);
    runMs(5000, () => m.update(true, 1, -1));
    expect(m.speed).toBeLessThan(-0.99);
  });
});
