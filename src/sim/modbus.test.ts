// Modbus çekirdeği: istek işleyici, RTU çerçeveleme, sanal RS485 bus ve PLC slave görünümü.

import { describe, expect, it } from 'vitest';
import { parseValue } from './address';
import { compileProgram } from './ladder';
import {
  createModbusModel,
  crc16,
  encodePdu,
  handleRequest,
  ModbusRtuBus,
  rtuFrame,
  rtuFrameMs,
  type ModbusResult,
  type ModbusSlave,
} from './modbus';
import { Plc } from './plc';

const model = () => createModbusModel({ coils: 8, discreteInputs: 8, holding: 4, input: 2 });
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

describe('istek işleyici', () => {
  it('coil ve register okur/yazar', () => {
    const m = model();
    expect(handleRequest(m, { fn: 5, addr: 2, value: true })).toEqual({ ok: true, fn: 5 });
    expect(handleRequest(m, { fn: 15, addr: 4, values: [true, false, true] })).toEqual({ ok: true, fn: 15 });
    expect(handleRequest(m, { fn: 1, addr: 0, qty: 8 })).toEqual({
      ok: true,
      fn: 1,
      bits: [false, false, true, false, true, false, true, false],
    });
    expect(handleRequest(m, { fn: 6, addr: 1, value: 1234 })).toEqual({ ok: true, fn: 6 });
    expect(handleRequest(m, { fn: 16, addr: 2, values: [7, 65535] })).toEqual({ ok: true, fn: 16 });
    expect(handleRequest(m, { fn: 3, addr: 0, qty: 4 })).toEqual({ ok: true, fn: 3, words: [0, 1234, 7, 65535] });
    m.discreteInputs[1] = true;
    m.inputRegisters[0] = 4095;
    expect(handleRequest(m, { fn: 2, addr: 1, qty: 1 })).toEqual({ ok: true, fn: 2, bits: [true] });
    expect(handleRequest(m, { fn: 4, addr: 0, qty: 1 })).toEqual({ ok: true, fn: 4, words: [4095] });
  });

  it('hatalı istekte istisna kodu döner, veri değişmez', () => {
    const m = model();
    expect(handleRequest(m, { fn: 3, addr: 3, qty: 2 })).toMatchObject({ ok: false, exception: 2 });
    expect(handleRequest(m, { fn: 1, addr: 0, qty: 0 })).toMatchObject({ ok: false, exception: 2 });
    expect(handleRequest(m, { fn: 3, addr: 0, qty: 200 })).toMatchObject({ ok: false, exception: 3 });
    expect(handleRequest(m, { fn: 6, addr: 0, value: 70000 })).toMatchObject({ ok: false, exception: 3 });
    expect(handleRequest(m, { fn: 16, addr: 3, values: [1, 2] })).toMatchObject({ ok: false, exception: 2 });
    expect([...m.holdingRegisters]).toEqual([0, 0, 0, 0]);
    expect(handleRequest(m, { fn: 7, addr: 0, qty: 1 } as never)).toMatchObject({ ok: false, fn: 7, exception: 1 });
  });
});

describe('RTU çerçeveleme', () => {
  it('bilinen çerçeve: unit 1, FC3, adres 0, 1 register → CRC 84 0A', () => {
    expect(hex(rtuFrame(1, encodePdu({ fn: 3, addr: 0, qty: 1 })))).toBe('01 03 00 00 00 01 84 0a');
    expect(crc16(new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]))).toBe(0x0a84);
  });

  it('çoklu yazma PDU: bitler paketlenir, kelimeler big-endian', () => {
    expect(encodePdu({ fn: 15, addr: 0x13, values: [true, false, true, true, false, false, true, true, true, false] })).toEqual([
      15, 0x00, 0x13, 0x00, 0x0a, 2, 0xcd, 0x01,
    ]);
    expect(encodePdu({ fn: 16, addr: 1, values: [0x000a, 0x0102] })).toEqual([16, 0, 1, 0, 2, 4, 0x00, 0x0a, 0x01, 0x02]);
  });

  it('çerçeve süresi baud ile ölçeklenir', () => {
    expect(rtuFrameMs(9600, 8)).toBe(14); // (8 + 3,5) × 11 / 9600 s = 13,2 ms
    expect(rtuFrameMs(115200, 8)).toBe(2);
  });
});

