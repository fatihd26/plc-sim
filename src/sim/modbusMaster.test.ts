// PLC Modbus master: tarama tablosu doğrulaması, zamanlama, okuma/yazma ve şemadaki bus hataları.

import { describe, expect, it } from 'vitest';
import { modbusSchematic } from './examples';
import { createModbusModel, rtuFrameMs } from './modbus';
import { ModbusMaster, validatePoll, type ModbusPoll } from './modbusMaster';
import { Plc } from './plc';
import { validateSchematic, type Schematic } from './schematic';
import { Simulation, type ComponentState, type SimSnapshot } from './simulation';

const poll = (over: Partial<ModbusPoll>): ModbusPoll => ({
  id: 'p',
  unit: 1,
  fn: 3,
  remote: 0,
  qty: 1,
  local: '%MW0',
  periodMs: 50,
  ...over,
});

describe('tarama tablosu doğrulaması', () => {
  it('geçerli satırlar', () => {
    expect(validatePoll(poll({}))).toBeNull();
    expect(validatePoll(poll({ fn: 2, local: '%M10.0', qty: 8 }))).toBeNull();
    expect(validatePoll(poll({ fn: 15, local: '%I0.0', qty: 2 }))).toBeNull(); // yazmada kaynak %I olabilir
  });

  it('hatalı satırlar', () => {
    expect(validatePoll(poll({ unit: 0 }))).toMatch(/1..247/);
    expect(validatePoll(poll({ fn: 1, local: '%Q0.0' }))).toMatch(/%M/);
    expect(validatePoll(poll({ fn: 3, local: '%M0.0' }))).toMatch(/%MW/);
    expect(validatePoll(poll({ fn: 6, qty: 2 }))).toMatch(/adedi 1/);
    expect(validatePoll(poll({ local: '%MW63', qty: 2 }))).toMatch(/sınırını aşıyor/);
    expect(validatePoll(poll({ periodMs: 1 }))).toMatch(/periyot/);
  });
});

describe('ModbusMaster', () => {
  const plc = () => new Plc({ networks: [] });

  it('okur, PLC belleğine yazar; periyodik tekrarlar', () => {
    const slave = { unit: 1, model: createModbusModel({ coils: 8, discreteInputs: 8, holding: 8, input: 4 }) };
    slave.model.inputRegisters[0] = 1234;
    slave.model.discreteInputs[1] = true;
    const p = plc();
    const m = new ModbusMaster(
      [poll({ id: 'a', fn: 4, local: '%MW5' }), poll({ id: 'b', fn: 2, qty: 2, local: '%M3.0', periodMs: 100 })],
      19200,
      200,
    );
    for (let t = 0; t < 60; t++) m.step(t, p, [slave], null);
    expect(p.getWord(5)).toBe(1234);
    expect([p.readBitAt('M', 24), p.readBitAt('M', 25)]).toEqual([false, true]);
    expect(m.status.get('a')).toMatchObject({ state: 'ok', values: [1234] });
    slave.model.inputRegisters[0] = 99;
    for (let t = 60; t < 120; t++) m.step(t, p, [slave], null);
    expect(p.getWord(5)).toBe(99);
    expect(m.status.get('a')!.okCount).toBe(3); // t = 0, 50, 100
  });

  it('yazar: PLC bitleri → coil, %MW → holding register', () => {
    const slave = { unit: 7, model: createModbusModel({ coils: 8, discreteInputs: 0, holding: 4, input: 0 }) };
    const p = plc();
    p.writeBitAt('M', 0, true);
    p.writeBitAt('M', 2, true);
    p.setWord(3, 500);
    const m = new ModbusMaster(
      [poll({ id: 'c', unit: 7, fn: 15, qty: 3, local: '%M0.0' }), poll({ id: 'h', unit: 7, fn: 6, remote: 2, local: '%MW3' })],
      115200,
      100,
    );
    for (let t = 0; t < 30; t++) m.step(t, p, [slave], null);
    expect(slave.model.coils.slice(0, 3)).toEqual([true, false, true]);
    expect(slave.model.holdingRegisters[2]).toBe(500);
  });

  it('slave yoksa zaman aşımı; bus hatasında busFault', () => {
    const p = plc();
    const m = new ModbusMaster([poll({ id: 'x' })], 19200, 100);
    let t = 0;
    for (; t < rtuFrameMs(19200, 8) + 101; t++) m.step(t, p, [], null);
    expect(m.status.get('x')).toMatchObject({ state: 'timeout', errorCount: 1 });
    m.step(t, p, null, 'iki master');
    expect(m.status.get('x')).toMatchObject({ state: 'busFault', detail: 'iki master' });
  });
});

