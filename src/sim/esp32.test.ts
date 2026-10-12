// ESP32 I/O kartı: firmware, besleme, Modbus belleği, şemadaki davranış ve RS485 kablolaması.

import { describe, expect, it } from 'vitest';
import { Esp32, ESP32_GPIO, rs485Groups, type Esp32Params, type Esp32Pin } from './esp32';
import { esp32Schematic } from './examples';
import { validateSchematic, type ComponentInstance, type Schematic, type Wire } from './schematic';
import { buildSymbolTable, symbolName } from './symbolTable';
import { autoConfigureEsp32, controllerIo, usedIo } from './ioConfig';
import type { LadderProgram } from './ladder';
import { PLC_DIRECT_FAULT, Simulation, type ComponentState, type SimSnapshot } from './simulation';

const params = (over: Partial<Esp32Params> = {}): Esp32Params => ({
  slaveId: 1,
  baud: 19200,
  loopMs: 10,
  modes: { GPIO16: 'in', GPIO17: 'in', GPIO18: 'out', GPIO19: 'out' },
  bits: { GPIO16: 0, GPIO17: 1, GPIO18: 0, GPIO19: 1 },
  firmware: 'modbusSlave',
  ...over,
});
const pins = (on: Partial<Record<Esp32Pin, boolean>> = {}) =>
  Object.fromEntries(ESP32_GPIO.map((p) => [p, on[p] ?? false])) as Record<Esp32Pin, boolean>;
const run = (esp: Esp32, ms: number, inputs = { powered: true, pins: pins(), adcMv: 0 }) => {
  for (let i = 0; i < ms; i++) esp.update(inputs, 1);
};

describe('ESP32 cihaz modeli', () => {
  it('Modbus slave: coil çıkışı sürer, giriş DI olur, ADC IR0/IR1', () => {
    const esp = new Esp32(params());
    esp.regs.coils[0] = true; // %Q0.0 = GPIO18
    run(esp, 10, { powered: true, pins: pins({ GPIO17: true }), adcMv: 5000 });
    expect(esp.outputs).toEqual({ GPIO16: false, GPIO17: false, GPIO18: true, GPIO19: false });
    expect(esp.regs.discreteInputs.slice(0, 2)).toEqual([false, true]); // %I0.1 = GPIO17
    expect(esp.regs.inputRegisters[0]).toBe(2048); // 5 V → 4095 / 2
    expect(esp.regs.inputRegisters[1]).toBe(5000);
  });

  it('yerel firmware giriş pinlerini sırayla çıkışlara aktarır', () => {
    const esp = new Esp32(params({ firmware: 'local' }));
    run(esp, 10, { powered: true, pins: pins({ GPIO16: true }), adcMv: 0 });
    expect(esp.outputs.GPIO18).toBe(true);
    expect(esp.outputs.GPIO19).toBe(false);
  });

  it('firmware döngü periyoduyla çalışır', () => {
    const esp = new Esp32(params({ loopMs: 50 }));
    run(esp, 1);
    expect(esp.loopCount).toBe(1); // açılışta hemen
    esp.regs.coils[1] = true; // GPIO19
    run(esp, 48);
    expect(esp.outputs.GPIO19).toBe(false);
    run(esp, 2);
    expect(esp.outputs.GPIO19).toBe(true);
  });

  it('besleme kesilince çıkışlar düşer, Modbus belleği silinir', () => {
    const esp = new Esp32(params());
    esp.regs.coils[0] = true;
    esp.regs.holdingRegisters[0] = 99;
    run(esp, 10);
    expect(esp.outputs.GPIO18).toBe(true);
    run(esp, 1, { powered: false, pins: pins(), adcMv: 0 });
    expect(esp.outputs.GPIO18).toBe(false);
    expect(esp.regs.coils[0]).toBe(false);
    expect(esp.regs.holdingRegisters[0]).toBe(0);
  });
});

describe('RS485 bus bulma', () => {
  it('A-A ve B-B bağlı cihazlar aynı bus; ters bağlı olan işaretlenir', () => {
    const { groups, swapped } = rs485Groups([
      { id: 'x', a: 1, b: 2 },
      { id: 'y', a: 1, b: 2 },
      { id: 'z', a: 2, b: 1 }, // ters
      { id: 'q', a: 5, b: 6 },
    ]);
    expect(groups.map((g) => g.map((d) => d.id))).toEqual([['x', 'y'], ['z'], ['q']]);
    expect([...swapped].sort()).toEqual(['x', 'y', 'z']);
  });
});

// --- Şemada ------------------------------------------------------------------------------

let wn = 0;
const wire = (a: string, b: string): Wire => {
  const [ac, at] = a.split(':') as [string, string];
  const [bc, bt] = b.split(':') as [string, string];
  return { id: `w${++wn}`, a: { component: ac, terminal: at }, b: { component: bc, terminal: bt } };
};
const comp = (id: string, type: ComponentInstance['type'], params?: ComponentInstance['params']): ComponentInstance => ({
  id,
  type,
  name: id,
  x: 0,
  y: 0,
  rotation: 0,
  ...(params ? { params } : {}),
});
const sch = (components: ComponentInstance[], wires: Wire[]): Schematic => ({ version: 2, components, wires });

