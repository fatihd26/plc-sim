import { describe, expect, it } from 'vitest';
import { startStopSchematic } from './examples';
import type { LadderProgram } from './ladder';
import type { Schematic } from './schematic';
import { replay, Simulation, type ComponentState, type SimSnapshot } from './simulation';

const press = (sim: Simulation, component: string) => sim.enqueue({ type: 'button', component, pressed: true });
const release = (sim: Simulation, component: string) => sim.enqueue({ type: 'button', component, pressed: false });

function state<T extends ComponentState['type']>(s: SimSnapshot, id: string, type: T) {
  const c = s.components[id];
  if (c?.type !== type) throw new Error(`${id} ${type} değil`);
  return c as ComponentState & { type: T };
}
const plc = (sim: Simulation) => state(sim.snapshot(), 'A1', 'plc');
const q00 = (sim: Simulation) => plc(sim).dqTerminals[0];
const k1 = (sim: Simulation) => state(sim.snapshot(), 'K1', 'contactor');
const m1 = (sim: Simulation) => state(sim.snapshot(), 'M1', 'motor3');
const f2 = (sim: Simulation) => state(sim.snapshot(), 'F2', 'thermal');

/** Start'a 50 ms basıp bırakır ve motoru nominal hıza getirir. */
function startMotor(sim: Simulation) {
  press(sim, 'S1');
  sim.run(50);
  release(sim, 'S1');
  sim.run(3000);
}

function withoutWire(s: Schematic, a: string, b: string): Schematic {
  const key = (r: { component: string; terminal: string }) => `${r.component}:${r.terminal}`;
  const wires = s.wires.filter((w) => !(key(w.a) === a && key(w.b) === b));
  if (wires.length !== s.wires.length - 1) throw new Error(`kablo bulunamadı: ${a} – ${b}`);
  return { ...s, wires };
}

const newSim = (s: Schematic = startStopSchematic()) => new Simulation(s);

describe('start-stop mühürleme (kabul kriteri)', () => {
  it('başlangıçta her şey kapalı, PLC enerjili', () => {
    const sim = newSim();
    sim.run(100);
    expect(plc(sim).powered).toBe(true);
    expect(q00(sim)).toBe(false);
    expect(k1(sim).closed).toBe(false);
    expect(m1(sim).running).toBe(false);
  });

  it('Start → Q0.0 → K1 çeker → motor döner; bırakınca mühürlenir', () => {
    const sim = newSim();
    startMotor(sim);
    expect(q00(sim)).toBe(true);
    expect(k1(sim).closed).toBe(true);
    expect(m1(sim).powered).toBe(true);
    expect(m1(sim).speed).toBeGreaterThan(0.99);
    expect(plc(sim).trace['N1.hold']?.closed).toBe(true);
  });

  it('Stop → çıkış düşer, kontaktör bırakır, motor durur', () => {
    const sim = newSim();
    startMotor(sim);
    press(sim, 'S2');
    sim.run(10);
    expect(q00(sim)).toBe(false);
    sim.run(15);
    expect(k1(sim).closed).toBe(false);
    expect(m1(sim).powered).toBe(false);
    release(sim, 'S2');
    sim.run(20_000);
    expect(m1(sim).running).toBe(false);
    expect(q00(sim)).toBe(false);
  });

  it('termik açması motoru durdurur; resetlenene kadar start etkisizdir', () => {
    const sim = newSim();
    startMotor(sim);
    expect(f2(sim).currentA).toBeGreaterThan(3.9);
    sim.enqueue({ type: 'thermalTest', component: 'F2' });
    sim.run(50);
    expect(f2(sim).tripped).toBe(true);
    expect(k1(sim).closed).toBe(false);

    press(sim, 'S1');
    sim.run(100);
    release(sim, 'S1');
    expect(q00(sim)).toBe(false);

    sim.enqueue({ type: 'thermalReset', component: 'F2' });
    sim.run(20);
    expect(q00(sim)).toBe(false);
    startMotor(sim);
    expect(m1(sim).speed).toBeGreaterThan(0.99);
  });

  it('Start ve Stop birlikte basılıyken Stop önceliklidir', () => {
    const sim = newSim();
    press(sim, 'S1');
    press(sim, 'S2');
    sim.run(200);
    expect(q00(sim)).toBe(false);
    expect(k1(sim).closed).toBe(false);
  });
});

