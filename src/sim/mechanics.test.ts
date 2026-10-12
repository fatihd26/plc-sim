// Mekanik elemanlar: silindir, konveyör, depo modelleri ve PLC ile kapalı çevrim.

import { describe, expect, it } from 'vitest';
import { Conveyor, Cylinder, Tank } from './devices';
import { conveyorSchematic, EXAMPLES, fanSchematic, pistonSchematic, tankSchematic } from './examples';
import type { LadderProgram } from './ladder';
import { validateSchematic, type ComponentInstance, type Schematic, type Wire } from './schematic';
import { Simulation, type ComponentState, type SimSnapshot } from './simulation';

let wn = 0;
const wire = (a: string, b: string): Wire => {
  const [ac, at] = a.split(':') as [string, string];
  const [bc, bt] = b.split(':') as [string, string];
  return { id: `w${++wn}`, a: { component: ac, terminal: at }, b: { component: bc, terminal: bt } };
};
const comp = (id: string, type: ComponentInstance['type'], extra: Partial<ComponentInstance> = {}): ComponentInstance => ({
  id,
  type,
  name: id,
  x: 0,
  y: 0,
  rotation: 0,
  ...extra,
});
const sch = (components: ComponentInstance[], wires: Wire[]): Schematic => ({ version: 2, components, wires });

function state<T extends ComponentState['type']>(s: SimSnapshot, id: string, type: T) {
  const c = s.components[id];
  if (c?.type !== type) throw new Error(`${id} ${type} değil`);
  return c as ComponentState & { type: T };
}

const run = (sim: Simulation, ms: number, until?: (s: SimSnapshot) => boolean) => {
  for (let i = 0; i < ms; i++) {
    sim.step();
    if (until?.(sim.snapshot())) return true;
  }
  return false;
};

describe('cihaz modelleri', () => {
  it('silindir verilen sürede ileri gider, uç sensörleri yalnız uçlarda algılar', () => {
    const c = new Cylinder({ extendMs: 1000, retractMs: 500 });
    expect(c.retracted).toBe(true);
    for (let i = 0; i < 500; i++) c.update(true, 1);
    expect(c.position).toBeCloseTo(0.5);
    expect(c.retracted || c.extended).toBe(false);
    for (let i = 0; i < 500; i++) c.update(true, 1);
    expect(c.extended).toBe(true);
    for (let i = 0; i < 500; i++) c.update(false, 1);
    expect(c.position).toBeCloseTo(0);
    expect(c.retracted).toBe(true);
  });

  it('konveyör kutuyu taşır, fotosel algılar, sondan düşen kutu teslim sayılır', () => {
    const c = new Conveyor({ transitMs: 1000, feedMs: 0 });
    expect(c.addBox()).toBe(true);
    expect(c.addBox()).toBe(false); // başta yer yok
    let seen = false;
    for (let i = 0; i < 1000; i++) {
      c.update(1, 1);
      seen ||= c.sensorBlocked;
    }
    expect(seen).toBe(true);
    expect(c.boxes).toHaveLength(0);
    expect(c.delivered).toBe(1);
  });

  it('duran bantta kutu yerinde kalır; otomatik besleme yer açılınca kutu koyar', () => {
    const c = new Conveyor({ transitMs: 1000, feedMs: 100 });
    for (let i = 0; i < 500; i++) c.update(0, 1);
    expect(c.boxes).toEqual([0]);
    for (let i = 0; i < 400; i++) c.update(1, 1);
    expect(c.boxes.length).toBeGreaterThan(1);
  });

  it('depo pompayla dolar, tüketimle boşalır, dolu depoya basılınca taşar', () => {
    const t = new Tank({ fillMs: 1000, drainMs: 0, initialLevel: 0 });
    expect(t.lowWet).toBe(false);
    for (let i = 0; i < 500; i++) t.update(1, 1);
    expect(t.lowWet && !t.highWet).toBe(true);
    for (let i = 0; i < 600; i++) t.update(1, 1);
    expect(t.level).toBe(1);
    expect(t.overflowing).toBe(true);
    const d = new Tank({ fillMs: 1000, drainMs: 1000, initialLevel: 0.5 });
    for (let i = 0; i < 600; i++) d.update(0, 1);
    expect(d.level).toBe(0);
    expect(d.overflowing).toBe(false);
  });
});

