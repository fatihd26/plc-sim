// v0.3 çekirdek özellikleri: koruma açmaları, gerilim seviyeleri, parametreler, kullanıcı bileşeni,
// PLC başına program, sembol tablosu ve ladder düzenleme.

import { describe, expect, it } from 'vitest';
import type { CustomDef } from './catalog';
import { startStopSchematic } from './examples';
import { compileProgram, type LadderProgram } from './ladder';
import { addNetwork, addParallel, addSeries, removeContact, updateContact } from './ladderEdit';
import { startStopProgram } from './programs';
import { migrateSchematic, validateSchematic, type ComponentInstance, type Schematic, type Wire } from './schematic';
import { Simulation, type ComponentState, type SimSnapshot } from './simulation';
import { buildSymbolTable, symbolName } from './symbolTable';

const at = { x: 0, y: 0, rotation: 0 as const };
let wn = 0;
const wire = (a: string, b: string): Wire => {
  const [ac, at_] = a.split(':') as [string, string];
  const [bc, bt] = b.split(':') as [string, string];
  return { id: `w${++wn}`, a: { component: ac, terminal: at_ }, b: { component: bc, terminal: bt } };
};
const comp = (id: string, type: ComponentInstance['type'], extra: Partial<ComponentInstance> = {}): ComponentInstance => ({
  id,
  type,
  name: id,
  ...at,
  ...extra,
});
const sch = (components: ComponentInstance[], wires: Wire[]): Schematic => ({ version: 2, components, wires });

function state<T extends ComponentState['type']>(s: SimSnapshot, id: string, type: T) {
  const c = s.components[id];
  if (c?.type !== type) throw new Error(`${id} ${type} değil`);
  return c as ComponentState & { type: T };
}

describe('koruma', () => {
  const motorOnBreaker = (loadPct: number, tauS: number) =>
    sch(
      [
        comp('X1', 'mains3'),
        comp('Q1', 'breaker3', { params: { setCurrentA: 4, tauS } }),
        comp('M1', 'motor3', { params: { ratedCurrentA: 4, loadPct } }),
      ],
      [
        wire('X1:L1', 'Q1:1'),
        wire('X1:L2', 'Q1:3'),
        wire('X1:L3', 'Q1:5'),
        wire('Q1:2', 'M1:U'),
        wire('Q1:4', 'M1:V'),
        wire('Q1:6', 'M1:W'),
      ],
    );

  it('motor koruma şalteri aşırı yükte kendiliğinden açar, soğumadan kapatılamaz', () => {
    const sim = new Simulation(motorOnBreaker(250, 1));
    for (let i = 0; i < 3000 && !state(sim.snapshot(), 'Q1', 'breaker3').tripped; i++) sim.step();
    sim.step(); // motor, açmayı bir sonraki tick'te görür (faz sırası)
    const snap = sim.snapshot();
    const q = state(snap, 'Q1', 'breaker3');
    expect(q.tripped).toBe(true);
    expect(q.closed).toBe(false);
    expect(state(snap, 'M1', 'motor3').powered).toBe(false);
    expect(snap.events.some((e) => /Q1: aşırı akımda açtı/.test(e.text))).toBe(true);

    sim.enqueue({ type: 'switch', component: 'Q1', closed: true });
    sim.run(1);
    expect(state(sim.snapshot(), 'Q1', 'breaker3').closed).toBe(false);
    expect(sim.snapshot().events.at(-1)?.text).toMatch(/soğumadı/);

    sim.run(5000); // τ = 1 s: soğur
    sim.enqueue({ type: 'switch', component: 'Q1', closed: true });
    sim.run(1);
    expect(state(sim.snapshot(), 'Q1', 'breaker3')).toMatchObject({ closed: true, tripped: false });
  });

  it('nominal yükte şalter açmaz', () => {
    const sim = new Simulation(motorOnBreaker(100, 300));
    sim.run(5000);
    const q = state(sim.snapshot(), 'Q1', 'breaker3');
    expect(q.tripped).toBe(false);
    expect(q.currentA).toBeCloseTo(4, 1);
  });

  it('motor akımı yük oranıyla değişir', () => {
    const sim = new Simulation(motorOnBreaker(50, 300));
    sim.run(5000);
    expect(state(sim.snapshot(), 'M1', 'motor3').currentA).toBeCloseTo(2, 1);
  });

  const fuseCircuit = () =>
    sch(
      [comp('G1', 'psu24'), comp('F1', 'fuse'), comp('S1', 'buttonNO'), comp('P1', 'lamp')],
      [
        wire('G1:L+', 'F1:1'),
        wire('F1:2', 'S1:13'),
        wire('S1:14', 'G1:M'),
        wire('G1:L+', 'P1:X1'),
        wire('P1:X2', 'G1:M'),
      ],
    );

  it('kısa devrede arızaya en yakın koruma (sigorta) açar, kaynak çalışmaya devam eder', () => {
    const sim = new Simulation(fuseCircuit());
    sim.enqueue({ type: 'button', component: 'S1', pressed: true });
    sim.run(2);
    let snap = sim.snapshot();
    expect(snap.shorts).toEqual([]);
    expect(state(snap, 'F1', 'fuse')).toMatchObject({ closed: false, tripped: true });
    expect(state(snap, 'G1', 'psu24').limited).toBe(false);
    expect(state(snap, 'P1', 'lamp').lit).toBe(true);
    expect(snap.events.at(-1)?.text).toBe('F1: kısa devrede açtı');

    // Arıza kalkmadan kapatılırsa yeniden açar; kalkınca kapalı kalır
    sim.enqueue({ type: 'switch', component: 'F1', closed: true });
    sim.run(1);
    expect(state(sim.snapshot(), 'F1', 'fuse').tripped).toBe(true);
    sim.enqueue({ type: 'button', component: 'S1', pressed: false });
    sim.enqueue({ type: 'switch', component: 'F1', closed: true });
    sim.run(1);
    snap = sim.snapshot();
    expect(state(snap, 'F1', 'fuse')).toMatchObject({ closed: true, tripped: false });
  });

  it('koruması olmayan kısa devre raporlanır', () => {
    const sim = new Simulation(sch([comp('X1', 'mains3')], [wire('X1:L1', 'X1:L2')]));
    sim.run(1);
    expect(sim.snapshot().shorts).toHaveLength(1);
  });

  it('şebekede kısa devrede motor koruma şalteri manyetik açar', () => {
    const s = motorOnBreaker(100, 300);
    s.wires.push(wire('M1:U', 'M1:V'));
    const sim = new Simulation(s);
    sim.run(1);
    const snap = sim.snapshot();
    expect(snap.shorts).toEqual([]);
    expect(state(snap, 'Q1', 'breaker3').tripped).toBe(true);
  });
});