function esp(s: SimSnapshot, id: string) {
  const c = s.components[id];
  if (c?.type !== 'esp32') throw new Error(`${id} esp32 değil`);
  return c as ComponentState & { type: 'esp32' };
}
const lit = (s: SimSnapshot, id: string) => (s.components[id] as { lit: boolean }).lit;

describe('ESP32 şemada', () => {
  it('örnek (ladder): S1 ile P1 yanar, bırakınca 2 s sonra söner; ADC 5 V üstünde P2', () => {
    const schematic = esp32Schematic();
    expect(validateSchematic(schematic)).toEqual([]);
    const sim = new Simulation(schematic);
    sim.run(50);
    expect(esp(sim.snapshot(), 'A1').powered).toBe(true);
    expect(lit(sim.snapshot(), 'P1')).toBe(false);
    sim.enqueue({ type: 'button', component: 'S1', pressed: true });
    sim.run(50);
    expect(lit(sim.snapshot(), 'P1')).toBe(true);
    sim.enqueue({ type: 'button', component: 'S1', pressed: false });
    sim.run(1500);
    expect(lit(sim.snapshot(), 'P1')).toBe(true); // TOF: hâlâ yanık
    sim.run(600);
    expect(lit(sim.snapshot(), 'P1')).toBe(false);

    sim.enqueue({ type: 'analog', component: 'A1', mv: 4000 });
    sim.run(50);
    expect(lit(sim.snapshot(), 'P2')).toBe(false);
    sim.enqueue({ type: 'analog', component: 'A1', mv: 6000 });
    sim.run(50);
    const s = sim.snapshot();
    expect(lit(s, 'P2')).toBe(true);
    const ladder = esp(s, 'A1').ladder!;
    expect(ladder.words[0]).toBe(Math.round((6000 * 4095) / 10_000));
    expect(ladder.words[1]).toBe(6000);
    expect(ladder.trace['N1.coil']).toBeDefined(); // online izleme verisi
  });

  it('ladder firmware: Modbus HR yazımı %MW, coil okuma %Q bitini görür', () => {
    const sim = new Simulation(esp32Schematic());
    sim.run(20);
    sim.enqueue({ type: 'modbusWrite', component: 'A1', request: { fn: 6, addr: 5, value: 77 } });
    sim.enqueue({ type: 'button', component: 'S1', pressed: true });
    sim.run(50);
    const st = esp(sim.snapshot(), 'A1');
    expect(st.ladder!.words[5]).toBe(77);
    expect(st.coils[0]).toBe(true); // %Q0.0 = GPIO18
    expect(st.discreteInputs[0]).toBe(true); // %I0.0
  });

  it('Modbus slave: test master coil 0 yazınca çıkış ve lamba; ADC komutu IR0', () => {
    const schematic = esp32Schematic();
    schematic.components.find((c) => c.id === 'A1')!.params = { firmware: 'modbusSlave' };
    // ladder firmware'i değilken program yok sayılır
    const sim = new Simulation(schematic);
    sim.run(20);
    sim.enqueue({ type: 'modbusWrite', component: 'A1', request: { fn: 5, addr: 0, value: true } });
    sim.enqueue({ type: 'analog', component: 'A1', mv: 10_000 });
    sim.run(50);
    const s = sim.snapshot();
    expect(lit(s, 'P1')).toBe(true);
    expect(esp(s, 'A1').inputRegisters[0]).toBe(4095);
  });

  it('çıkışa doğrudan bağlı yük çalışmaz (PLC kuralı ESP32 için de geçerli)', () => {
    const sim = new Simulation(
      sch(
        [comp('G1', 'psu24'), comp('A1', 'esp32', { firmware: 'local' }), comp('P1', 'lamp')],
        [
          wire('G1:L+', 'A1:24V'),
          wire('G1:M', 'A1:GND'),
          wire('G1:L+', 'A1:GPIO16'),
          wire('A1:GPIO18', 'P1:X1'),
          wire('P1:X2', 'G1:M'),
        ],
      ),
    );
    sim.run(50);
    expect(sim.snapshot().components['P1']).toMatchObject({ lit: false, fault: PLC_DIRECT_FAULT });
  });

  it('besleme yoksa çalışmaz; RS485 kablolaması bus ve ters bağlantıyı gösterir', () => {
    const sim = new Simulation(
      sch(
        [comp('A1', 'esp32'), comp('A2', 'esp32'), comp('A3', 'esp32')],
        [
          wire('A1:RS485_A', 'A2:RS485_A'),
          wire('A1:RS485_B', 'A2:RS485_B'),
          wire('A3:RS485_A', 'A1:RS485_B'),
        ],
      ),
    );
    sim.run(10);
    const s = sim.snapshot();
    expect(esp(s, 'A1').powered).toBe(false);
    expect(esp(s, 'A2').busPeers).toEqual(['A1']);
    expect(esp(s, 'A3').rs485Fault).toMatch(/ters/);
  });
});

