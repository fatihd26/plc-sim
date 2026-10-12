// Genişletilmiş ladder komut seti: kenar kontakları, karşılaştırma, set/reset, zamanlayıcı ve sayıcılar.

import { describe, expect, it } from 'vitest';
import { formatAddress, parseOperand, parseValue, type BitAddress } from './address';
import { timerCounterSchematic } from './examples';
import { INSTRUCTIONS } from './instructions';
import {
  compileProgram,
  createRuntime,
  executeProgram,
  type Coil,
  type LadderNode,
  type LadderProgram,
  type Runtime,
} from './ladder';
import { addNetwork, findElement, insertInstruction, setOutputType } from './ladderEdit';
import { validateSchematic } from './schematic';
import { Simulation, type SimSnapshot } from './simulation';

const no = (id: string, address: string): LadderNode => ({ kind: 'contact', id, address, contact: 'NO' });

/** Program + bellek + çalışma zamanı; `scan(dt)` bir scan çalıştırır. */
function machine(networks: { logic: LadderNode; coil: Omit<Coil, 'id'> }[], initial: Record<string, boolean> = {}) {
  const program: LadderProgram = {
    networks: networks.map((n, i) => ({ id: `N${i}`, title: '', logic: n.logic, coil: { id: `N${i}.c`, ...n.coil } })),
  };
  const compiled = compileProgram(program);
  const bits = new Map<string, boolean>(Object.entries(initial));
  const rt: Runtime = createRuntime();
  return {
    rt,
    set: (addr: string, v: boolean) => bits.set(addr, v),
    get: (addr: string) => bits.get(addr) ?? false,
    scan: (dt = 10) =>
      executeProgram(
        compiled,
        (a: BitAddress) => bits.get(formatAddress(a)) ?? false,
        (a, v) => void bits.set(formatAddress(a), v),
        rt,
        dt,
      ),
  };
}

const scans = (m: { scan(dt?: number): unknown }, n: number, dt = 10) => {
  for (let i = 0; i < n; i++) m.scan(dt);
};

describe('operandlar', () => {
  it('T/C ve sabit değerleri ayrıştırır', () => {
    expect(parseOperand('t3')).toEqual({ area: 'T', index: 3 });
    expect(parseOperand('%C15')).toEqual({ area: 'C', index: 15 });
    expect(() => parseOperand('T16')).toThrow(/alan dışında/);
    expect(parseValue('-42')).toEqual({ area: 'K', value: -42 });
    expect(parseValue('C1')).toEqual({ area: 'C', index: 1 });
    expect(() => parseValue('%I0.0')).toThrow();
  });

  it('çıkış adresi türüne uygun olmalı', () => {
    const bad = (coil: Omit<Coil, 'id'>) => () => machine([{ logic: no('a', '%I0.0'), coil }]);
    expect(bad({ address: 'T0', type: 'CTU', preset: 1 })).toThrow(/C0/);
    expect(bad({ address: 'C0', type: 'TON', preset: 1 })).toThrow(/T0/);
    expect(bad({ address: 'T0', type: 'set' })).toThrow();
    expect(bad({ address: '%I0.0', type: 'reset' })).toThrow(/%I/);
    expect(bad({ address: 'T0', type: 'TON', preset: -1 })).toThrow(/ön ayar/);
    expect(bad({ address: 'C0', type: 'reset' })).not.toThrow();
  });
});

describe('bit komutları', () => {
  it('set biti tutar, reset bırakır; ters bobin tersler', () => {
    const m = machine([
      { logic: no('s', '%I0.0'), coil: { address: '%Q0.0', type: 'set' } },
      { logic: no('r', '%I0.1'), coil: { address: '%Q0.0', type: 'reset' } },
      { logic: no('x', '%I0.2'), coil: { address: '%Q0.1', type: 'ncoil' } },
    ]);
    m.scan();
    expect(m.get('%Q0.0')).toBe(false);
    expect(m.get('%Q0.1')).toBe(true);
    m.set('%I0.0', true);
    m.scan();
    m.set('%I0.0', false);
    m.scan();
    expect(m.get('%Q0.0')).toBe(true);
    m.set('%I0.1', true);
    m.scan();
    expect(m.get('%Q0.0')).toBe(false);
    m.set('%I0.2', true);
    m.scan();
    expect(m.get('%Q0.1')).toBe(false);
  });

  it('P kontak yalnız yükselen kenarda, N yalnız düşen kenarda bir scan iletir', () => {
    const m = machine([
      { logic: { kind: 'contact', id: 'p', address: '%I0.0', contact: 'P' }, coil: { address: '%Q0.0' } },
      { logic: { kind: 'contact', id: 'n', address: '%I0.0', contact: 'N' }, coil: { address: '%Q0.1' } },
    ]);
    m.scan();
    expect(m.get('%Q0.0')).toBe(false);
    m.set('%I0.0', true);
    m.scan();
    expect(m.get('%Q0.0')).toBe(true);
    m.scan();
    expect(m.get('%Q0.0')).toBe(false);
    m.set('%I0.0', false);
    m.scan();
    expect(m.get('%Q0.1')).toBe(true);
    m.scan();
    expect(m.get('%Q0.1')).toBe(false);
  });
});

