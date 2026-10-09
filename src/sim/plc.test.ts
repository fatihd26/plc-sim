import { describe, expect, it } from 'vitest';
import { parseAddress } from './address';
import type { LadderProgram } from './ladder';
import { Plc } from './plc';

// Q0.0 := I0.0  ve  Q0.1 := Q0.0 (aynı scan içinde PIQ'dan okuma)
const program: LadderProgram = {
  networks: [
    {
      id: 'N1',
      title: '',
      logic: { kind: 'contact', id: 'a', address: '%I0.0', contact: 'NO' },
      coil: { id: 'c1', address: '%Q0.0' },
    },
    {
      id: 'N2',
      title: '',
      logic: { kind: 'contact', id: 'b', address: '%Q0.0', contact: 'NO' },
      coil: { id: 'c2', address: '%Q0.1' },
    },
  ],
};

describe('PLC scan-cycle', () => {
  it('terminal değişikliği bir sonraki scan\'e kadar programa ulaşmaz', () => {
    const plc = new Plc(program);
    plc.diTerminals[0] = true;
    expect(plc.readBit(parseAddress('%I0.0'))).toBe(false);
    expect(plc.dqTerminals[0]).toBe(false);

    plc.scan();
    expect(plc.readBit(parseAddress('%I0.0'))).toBe(true);
    expect(plc.dqTerminals[0]).toBe(true);
  });

  it('çıkış terminalleri yalnız scan sonunda güncellenir', () => {
    const plc = new Plc(program);
    plc.diTerminals[0] = true;
    plc.scan();
    plc.diTerminals[0] = false;
    // Scan yapılmadığı sürece çıkış eski değerini korur
    expect(plc.dqTerminals[0]).toBe(true);
    plc.scan();
    expect(plc.dqTerminals[0]).toBe(false);
  });

  it('sonraki network aynı scan\'de yazılan PIQ değerini görür', () => {
    const plc = new Plc(program);
    plc.diTerminals[0] = true;
    plc.scan();
    expect(plc.dqTerminals[1]).toBe(true);
  });

  it('scan sayacı ve izleme verisi güncellenir', () => {
    const plc = new Plc(program);
    plc.diTerminals[0] = true;
    plc.scan();
    plc.scan();
    expect(plc.scanCount).toBe(2);
    expect(plc.lastTrace['a']?.closed).toBe(true);
    expect(plc.lastTrace['c1']?.powerOut).toBe(true);
  });
});

describe('PLC besleme', () => {
  it('powerOff çıkışları ve process image\'ı sıfırlar', () => {
    const plc = new Plc(program);
    plc.diTerminals[0] = true;
    plc.scan();
    expect(plc.dqTerminals[0]).toBe(true);
    plc.powerOff();
    expect(plc.dqTerminals[0]).toBe(false);
    expect(plc.readBit(parseAddress('%Q0.0'))).toBe(false);
    expect(plc.diTerminals[0]).toBe(false);
  });
});