describe('gerilim seviyeleri', () => {
  const lampOn = (voltage: string, a: string, b: string) => {
    const sim = new Simulation(
      sch([comp('X1', 'mains3'), comp('P1', 'lamp', { params: { voltage } })], [wire(a, 'P1:X1'), wire('P1:X2', b)]),
    );
    sim.run(1);
    return state(sim.snapshot(), 'P1', 'lamp');
  };

  it('230 V AC lamba faz-nötr arasında yanar', () => {
    expect(lampOn('230AC', 'X1:L1', 'X1:N')).toMatchObject({ lit: true, fault: null });
  });

  it('24 V DC lamba şebekeye bağlanırsa yanmaz, aşırı gerilim arızası verir', () => {
    expect(lampOn('24DC', 'X1:L1', 'X1:N')).toMatchObject({ lit: false, fault: 'Aşırı gerilim (AC)' });
  });

  it('230 V lamba iki faz arasında (400 V) arıza verir', () => {
    expect(lampOn('230AC', 'X1:L1', 'X1:L2')).toMatchObject({ lit: false, fault: 'Aşırı gerilim (400 V)' });
  });

  it('230 V AC bobinli kontaktör parametredeki çekme süresinden sonra kapanır', () => {
    const sim = new Simulation(
      sch(
        [comp('X1', 'mains3'), comp('K1', 'contactor', { params: { coilVoltage: '230AC', pickupMs: 50 } })],
        [wire('X1:L1', 'K1:A1'), wire('K1:A2', 'X1:N')],
      ),
    );
    sim.run(45);
    expect(state(sim.snapshot(), 'K1', 'contactor')).toMatchObject({ coilEnergized: true, closed: false });
    sim.run(10);
    expect(state(sim.snapshot(), 'K1', 'contactor').closed).toBe(true);
  });
});

describe('parametreler ve program', () => {
  it('PLC scan süresi bileşen parametresinden gelir', () => {
    const s = startStopSchematic();
    s.components.find((c) => c.id === 'A1')!.params = { scanTimeMs: 25 };
    const sim = new Simulation(s);
    sim.run(100);
    const plc = state(sim.snapshot(), 'A1', 'plc');
    expect(plc.scanTimeMs).toBe(25);
    expect(plc.scanCount).toBe(4);
  });

  it('her PLC kendi programını çalıştırır', () => {
    const s = startStopSchematic();
    const program: LadderProgram = structuredClone(startStopProgram);
    program.networks[0]!.coil.address = '%Q0.1'; // K1 artık sürülmüyor
    s.components.find((c) => c.id === 'A1')!.program = program;
    const sim = new Simulation(s);
    sim.enqueue({ type: 'button', component: 'S1', pressed: true });
    sim.run(100);
    const plc = state(sim.snapshot(), 'A1', 'plc');
    expect(plc.dqTerminals[1]).toBe(true);
    expect(state(sim.snapshot(), 'K1', 'contactor').closed).toBe(false);
  });

  it('geçersiz parametre ve program şema doğrulamasında yakalanır', () => {
    const s = startStopSchematic();
    s.components.find((c) => c.id === 'K1')!.params = { yok: 1 };
    s.components.find((c) => c.id === 'A1')!.program = {
      networks: [{ id: 'N1', title: '', logic: { kind: 'contact', id: 'c', address: '%X9.9', contact: 'NO' }, coil: { id: 'q', address: '%Q0.0' } }],
    };
    const errors = validateSchematic(s);
    expect(errors.some((e) => e.includes('bilinmeyen parametre'))).toBe(true);
    expect(errors.some((e) => e.includes('A1 programı'))).toBe(true);
  });

  it('v1 dosyası v2 biçimine taşınır', () => {
    const v1 = { ...startStopSchematic(), version: 1 } as unknown;
    expect(validateSchematic(migrateSchematic(v1))).toEqual([]);
  });
});