describe('simülasyonda mekanik elemanlar', () => {
  /**
   * Otomatik piston çevrimi: S1'e basınca piston ileri gider, ileri uç sensörü (23-24) gelince
   * valf bırakılır ve piston geri döner.
   *   (%I0.0 S1 | %Q0.0) & /%I0.1 (ileri sensör) → %Q0.0 valf
   */
  const cycleProgram: LadderProgram = {
    networks: [
      {
        id: 'N1',
        title: 'Piston çevrimi',
        logic: {
          kind: 'series',
          id: 's',
          items: [
            {
              kind: 'parallel',
              id: 'p',
              branches: [
                { kind: 'contact', id: 'start', address: '%I0.0', contact: 'NO' },
                { kind: 'contact', id: 'hold', address: '%Q0.0', contact: 'NO' },
              ],
            },
            { kind: 'contact', id: 'end', address: '%I0.1', contact: 'NC' },
          ],
        },
        coil: { id: 'c', address: '%Q0.0' },
      },
    ],
  };

  const pistonCell = () =>
    sch(
      [
        comp('G1', 'psu24'),
        comp('S1', 'buttonNO'),
        comp('A1', 'plc', { program: cycleProgram }),
        comp('Y1', 'cylinder', { params: { extendMs: 300, retractMs: 300 } }),
        comp('K1', 'relay'),
      ],
      [
        wire('G1:L+', 'A1:L+'),
        wire('G1:M', 'A1:M'),
        wire('G1:L+', 'S1:13'),
        wire('S1:14', 'A1:I0.0'),
        wire('G1:L+', 'Y1:23'),
        wire('Y1:24', 'A1:I0.1'),
        // PLC çıkışı yalnız röle bobinini sürer; valfi rölenin kontağı besler.
        wire('A1:Q0.0', 'K1:A1'),
        wire('K1:A2', 'G1:M'),
        wire('G1:L+', 'K1:13'),
        wire('K1:14', 'Y1:A1'),
        wire('Y1:A2', 'G1:M'),
      ],
    );

  it('şema geçerli: yeni tiplerin terminalleri ve parametreleri tanınır', () => {
    expect(validateSchematic(pistonCell())).toEqual([]);
  });

  it('PLC ile kapalı çevrim: piston ileri gider, uç sensörüyle kendiliğinden geri döner', () => {
    const sim = new Simulation(pistonCell());
    sim.run(50);
    expect(state(sim.snapshot(), 'Y1', 'cylinder').retracted).toBe(true);

    sim.enqueue({ type: 'button', component: 'S1', pressed: true });
    sim.run(30);
    sim.enqueue({ type: 'button', component: 'S1', pressed: false });

    expect(run(sim, 1000, (s) => state(s, 'Y1', 'cylinder').extended)).toBe(true);
    // Uç sensörü PLC'ye ulaşınca mühür bırakır; piston geri döner ve geride kalır
    expect(run(sim, 1000, (s) => state(s, 'Y1', 'cylinder').retracted)).toBe(true);
    sim.run(500);
    const y = state(sim.snapshot(), 'Y1', 'cylinder');
    expect(y.retracted).toBe(true);
    expect(y.valve).toBe(false);
  });

  it('24 V valf bobini 230 V AC görünce çekmez, arıza verir', () => {
    const sim = new Simulation(
      sch(
        [comp('X1', 'mains3'), comp('Y1', 'cylinder')],
        [wire('X1:L1', 'Y1:A1'), wire('X1:N', 'Y1:A2')],
      ),
    );
    sim.run(100);
    const y = state(sim.snapshot(), 'Y1', 'cylinder');
    expect(y.valve).toBe(false);
    expect(y.fault).not.toBeNull();
  });

  const threePhase = (id: string) => [wire('X1:L1', `${id}:U`), wire('X1:L2', `${id}:V`), wire('X1:L3', `${id}:W`)];

  it('konveyör 3~ ile döner; fotosel kontağı kutu gelince 24 V sinyali geçirir', () => {
    const sim = new Simulation(
      sch(
        [
          comp('X1', 'mains3'),
          comp('G1', 'psu24'),
          comp('M1', 'conveyor', { params: { transitS: 1, feedS: 0, startTauMs: 10 } }),
          comp('P1', 'lamp'),
        ],
        [...threePhase('M1'), wire('G1:L+', 'M1:13'), wire('M1:14', 'P1:X1'), wire('P1:X2', 'G1:M')],
      ),
    );
    sim.enqueue({ type: 'addBox', component: 'M1' });
    // Lamba sensörü bir tick geriden izler (bağlantılar tick başında çözülür).
    let litTicks = 0;
    let sensorTicks = 0;
    for (let i = 0; i < 1500; i++) {
      sim.step();
      const s = sim.snapshot();
      if (state(s, 'P1', 'lamp').lit) litTicks++;
      if (state(s, 'M1', 'conveyor').sensor) sensorTicks++;
    }
    expect(litTicks).toBeGreaterThan(50);
    expect(Math.abs(litTicks - sensorTicks)).toBeLessThanOrEqual(1);
    const m = state(sim.snapshot(), 'M1', 'conveyor');
    expect(m.powered).toBe(true);
    expect(m.delivered).toBe(1);
  });

  it('ters faz sırasında bant geri döner ve kutu baştan düşer', () => {
    const sim = new Simulation(
      sch(
        [comp('X1', 'mains3'), comp('M1', 'conveyor', { params: { transitS: 1, feedS: 0 } })],
        [wire('X1:L2', 'M1:U'), wire('X1:L1', 'M1:V'), wire('X1:L3', 'M1:W')],
      ),
    );
    sim.enqueue({ type: 'addBox', component: 'M1' });
    sim.run(1000);
    const m = state(sim.snapshot(), 'M1', 'conveyor');
    expect(m.direction).toBe(-1);
    expect(m.boxes).toHaveLength(0);
    expect(m.delivered).toBe(0);
  });

  it('pompa depoyu doldurur, seviye sensörleri sırayla kapanır, taşma olay olarak bildirilir', () => {
    const sim = new Simulation(
      sch(
        [comp('X1', 'mains3'), comp('M1', 'pump', { params: { fillS: 1, drainS: 0, initialPct: 0, startTauMs: 10 } })],
        threePhase('M1'),
      ),
    );
    expect(run(sim, 1000, (s) => state(s, 'M1', 'pump').low)).toBe(true);
    expect(state(sim.snapshot(), 'M1', 'pump').high).toBe(false);
    expect(run(sim, 1000, (s) => state(s, 'M1', 'pump').high)).toBe(true);
    sim.run(500);
    const s = sim.snapshot();
    expect(state(s, 'M1', 'pump').overflowing).toBe(true);
    expect(s.events.some((e) => e.component === 'M1' && e.text.includes('taştı'))).toBe(true);
  });

  it('termik röle konveyör motorunun akımını da taşır', () => {
    const sim = new Simulation(
      sch(
        [
          comp('X1', 'mains3'),
          comp('F1', 'thermal', { params: { setCurrentA: 2, tauS: 300 } }),
          comp('M1', 'conveyor', { params: { ratedCurrentA: 2, feedS: 0 } }),
        ],
        [
          wire('X1:L1', 'F1:1'),
          wire('X1:L2', 'F1:3'),
          wire('X1:L3', 'F1:5'),
          wire('F1:2', 'M1:U'),
          wire('F1:4', 'M1:V'),
          wire('F1:6', 'M1:W'),
        ],
      ),
    );
    sim.run(5000);
    expect(state(sim.snapshot(), 'F1', 'thermal').currentA).toBeCloseTo(2, 1);
  });

  it('fan anma geriliminde döner', () => {
    const sim = new Simulation(
      sch([comp('X1', 'mains3'), comp('E1', 'fan')], [wire('X1:L1', 'E1:X1'), wire('X1:N', 'E1:X2')]),
    );
    sim.run(3000);
    const f = state(sim.snapshot(), 'E1', 'fan');
    expect(f.powered).toBe(true);
    expect(f.rpm).toBeGreaterThan(1000);
  });
});

