import { describe, expect, it } from 'vitest';
import { bitIndex, formatAddress, parseAddress, type BitAddress } from './address';
import { compileProgram, executeProgram, type LadderNode, type LadderProgram } from './ladder';

function memory(initial: Record<string, boolean> = {}) {
  const bits = new Map<string, boolean>(Object.entries(initial));
  return {
    read: (a: BitAddress) => bits.get(formatAddress(a)) ?? false,
    write: (a: BitAddress, v: boolean) => void bits.set(formatAddress(a), v),
    get: (addr: string) => bits.get(addr) ?? false,
  };
}

const no = (id: string, address: string): LadderNode => ({ kind: 'contact', id, address, contact: 'NO' });
const nc = (id: string, address: string): LadderNode => ({ kind: 'contact', id, address, contact: 'NC' });

function single(logic: LadderNode, coil = '%Q0.0'): LadderProgram {
  return { networks: [{ id: 'N1', title: 't', logic, coil: { id: 'C1', address: coil } }] };
}

describe('adresleme', () => {
  it('geçerli adresleri ayrıştırır', () => {
    expect(parseAddress('%I0.1')).toEqual({ area: 'I', byte: 0, bit: 1 });
    expect(parseAddress('q1.7')).toEqual({ area: 'Q', byte: 1, bit: 7 });
    expect(bitIndex(parseAddress('%M2.3'))).toBe(19);
  });

  it('geçersiz adresleri reddeder', () => {
    expect(() => parseAddress('%I0.8')).toThrow();
    expect(() => parseAddress('%X0.0')).toThrow();
    expect(() => parseAddress('%I9.0')).toThrow(/alan dışında/);
  });
});

describe('ladder değerlendirme', () => {
  it('NO kontak bit 1 iken iletir', () => {
    const p = compileProgram(single(no('a', '%I0.0')));
    const m = memory({ '%I0.0': true });
    executeProgram(p, m.read, m.write);
    expect(m.get('%Q0.0')).toBe(true);

    const m0 = memory();
    executeProgram(p, m0.read, m0.write);
    expect(m0.get('%Q0.0')).toBe(false);
  });

  it('NC kontak bit 0 iken iletir', () => {
    const p = compileProgram(single(nc('a', '%I0.0')));
    const m0 = memory();
    executeProgram(p, m0.read, m0.write);
    expect(m0.get('%Q0.0')).toBe(true);

    const m1 = memory({ '%I0.0': true });
    executeProgram(p, m1.read, m1.write);
    expect(m1.get('%Q0.0')).toBe(false);
  });

  it('seri = VE, paralel = VEYA', () => {
    const logic: LadderNode = {
      kind: 'series',
      id: 's',
      items: [{ kind: 'parallel', id: 'p', branches: [no('a', '%I0.0'), no('b', '%I0.1')] }, no('c', '%I0.2')],
    };
    const p = compileProgram(single(logic));
    const cases: [boolean, boolean, boolean, boolean][] = [
      [false, false, true, false],
      [true, false, true, true],
      [false, true, true, true],
      [true, true, false, false],
    ];
    for (const [a, b, c, expected] of cases) {
      const m = memory({ '%I0.0': a, '%I0.1': b, '%I0.2': c });
      executeProgram(p, m.read, m.write);
      expect(m.get('%Q0.0')).toBe(expected);
    }
  });

  it('izleme verisi kontak durumunu güçten bağımsız raporlar', () => {
    const logic: LadderNode = { kind: 'series', id: 's', items: [no('a', '%I0.0'), no('b', '%I0.1')] };
    const p = compileProgram(single(logic));
    const m = memory({ '%I0.0': false, '%I0.1': true });
    const trace = executeProgram(p, m.read, m.write);
    expect(trace['a']).toEqual({ powerIn: true, powerOut: false, closed: false });
    expect(trace['b']).toEqual({ powerIn: false, powerOut: false, closed: true });
    expect(trace['C1']).toEqual({ powerIn: false, powerOut: false });
  });

  it('bobin yazımı sonraki network tarafından aynı scan içinde görülür', () => {
    const program: LadderProgram = {
      networks: [
        { id: 'N1', title: '', logic: no('a', '%I0.0'), coil: { id: 'C1', address: '%M0.0' } },
        { id: 'N2', title: '', logic: no('b', '%M0.0'), coil: { id: 'C2', address: '%Q0.0' } },
      ],
    };
    const m = memory({ '%I0.0': true });
    executeProgram(compileProgram(program), m.read, m.write);
    expect(m.get('%Q0.0')).toBe(true);
  });

  it('derleme hatalı programları reddeder', () => {
    expect(() => compileProgram(single(no('a', '%I0.0'), '%I0.5'))).toThrow(/giriş/);
    expect(() =>
      compileProgram(single({ kind: 'series', id: 's', items: [no('x', '%I0.0'), no('x', '%I0.1')] })),
    ).toThrow(/Tekrarlanan/);
    expect(() => compileProgram(single({ kind: 'parallel', id: 'p', branches: [] }))).toThrow(/Boş/);
  });
});