// --- Şemada ------------------------------------------------------------------------------

function plcState(s: SimSnapshot, id = 'A1') {
  const c = s.components[id];
  if (c?.type !== 'plc') throw new Error('plc değil');
  return c as ComponentState & { type: 'plc' };
}
const lit = (s: SimSnapshot, id: string) => (s.components[id] as { lit: boolean }).lit;
const press = (sim: Simulation, id: string, pressed: boolean) => sim.enqueue({ type: 'button', component: id, pressed });

describe('örnek: PLC ↔ ESP32 Modbus RTU', () => {
  it('şema geçerli; iki yönlü G/Ç ve ADC Modbus üzerinden çalışır', () => {
    const schematic = modbusSchematic();
    expect(validateSchematic(schematic)).toEqual([]);
    const sim = new Simulation(schematic);
    sim.run(200);
    expect(plcState(sim.snapshot()).modbus.map((p) => p.state)).toEqual(['ok', 'ok', 'ok']);

    press(sim, 'S1', true); // PLC girişi → ESP32 çıkışı
    sim.run(150);
    expect(lit(sim.snapshot(), 'P1')).toBe(true);
    press(sim, 'S1', false);
    sim.run(150);
    expect(lit(sim.snapshot(), 'P1')).toBe(false);

    press(sim, 'S2', true); // ESP32 girişi → PLC çıkışı
    sim.run(150);
    expect(lit(sim.snapshot(), 'P2')).toBe(true);

    sim.enqueue({ type: 'analog', component: 'A2', mv: 8000 });
    sim.run(250);
    const s = sim.snapshot();
    expect(plcState(s).words[10]).toBe(Math.round((8000 * 4095) / 10_000));
    expect(lit(s, 'P3')).toBe(true);
  });

  const variant = (fn: (s: Schematic) => void) => {
    const schematic = modbusSchematic();
    fn(schematic);
    const sim = new Simulation(schematic);
    // 3 satır × (çerçeve + 200 ms zaman aşımı) sırayla: hepsinin sonuçlanması için ~650 ms
    sim.run(1000);
    return plcState(sim.snapshot()).modbus;
  };

  it('A/B ters bağlıysa zaman aşımı', () => {
    const st = variant((s) => {
      for (const w of s.wires) {
        if (w.b.component === 'A2' && w.b.terminal === 'RS485_A') w.b.terminal = 'RS485_B';
        else if (w.b.component === 'A2' && w.b.terminal === 'RS485_B') w.b.terminal = 'RS485_A';
      }
    });
    expect(st.every((p) => p.state === 'timeout')).toBe(true);
  });

  it('baud uyuşmazlığında zaman aşımı', () => {
    const st = variant((s) => (s.components.find((c) => c.id === 'A2')!.params!.baud = '9600'));
    expect(st.every((p) => p.state === 'timeout')).toBe(true);
  });

  it('ESP32 enerjisizse zaman aşımı, slave adresi farklıysa zaman aşımı', () => {
    expect(variant((s) => (s.wires = s.wires.filter((w) => !(w.b.component === 'A2' && w.b.terminal === '24V')))).every((p) => p.state === 'timeout')).toBe(true);
    expect(variant((s) => (s.components.find((c) => c.id === 'A2')!.params!.slaveId = 5)).every((p) => p.state === 'timeout')).toBe(true);
  });

  it("aynı bus'ta iki master bus hatasıdır", () => {
    const st = variant((s) => {
      const a1 = s.components.find((c) => c.id === 'A1')!;
      s.components.push({ ...structuredClone(a1), id: 'A3', name: 'A3', x: 800 });
      s.wires.push(
        { id: 'wx1', a: { component: 'A3', terminal: 'RS485_A' }, b: { component: 'A1', terminal: 'RS485_A' } },
        { id: 'wx2', a: { component: 'A3', terminal: 'RS485_B' }, b: { component: 'A1', terminal: 'RS485_B' } },
      );
    });
    expect(st.every((p) => p.state === 'busFault' && /birden çok master/.test(p.detail ?? ''))).toBe(true);
  });

  it('tablodaki hatalı satır şema doğrulamasında yakalanır', () => {
    const s = modbusSchematic();
    s.components.find((c) => c.id === 'A1')!.modbusPolls![0]!.local = '%Q0.0';
    expect(validateSchematic(s).join()).toMatch(/Modbus satırı p1: okunan bitler yalnız %M/);
  });
});