describe('örnek şemalar', () => {
  const press = (sim: Simulation, id: string) => {
    sim.enqueue({ type: 'button', component: id, pressed: true });
    sim.run(50);
    sim.enqueue({ type: 'button', component: id, pressed: false });
    sim.run(50);
  };
  /** Koşul sağlanana dek 10 ms'lik adımlarla ilerler. */
  const until = (sim: Simulation, ms: number, cond: (s: SimSnapshot) => boolean) => {
    for (let t = 0; t < ms; t += 10) {
      sim.run(10);
      if (cond(sim.snapshot())) return true;
    }
    return false;
  };

  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s: geçerli ve simülasyon kurulur', (_, e) => {
    const s = e.build();
    expect(validateSchematic(s)).toEqual([]);
    expect(() => new Simulation(s).run(20)).not.toThrow();
  });

  it('fan: start çalıştırır, stop durdurur', () => {
    const sim = new Simulation(fanSchematic());
    press(sim, 'S1');
    expect(until(sim, 3000, (s) => state(s, 'E1', 'fan').rpm > 1000)).toBe(true);
    press(sim, 'S2');
    expect(state(sim.snapshot(), 'E1', 'fan').powered).toBe(false);
  });

  it('piston: start ile bir kez ileri gidip geri döner', () => {
    const sim = new Simulation(pistonSchematic());
    sim.run(50);
    press(sim, 'S1');
    expect(until(sim, 3000, (s) => state(s, 'Y1', 'cylinder').extended)).toBe(true);
    expect(until(sim, 3000, (s) => state(s, 'Y1', 'cylinder').retracted)).toBe(true);
    sim.run(2000);
    expect(state(sim.snapshot(), 'Y1', 'cylinder').retracted).toBe(true);
  });

  it('konveyör: kutu fotoselde bandı durdurur, start kutuyu gönderir', () => {
    const sim = new Simulation(conveyorSchematic());
    sim.run(50);
    press(sim, 'S1');
    expect(state(sim.snapshot(), 'M1', 'conveyor').powered).toBe(true);
    expect(until(sim, 20_000, (s) => state(s, 'M1', 'conveyor').sensor)).toBe(true);
    sim.run(200);
    let s = sim.snapshot();
    expect(state(s, 'M1', 'conveyor').powered).toBe(false);
    expect(state(s, 'P1', 'lamp').lit).toBe(true);
    // Start basılı tutulunca kutu fotoseli geçer, mühür bandı tekrar tutar
    sim.enqueue({ type: 'button', component: 'S1', pressed: true });
    expect(until(sim, 5000, (x) => !state(x, 'M1', 'conveyor').sensor)).toBe(true);
    sim.enqueue({ type: 'button', component: 'S1', pressed: false });
    sim.run(200);
    s = sim.snapshot();
    expect(state(s, 'M1', 'conveyor').powered).toBe(true);
    expect(until(sim, 10_000, (x) => state(x, 'M1', 'conveyor').delivered === 1)).toBe(true);
  });

  it('depo: otomatikte seviye alt ve üst sensör arasında tutulur', () => {
    const sim = new Simulation(tankSchematic());
    sim.run(50);
    press(sim, 'S1');
    expect(until(sim, 10_000, (s) => state(s, 'M1', 'pump').powered)).toBe(true);
    expect(state(sim.snapshot(), 'M1', 'pump').level).toBeLessThan(0.21);
    expect(until(sim, 30_000, (s) => !state(s, 'M1', 'pump').powered)).toBe(true);
    let s = sim.snapshot();
    expect(state(s, 'M1', 'pump').level).toBeGreaterThan(0.79);
    expect(state(s, 'P1', 'lamp').lit).toBe(true);
    // Tüketimle seviye düşer, pompa yeniden çalışır; hiç taşmaz
    expect(until(sim, 30_000, (x) => state(x, 'M1', 'pump').powered)).toBe(true);
    s = sim.snapshot();
    expect(s.events.some((e) => e.text.includes('taştı'))).toBe(false);
  });
});