describe('kablolama', () => {
  it('Stop kablosu koparsa motor çalışmaz (NC + fail-safe)', () => {
    const sim = newSim(withoutWire(startStopSchematic(), 'S2:12', 'A1:I0.1'));
    startMotor(sim);
    expect(q00(sim)).toBe(false);
  });

  it('termik 95-96 kablosu kopuksa motor başlamaz', () => {
    const sim = newSim(withoutWire(startStopSchematic(), 'F2:96', 'A1:I0.2'));
    startMotor(sim);
    expect(m1(sim).powered).toBe(false);
  });

  it('PLC beslemesi yoksa çıkış yoktur ve scan yapılmaz', () => {
    const sim = newSim(withoutWire(startStopSchematic(), 'G1:M', 'A1:M'));
    startMotor(sim);
    expect(plc(sim).powered).toBe(false);
    expect(plc(sim).scanCount).toBe(0);
    expect(k1(sim).closed).toBe(false);
  });

  it('kontaktör bobini 0 V\'a bağlı değilse çekmez', () => {
    const sim = newSim(withoutWire(startStopSchematic(), 'K1:A2', 'G1:M'));
    startMotor(sim);
    expect(q00(sim)).toBe(true);
    expect(k1(sim).closed).toBe(false);
  });

  it('tek faz eksikse motor enerjilenmez', () => {
    const sim = newSim(withoutWire(startStopSchematic(), 'F2:6', 'M1:W'));
    startMotor(sim);
    expect(k1(sim).closed).toBe(true);
    expect(m1(sim).powered).toBe(false);
  });

  it('iki faz yer değiştirince motor ters döner', () => {
    const s = startStopSchematic();
    for (const w of s.wires) {
      if (w.b.component === 'M1' && w.b.terminal === 'U') w.b.terminal = 'V';
      else if (w.b.component === 'M1' && w.b.terminal === 'V') w.b.terminal = 'U';
    }
    const sim = newSim(s);
    startMotor(sim);
    expect(m1(sim).direction).toBe(-1);
    expect(m1(sim).rpm).toBeLessThan(-1400);
  });

  it('24 V ile 0 V arasındaki kablo kısa devre olarak raporlanır', () => {
    const s = startStopSchematic();
    s.wires.push({ id: 'short', a: { component: 'S1', terminal: '14' }, b: { component: 'G1', terminal: 'M' } });
    const sim = newSim(s);
    sim.run(20);
    expect(sim.snapshot().shorts).toEqual([]); // S1 açıkken kısa devre yok
    press(sim, 'S1');
    sim.run(20);
    const snap = sim.snapshot();
    expect(snap.shorts.length).toBe(1);
    expect(snap.shorts[0]).toContain('S1:14');
    expect(snap.potentials['G1:L+']).toBe('short');
  });

  it('potansiyeller terminaller üzerinden raporlanır', () => {
    const sim = newSim();
    sim.run(1);
    const p = sim.snapshot().potentials;
    expect(p['S1:13']).toBe('P24');
    expect(p['S1:14']).toBeNull();
    expect(p['K1:A2']).toBe('M0');
    expect(p['K1:1']).toBe('L1');
    expect(p['M1:U']).toBeNull();
  });

  it('geçersiz şema reddedilir', () => {
    const s = startStopSchematic();
    s.wires.push({ id: 'bad', a: { component: 'S1', terminal: '99' }, b: { component: 'A1', terminal: 'I0.0' } });
    expect(() => newSim(s)).toThrow(/terminali yok/);
  });
});