describe('zamanlayıcılar', () => {
  it('TON: giriş PT kadar 1 kalınca Q; giriş düşünce sıfırlanır', () => {
    const m = machine([
      { logic: no('a', '%I0.0'), coil: { address: 'T0', type: 'TON', preset: 100 } },
      { logic: no('t', 'T0'), coil: { address: '%Q0.0' } },
    ]);
    m.set('%I0.0', true);
    scans(m, 10);
    expect(m.rt.timers[0]!.et).toBe(90);
    expect(m.get('%Q0.0')).toBe(false);
    m.scan();
    expect(m.get('%Q0.0')).toBe(true);
    m.set('%I0.0', false);
    m.scan();
    expect(m.get('%Q0.0')).toBe(false);
    expect(m.rt.timers[0]!.et).toBe(0);
  });

  it('TOF: giriş düştükten PT sonra Q = 0', () => {
    const m = machine([{ logic: no('a', '%I0.0'), coil: { address: 'T1', type: 'TOF', preset: 50 } }]);
    m.set('%I0.0', true);
    m.scan();
    expect(m.rt.timers[1]!.q).toBe(true);
    m.set('%I0.0', false);
    scans(m, 5);
    expect(m.rt.timers[1]!.q).toBe(true);
    m.scan();
    expect(m.rt.timers[1]!.q).toBe(false);
  });

  it('TP: girişin süresinden bağımsız sabit darbe', () => {
    const m = machine([{ logic: no('a', '%I0.0'), coil: { address: 'T0', type: 'TP', preset: 50 } }]);
    m.set('%I0.0', true);
    m.scan();
    m.set('%I0.0', false); // kısa basış
    expect(m.rt.timers[0]!.q).toBe(true);
    scans(m, 4);
    expect(m.rt.timers[0]!.q).toBe(true);
    m.scan();
    expect(m.rt.timers[0]!.q).toBe(false);
    m.scan();
    expect(m.rt.timers[0]!.et).toBe(0);
  });

  it('TONR: süre birikir, R ile sıfırlanır', () => {
    const m = machine([{ logic: no('a', '%I0.0'), coil: { address: 'T2', type: 'TONR', preset: 100, reset: '%I0.1' } }]);
    m.set('%I0.0', true);
    scans(m, 6); // 50 ms
    m.set('%I0.0', false);
    scans(m, 3);
    expect(m.rt.timers[2]!.et).toBe(50);
    m.set('%I0.0', true);
    scans(m, 6);
    expect(m.rt.timers[2]!.q).toBe(true);
    m.set('%I0.0', false);
    m.scan();
    expect(m.rt.timers[2]!.q).toBe(true);
    m.set('%I0.1', true);
    m.scan();
    expect(m.rt.timers[2]!.et).toBe(0);
    expect(m.rt.timers[2]!.q).toBe(false);
  });

  it('reset bobini zamanlayıcıyı sıfırlar', () => {
    const m = machine([
      { logic: no('a', '%I0.0'), coil: { address: 'T0', type: 'TONR', preset: 20 } },
      { logic: no('r', '%I0.1'), coil: { address: 'T0', type: 'reset' } },
    ]);
    m.set('%I0.0', true);
    scans(m, 4);
    expect(m.rt.timers[0]!.q).toBe(true);
    m.set('%I0.1', true);
    m.scan();
    expect(m.rt.timers[0]!.q).toBe(false);
  });
});