describe('PLC çıkışı yükü doğrudan besleyemez', () => {
  const always: LadderProgram = {
    networks: [
      {
        id: 'N1',
        title: 'Q0.0 hep 1',
        logic: { kind: 'contact', id: 'a', address: '%I0.0', contact: 'NC' },
        coil: { id: 'c', address: '%Q0.0' },
      },
    ],
  };
  const base = [comp('G1', 'psu24'), comp('A1', 'plc', { program: always })];
  const supply = [wire('G1:L+', 'A1:L+'), wire('G1:M', 'A1:M')];

  it.each([
    ['lamp', 'P1', 'X1', 'X2'],
    ['fan', 'E1', 'X1', 'X2'],
    ['cylinder', 'Y1', 'A1', 'A2'],
  ] as const)('%s doğrudan PLC çıkışında çalışmaz ve arıza verir', (type, id, a, b) => {
    const sim = new Simulation(
      sch([...base, comp(id, type)], [...supply, wire('A1:Q0.0', `${id}:${a}`), wire(`${id}:${b}`, 'G1:M')]),
    );
    sim.run(100);
    const s = sim.snapshot();
    expect((s.components[id] as { fault: string | null }).fault).toMatch(/röle/);
    if (type === 'lamp') expect(state(s, id, 'lamp').lit).toBe(false);
    if (type === 'fan') expect(state(s, id, 'fan').powered).toBe(false);
    if (type === 'cylinder') expect(state(s, id, 'cylinder').valve).toBe(false);
    expect(s.events.some((e) => /röle/.test(e.text))).toBe(true);
  });

  it('röle üzerinden beslenen yük çalışır', () => {
    const sim = new Simulation(
      sch(
        [...base, comp('K1', 'relay'), comp('P1', 'lamp')],
        [
          ...supply,
          wire('A1:Q0.0', 'K1:A1'),
          wire('K1:A2', 'G1:M'),
          wire('G1:L+', 'K1:13'),
          wire('K1:14', 'P1:X1'),
          wire('P1:X2', 'G1:M'),
        ],
      ),
    );
    sim.run(100);
    const s = sim.snapshot();
    expect(state(s, 'K1', 'relay').closed).toBe(true);
    expect(state(s, 'P1', 'lamp')).toMatchObject({ lit: true, fault: null });
  });

  it('örneklerde hiçbir yük PLC çıkışına doğrudan bağlı değil', () => {
    for (const ex of EXAMPLES) {
      const sim = new Simulation(ex.build());
      sim.run(200);
      const faults = Object.values(sim.snapshot().components).filter((c) => 'fault' in c && /röle/.test(String(c.fault)));
      expect(faults, ex.id).toEqual([]);
    }
  });
});