describe('ESP32 sembol tablosu', () => {
  it('GPIO pinleri yönüne göre %I0.n / %Q0.n adresine eşlenir', () => {
    const table = buildSymbolTable(esp32Schematic(), 'A1');
    expect(symbolName(table, '%I0.0')).toBe('S1');
    expect(symbolName(table, '%Q0.0')).toBe('K1');
    expect(symbolName(table, '%Q0.1')).toBe('K2');
    expect(table['%I0.2']).toBeUndefined();
  });
});

describe('G/Ç yapılandırması', () => {
  const inst = (params: Record<string, string>) => ({ type: 'esp32' as const, params });

  it('otomatik: girişler %I0.0, çıkışlar %Q0.0 adresinden pin sırasıyla', () => {
    const io = controllerIo(inst({}));
    expect(io.inputs.map((p) => `${p.terminal}=${p.address}`)).toEqual(['GPIO16=%I0.0', 'GPIO17=%I0.1']);
    expect(io.outputs.map((p) => `${p.terminal}=${p.address}`)).toEqual(['GPIO18=%Q0.0', 'GPIO19=%Q0.1']);
    expect(io.errors).toEqual([]);
  });

  it('elle verilen adres korunur, otomatik pinler boştaki adresi alır; çakışma hata', () => {
    const io = controllerIo(inst({ addr_GPIO17: '0', mode_GPIO19: 'in' }));
    expect(io.inputs.map((p) => `${p.terminal}=${p.address}`)).toEqual(['GPIO16=%I0.1', 'GPIO17=%I0.0', 'GPIO19=%I0.2']);
    expect(controllerIo(inst({ addr_GPIO16: '3', addr_GPIO17: '3' })).errors[0]).toMatch(/%I0.3 hem GPIO16 hem GPIO17/);
  });

  it('elle eşleme simülasyona yansır: GPIO19 = %Q0.5', () => {
    const schematic = esp32Schematic();
    const a1 = schematic.components.find((c) => c.id === 'A1')!;
    a1.params = { addr_GPIO19: '5' };
    a1.program!.networks[2]!.coil.address = '%Q0.5';
    const sim = new Simulation(schematic);
    sim.enqueue({ type: 'analog', component: 'A1', mv: 8000 });
    sim.run(50);
    expect(lit(sim.snapshot(), 'P2')).toBe(true);
    expect(symbolName(buildSymbolTable(schematic, 'A1'), '%Q0.5')).toBe('K2');
  });

  it('çakışan eşleme şema hatasıdır', () => {
    const schematic = esp32Schematic();
    schematic.components.find((c) => c.id === 'A1')!.params = { addr_GPIO18: '1', addr_GPIO19: '1' };
    expect(validateSchematic(schematic).join()).toMatch(/G\/Ç: %Q0.1/);
  });

  it('programdan otomatik yapılandırma', () => {
    const program = esp32Schematic().components.find((c) => c.id === 'A1')!.program!;
    expect(usedIo(program)).toEqual({ inputs: [0], outputs: [0, 1] });
    // Mevcut eşleme programa uyuyor: kablolama korunur, hiçbir pin değişmez.
    const a1 = esp32Schematic().components.find((c) => c.id === 'A1')!;
    expect(autoConfigureEsp32(program, a1)).toEqual({
      params: {
        mode_GPIO16: 'in',
        addr_GPIO16: '0',
        mode_GPIO17: 'in',
        addr_GPIO17: 'auto',
        mode_GPIO18: 'out',
        addr_GPIO18: '0',
        mode_GPIO19: 'out',
        addr_GPIO19: '1',
      },
      changes: [],
    });
    // Üç çıkış gerekiyor: kullanılmayan giriş pini (GPIO17) çıkışa çevrilir ve bildirilir.
    const three: LadderProgram = {
      networks: [
        ...program.networks,
        {
          id: 'N9',
          title: '',
          logic: { kind: 'contact', id: 'x9', address: '%I0.0', contact: 'NO' },
          coil: { id: 'q9', address: '%Q0.4' },
        },
      ],
    };
    const r = autoConfigureEsp32(three, a1);
    expect(r).toMatchObject({
      params: { mode_GPIO17: 'out', addr_GPIO17: '4', addr_GPIO18: '0', addr_GPIO19: '1' },
      changes: [expect.stringMatching(/GPIO17 girişten çıkışa/)],
    });
    const big: LadderProgram = {
      networks: [0, 1, 2, 3, 4].map((i) => ({
        id: `N${i}`,
        title: '',
        logic: { kind: 'contact', id: `c${i}`, address: `%I0.${i}`, contact: 'NO' },
        coil: { id: `q${i}`, address: '%M0.0' },
      })),
    };
    expect(autoConfigureEsp32(big)).toMatchObject({ error: expect.stringMatching(/5 giriş/) });
  });
});