describe('sayıcılar', () => {
  it('CTU yükselen kenarları sayar, PV de Q, R sıfırlar', () => {
    const m = machine([
      { logic: no('a', '%I0.0'), coil: { address: 'C0', type: 'CTU', preset: 3, reset: '%I0.1' } },
      { logic: no('c', 'C0'), coil: { address: '%Q0.0' } },
    ]);
    for (let i = 0; i < 3; i++) {
      m.set('%I0.0', true);
      scans(m, 3); // basılı tutmak tek sayım
      m.set('%I0.0', false);
      m.scan();
    }
    expect(m.rt.counters[0]!.cv).toBe(3);
    expect(m.get('%Q0.0')).toBe(true);
    m.set('%I0.1', true);
    m.scan();
    expect(m.rt.counters[0]!.cv).toBe(0);
    expect(m.get('%Q0.0')).toBe(false);
  });

  it('CTD LD ile PV yükler, sıfıra inince Q', () => {
    const m = machine([{ logic: no('a', '%I0.0'), coil: { address: 'C1', type: 'CTD', preset: 2, load: '%I0.1' } }]);
    m.set('%I0.1', true);
    m.scan();
    m.set('%I0.1', false);
    expect(m.rt.counters[1]!.cv).toBe(2);
    expect(m.rt.counters[1]!.q).toBe(false);
    for (let i = 0; i < 2; i++) {
      m.set('%I0.0', true);
      m.scan();
      m.set('%I0.0', false);
      m.scan();
    }
    expect(m.rt.counters[1]!.cv).toBe(0);
    expect(m.rt.counters[1]!.q).toBe(true);
  });

  it('CTUD rung ile yukarı, CD girişi ile aşağı sayar', () => {
    const m = machine([{ logic: no('a', '%I0.0'), coil: { address: 'C2', type: 'CTUD', preset: 2, down: '%I0.2' } }]);
    const pulse = (addr: string) => {
      m.set(addr, true);
      m.scan();
      m.set(addr, false);
      m.scan();
    };
    pulse('%I0.0');
    pulse('%I0.0');
    expect(m.rt.counters[2]!.q).toBe(true);
    pulse('%I0.2');
    expect(m.rt.counters[2]!.cv).toBe(1);
    expect(m.rt.counters[2]!.q).toBe(false);
  });

  it('karşılaştırma sayıcı değeri ve geçen süreyle çalışır', () => {
    const m = machine([
      { logic: no('a', '%I0.0'), coil: { address: 'C0', type: 'CTU', preset: 10 } },
      { logic: { kind: 'compare', id: 'k', op: '>=', a: 'C0', b: '2' }, coil: { address: '%Q0.0' } },
      { logic: no('b', '%I0.1'), coil: { address: 'T0', type: 'TON', preset: 1000 } },
      { logic: { kind: 'compare', id: 'k2', op: '>', a: 'T0', b: '30' }, coil: { address: '%Q0.1' } },
    ]);
    for (let i = 0; i < 2; i++) {
      m.set('%I0.0', true);
      m.scan();
      m.set('%I0.0', false);
      m.scan();
    }
    expect(m.get('%Q0.0')).toBe(true);
    m.set('%I0.1', true);
    scans(m, 4);
    expect(m.get('%Q0.1')).toBe(false);
    m.scan();
    expect(m.get('%Q0.1')).toBe(true);
  });
});

describe('komut kütüphanesi ile düzenleme', () => {
  it('her komut boş programa eklenebilir ve program derlenir', () => {
    for (const instr of INSTRUCTIONS) {
      const r = insertInstruction({ networks: [] }, null, instr.action);
      expect(() => compileProgram(r.program), instr.key).not.toThrow();
      expect(r.selectId).toBeTruthy();
    }
  });

  it('eleman seçilenin sağına eklenir; çıkış komutu seçili network çıkışını değiştirir', () => {
    let { program, contactId } = addNetwork({ networks: [] });
    const cmp = INSTRUCTIONS.find((i) => i.key === 'CMP>=')!;
    const r1 = insertInstruction(program, contactId, cmp.action);
    expect(findElement(r1.program, r1.selectId!)?.kind).toBe('compare');
    const ton = INSTRUCTIONS.find((i) => i.key === 'TON')!;
    const r2 = insertInstruction(r1.program, contactId, ton.action);
    program = r2.program;
    expect(program.networks).toHaveLength(1);
    expect(program.networks[0]!.coil).toMatchObject({ type: 'TON', address: 'T0', preset: 3000 });
    // İkinci zamanlayıcı boştaki adresi alır.
    const r3 = insertInstruction(program, null, ton.action);
    expect(r3.program.networks[1]!.coil.address).toBe('T1');
    // Bobine geri dönünce T adresi bırakılır.
    const back = setOutputType(r3.program, r3.program.networks[0]!.id, 'coil');
    expect(back.networks[0]!.coil).toEqual({ id: program.networks[0]!.coil.id, address: '%Q0.0' });
    expect(() => compileProgram(back)).not.toThrow();
  });
});

describe('örnek: zamanlayıcı ve sayıcı', () => {
  it('3 basıştan 2 s sonra P1 yanar, sayarken P2 yanıp söner, stop sıfırlar', () => {
    const schematic = timerCounterSchematic();
    expect(validateSchematic(schematic)).toEqual([]);
    const sim = new Simulation(schematic);
    const lit = (s: SimSnapshot, id: string) => (s.components[id] as { lit: boolean }).lit;
    const press = (id: string) => {
      sim.enqueue({ type: 'button', component: id, pressed: true });
      sim.run(100);
      sim.enqueue({ type: 'button', component: id, pressed: false });
      sim.run(100);
    };
    sim.run(100);
    press('S1');
    // Flaşör: 500 ms yanık, 500 ms sönük
    const seen = new Set<boolean>();
    for (let i = 0; i < 12; i++) {
      sim.run(100);
      seen.add(lit(sim.snapshot(), 'P2'));
    }
    expect(seen).toEqual(new Set([true, false]));
    press('S1');
    press('S1');
    sim.run(1500);
    expect(lit(sim.snapshot(), 'P1')).toBe(false);
    sim.run(700);
    expect(lit(sim.snapshot(), 'P1')).toBe(true);
    expect(lit(sim.snapshot(), 'P2')).toBe(false);
    press('S2');
    expect(lit(sim.snapshot(), 'P1')).toBe(false);
    const plc = sim.snapshot().components['A1'] as { counters: { cv: number }[] };
    expect(plc.counters[0]!.cv).toBe(0);
  });
});