describe('zamanlama ve scan-cycle', () => {
  it('Start\'tan çıkışa gecikme en fazla bir scan süresidir', () => {
    for (let offset = 0; offset < 10; offset++) {
      const sim = newSim();
      sim.run(100 + offset);
      press(sim, 'S1');
      let latency = 0;
      while (!q00(sim)) {
        sim.step();
        latency++;
      }
      expect(latency).toBeGreaterThanOrEqual(1);
      expect(latency).toBeLessThanOrEqual(10);
    }
  });

  it('kontaktör, çıkıştan pickup süresi (20 ms) sonra kapanır', () => {
    const sim = newSim();
    press(sim, 'S1');
    sim.step();
    expect(q00(sim)).toBe(true);
    sim.run(18);
    expect(k1(sim).closed).toBe(false);
    sim.step();
    expect(k1(sim).closed).toBe(true);
  });

  it('iki scan arasına sığan kısa darbe PLC tarafından görülmez', () => {
    const sim = newSim();
    sim.run(1);
    press(sim, 'S1');
    sim.run(5);
    release(sim, 'S1');
    sim.run(100);
    expect(plc(sim).scanCount).toBeGreaterThan(5);
    expect(q00(sim)).toBe(false);
  });

  it('stepScan tam olarak bir sonraki scan\'e kadar ilerler', () => {
    const sim = newSim();
    sim.stepScan();
    expect(sim.tick).toBe(1);
    expect(plc(sim).scanCount).toBe(1);
    sim.stepScan();
    expect(sim.tick).toBe(11);
    expect(plc(sim).scanCount).toBe(2);
  });

  it('PII scan boyunca sabittir', () => {
    const sim = newSim();
    sim.run(1);
    press(sim, 'S1');
    sim.step();
    expect(plc(sim).diTerminals[0]).toBe(true);
    expect(plc(sim).pii[0]).toBe(false);
  });

  it('geçersiz scan süresi reddedilir', () => {
    expect(() => new Simulation(startStopSchematic(), { scanTimeMs: 0 })).toThrow();
    expect(() => new Simulation(startStopSchematic(), { scanTimeMs: 2.5 })).toThrow();
  });
});

describe('ladder programının doğruluğu önemlidir', () => {
  it('mühür kontağı olmayan programda start bırakılınca motor durur', () => {
    const noHold: LadderProgram = {
      networks: [
        {
          id: 'N1',
          title: 'hatalı',
          logic: {
            kind: 'series',
            id: 's',
            items: [
              { kind: 'contact', id: 'a', address: '%I0.0', contact: 'NO' },
              { kind: 'contact', id: 'b', address: '%I0.1', contact: 'NO' },
              { kind: 'contact', id: 'c', address: '%I0.2', contact: 'NO' },
            ],
          },
          coil: { id: 'q', address: '%Q0.0' },
        },
      ],
    };
    const sim = new Simulation(startStopSchematic(), { program: noHold });
    press(sim, 'S1');
    sim.run(100);
    expect(k1(sim).closed).toBe(true);
    release(sim, 'S1');
    sim.run(100);
    expect(k1(sim).closed).toBe(false);
  });
});

describe('determinizm', () => {
  it('aynı komut kaydı tekrar oynatıldığında aynı durum üretilir', () => {
    const schematic = startStopSchematic();
    const sim = new Simulation(schematic);
    startMotor(sim);
    press(sim, 'S2');
    sim.run(37);
    release(sim, 'S2');
    sim.run(500);
    sim.enqueue({ type: 'thermalTest', component: 'F2' });
    sim.run(123);

    const again = replay(schematic, sim.log, sim.tick);
    expect(again.snapshot()).toEqual(sim.snapshot());
    expect(again.log).toEqual(sim.log);
  });

  it('simülasyon verilen şema nesnesini değiştirmez', () => {
    const schematic = startStopSchematic();
    const copy = structuredClone(schematic);
    startMotor(new Simulation(schematic));
    expect(schematic).toEqual(copy);
  });
});