describe('sanal RS485 bus', () => {
  const runUntil = (bus: ModbusRtuBus, id: number, slaves: ModbusSlave[], maxTicks = 1000) => {
    for (let tick = 0; tick < maxTicks; tick++) {
      bus.step(tick, slaves);
      const r = bus.take(id);
      if (r) return { tick, result: r as ModbusResult };
    }
    throw new Error('işlem bitmedi');
  };

  it('istek ve yanıt çerçeve süresi kadar sürer', () => {
    const slave = { unit: 3, model: model() };
    slave.model.holdingRegisters[0] = 42;
    const bus = new ModbusRtuBus(9600);
    const id = bus.submit(3, { fn: 3, addr: 0, qty: 1 });
    const { tick, result } = runUntil(bus, id, [slave]);
    expect(result).toEqual({ ok: true, fn: 3, words: [42] });
    // istek 8 bayt (14 ms) + yanıt 7 bayt (13 ms)
    expect(tick).toBe(rtuFrameMs(9600, 8) + rtuFrameMs(9600, 7));
  });

  it('adresli slave yoksa zaman aşımı', () => {
    const bus = new ModbusRtuBus(19200, 100);
    const id = bus.submit(9, { fn: 1, addr: 0, qty: 1 });
    const { tick, result } = runUntil(bus, id, [{ unit: 1, model: model() }]);
    expect(result).toEqual({ ok: false, timeout: true });
    expect(tick).toBe(rtuFrameMs(19200, 8) + 100);
  });

  it('işlemler sırayla yapılır (yarı çift yönlü)', () => {
    const slave = { unit: 1, model: model() };
    const bus = new ModbusRtuBus(115200);
    const write = bus.submit(1, { fn: 6, addr: 0, value: 5 });
    const read = bus.submit(1, { fn: 3, addr: 0, qty: 1 });
    const results = new Map<number, ModbusResult>();
    for (let tick = 0; tick < 100 && results.size < 2; tick++) {
      bus.step(tick, [slave]);
      for (const id of [write, read]) {
        const r = bus.take(id);
        if (r) results.set(id, r);
      }
    }
    expect(results.get(read)).toEqual({ ok: true, fn: 3, words: [5] });
    expect(bus.busy).toBe(false);
  });

  it('broadcast (unit 0) tüm slave’lere yazar, yanıt beklemez', () => {
    const a = { unit: 1, model: model() };
    const b = { unit: 2, model: model() };
    const bus = new ModbusRtuBus(19200);
    const id = bus.submit(0, { fn: 5, addr: 0, value: true });
    runUntil(bus, id, [a, b]);
    expect(a.model.coils[0] && b.model.coils[0]).toBe(true);
  });
});

describe('PLC Modbus slave ve %MW', () => {
  it('%MW ayrıştırılır, alan dışı reddedilir', () => {
    expect(parseValue('%mw5')).toEqual({ area: 'MW', index: 5 });
    expect(() => parseValue('%MW64')).toThrow(/alan dışında/);
  });

  it('holding register yazımı %MW karşılaştırmasını, coil okuma %Q bitini görür', () => {
    const plc = new Plc({
      networks: [
        {
          id: 'N1',
          title: '%MW0 >= 100 → Q0.1',
          logic: { kind: 'compare', id: 'k', op: '>=', a: '%MW0', b: '100' },
          coil: { id: 'c', address: '%Q0.1' },
        },
      ],
    });
    plc.scan(10);
    expect(handleRequest(plc.modbusModel(), { fn: 1, addr: 1, qty: 1 })).toEqual({ ok: true, fn: 1, bits: [false] });
    expect(handleRequest(plc.modbusModel(), { fn: 6, addr: 0, value: 150 })).toEqual({ ok: true, fn: 6 });
    plc.scan(10);
    expect(plc.wordsCopy()[0]).toBe(150);
    expect(handleRequest(plc.modbusModel(), { fn: 1, addr: 1, qty: 1 })).toEqual({ ok: true, fn: 1, bits: [true] });
    plc.powerOff();
    expect(plc.wordsCopy()[0]).toBe(0);
  });

  it('%MW karşılaştırması derlenir', () => {
    expect(() =>
      compileProgram({
        networks: [
          { id: 'N', title: '', logic: { kind: 'compare', id: 'k', op: '==', a: '%MW63', b: 'C0' }, coil: { id: 'c', address: '%M0.0' } },
        ],
      }),
    ).not.toThrow();
  });
});