describe('kullanıcı tanımlı bileşen', () => {
  const def: CustomDef = {
    id: 'u1',
    title: 'Butonlu röle',
    prefix: 'KA',
    voltage: '24DC',
    poles: [
      { kind: 'pushNO', top: '1', bottom: '2' },
      { kind: 'coil', top: 'A1', bottom: 'A2' },
      { kind: 'NO', top: '13', bottom: '14' },
    ],
  };

  it('butona basınca bobin çeker, NO kontak lambayı yakar', () => {
    const sim = new Simulation(
      sch(
        [comp('G1', 'psu24'), comp('KA1', 'custom', { custom: def }), comp('P1', 'lamp')],
        [
          wire('G1:L+', 'KA1:1'),
          wire('KA1:2', 'KA1:A1'),
          wire('KA1:A2', 'G1:M'),
          wire('G1:L+', 'KA1:13'),
          wire('KA1:14', 'P1:X1'),
          wire('P1:X2', 'G1:M'),
        ],
      ),
    );
    sim.run(30);
    expect(state(sim.snapshot(), 'P1', 'lamp').lit).toBe(false);
    sim.enqueue({ type: 'button', component: 'KA1', pressed: true });
    sim.run(30);
    const snap = sim.snapshot();
    expect(state(snap, 'KA1', 'custom')).toMatchObject({ pressed: true, coilEnergized: true, actuated: true });
    expect(state(snap, 'KA1', 'custom').poles).toEqual([true, true, true]);
    expect(state(snap, 'P1', 'lamp').lit).toBe(true);
  });
});

describe('sembol tablosu', () => {
  it('PLC adresleri şemadaki elemanlara kablolamadan eşlenir', () => {
    const t = buildSymbolTable(startStopSchematic(), 'A1');
    expect(t['%I0.0']).toEqual(['S1:14']);
    expect(t['%I0.1']).toEqual(['S2:12']);
    expect(t['%I0.2']).toEqual(['F2:96']);
    expect(t['%Q0.0']).toEqual(['K1:A1']);
    expect(t['%I0.3']).toBeUndefined();
    expect(symbolName(t, 'i0.0')).toBe('S1');
  });

  it('eleman adı veya kablolama değişince etiket kendiliğinden güncellenir; klemens üzerinden izlenir', () => {
    const s = startStopSchematic();
    s.components.find((c) => c.id === 'S1')!.name = 'S10';
    s.components.push(comp('X5', 'terminal'));
    s.wires = s.wires.filter((w) => !(w.a.component === 'S2' && w.b.terminal === 'I0.1'));
    s.wires.push(wire('S2:12', 'X5:1'), wire('X5:2', 'A1:I0.1'));
    const t = buildSymbolTable(s, 'A1');
    expect(symbolName(t, '%I0.0')).toBe('S10');
    expect(t['%I0.1']).toEqual(['S2:12']);
  });
});

describe('ladder düzenleme', () => {
  const base = (): LadderProgram => addNetwork({ networks: [] }).program;

  it('seri ve paralel ekleme geçerli ve normalize bir ağaç üretir', () => {
    let p = base();
    const first = (p.networks[0]!.logic as { id: string }).id;
    const s = addSeries(p, first);
    p = s.program;
    const par = addParallel(p, s.contactId!);
    p = par.program;
    expect(() => compileProgram(p)).not.toThrow();
    const logic = p.networks[0]!.logic;
    expect(logic.kind).toBe('series');
    if (logic.kind !== 'series') return;
    expect(logic.items).toHaveLength(2);
    expect(logic.items[1]!.kind).toBe('parallel');
    // Paralel daldan silince grup tek kontağa indirgenir
    p = removeContact(p, par.contactId!);
    const after = p.networks[0]!.logic;
    expect(after.kind === 'series' && after.items.every((n) => n.kind === 'contact')).toBe(true);
  });

  it('network\'ün son kontağı silinemez; boş açıklama kaldırılır', () => {
    let p = base();
    const id = (p.networks[0]!.logic as { id: string }).id;
    expect(removeContact(p, id)).toBe(p);
    p = updateContact(p, id, { label: 'x', contact: 'NC', address: '%I0.3' });
    p = updateContact(p, id, { label: '' });
    expect(p.networks[0]!.logic).toEqual({ kind: 'contact', id, address: '%I0.3', contact: 'NC' });
  });

  it('eklenen network\'ler benzersiz kimlik alır', () => {
    let p = base();
    p = addNetwork(p).program;
    p = addNetwork(p).program;
    expect(() => compileProgram(p)).not.toThrow();
    expect(p.networks.map((n) => n.id)).toEqual(['N1', 'N2', 'N3']);
  });
});