describe('kütüphane genişletmesi', () => {
  const wire = (id: string, a: string, b: string) => {
    const [ac, at] = a.split(':') as [string, string];
    const [bc, bt] = b.split(':') as [string, string];
    return { id, a: { component: ac, terminal: at }, b: { component: bc, terminal: bt } };
  };
  const at = { x: 0, y: 0, rotation: 0 as const };

  /** G1 → X1 klemens → S1 acil stop → P1 lamba → G1:M */
  const lampCircuit = (): Schematic => ({
    version: 1,
    components: [
      { id: 'G1', type: 'psu24', name: 'G1', ...at },
      { id: 'X1', type: 'terminal', name: 'X1', ...at },
      { id: 'S1', type: 'estop', name: 'S1', ...at },
      { id: 'P1', type: 'lamp', name: 'P1', ...at },
    ],
    wires: [
      wire('w1', 'G1:L+', 'X1:1'),
      wire('w2', 'X1:2', 'S1:11'),
      wire('w3', 'S1:12', 'P1:X1'),
      wire('w4', 'P1:X2', 'G1:M'),
    ],
  });
  const p1 = (sim: Simulation) => state(sim.snapshot(), 'P1', 'lamp');

  it('lamba klemens ve kapalı acil stop üzerinden 24 V alınca yanar', () => {
    const sim = new Simulation(lampCircuit());
    sim.run(1);
    expect(p1(sim).lit).toBe(true);
    expect(sim.snapshot().potentials['X1:2']).toBe('P24');
  });

  it('acil stop basılınca lamba söner, kilit açılınca yeniden yanar', () => {
    const sim = new Simulation(lampCircuit());
    press(sim, 'S1');
    sim.run(1);
    expect(state(sim.snapshot(), 'S1', 'estop').contactClosed).toBe(false);
    expect(p1(sim).lit).toBe(false);
    release(sim, 'S1');
    sim.run(1);
    expect(p1(sim).lit).toBe(true);
  });

  it('lamba ters kutupta da yanar, dönüş hattı yoksa sönük kalır', () => {
    const s = lampCircuit();
    const reversed = new Simulation({
      ...s,
      wires: [wire('w1', 'G1:M', 'P1:X1'), wire('w2', 'P1:X2', 'G1:L+')],
    });
    reversed.run(1);
    expect(p1(reversed).lit).toBe(true);

    const open = new Simulation({ ...s, wires: s.wires.filter((w) => w.id !== 'w4') });
    open.run(1);
    expect(p1(open).lit).toBe(false);
  });

  it('motor koruma şalteri açılınca kontaktör çekili olsa da motor enerjisiz kalır', () => {
    const base = startStopSchematic();
    const schematic: Schematic = {
      ...base,
      components: [...base.components, { id: 'Q1', type: 'breaker3', name: 'Q1', ...at }],
      wires: [
        ...base.wires.filter((w) => w.a.component !== 'X1'),
        wire('q1', 'X1:L1', 'Q1:1'),
        wire('q2', 'X1:L2', 'Q1:3'),
        wire('q3', 'X1:L3', 'Q1:5'),
        wire('q4', 'Q1:2', 'K1:1'),
        wire('q5', 'Q1:4', 'K1:3'),
        wire('q6', 'Q1:6', 'K1:5'),
      ],
    };
    const sim = new Simulation(schematic);
    startMotor(sim);
    expect(m1(sim).powered).toBe(true);

    sim.enqueue({ type: 'switch', component: 'Q1', closed: false });
    sim.run(10);
    expect(state(sim.snapshot(), 'Q1', 'breaker3').closed).toBe(false);
    expect(k1(sim).closed).toBe(true);
    expect(m1(sim).powered).toBe(false);

    sim.enqueue({ type: 'switch', component: 'Q1', closed: true });
    sim.run(10);
    expect(m1(sim).powered).toBe(true);
  });
});
