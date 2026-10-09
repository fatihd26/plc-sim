import { describe, expect, it } from 'vitest';
import type { LadderProgram } from './ladder';
import { replay, Simulation } from './simulation';

const press = (sim: Simulation, id: 'S1' | 'S2') => sim.enqueue({ type: 'button', id, pressed: true });
const release = (sim: Simulation, id: 'S1' | 'S2') => sim.enqueue({ type: 'button', id, pressed: false });

/** Start'a 50 ms basıp bırakır ve motoru nominal hıza getirir. */
function startMotor(sim: Simulation) {
  press(sim, 'S1');
  sim.run(50);
  release(sim, 'S1');
  sim.run(3000);
}

describe('start-stop mühürleme (kabul kriteri)', () => {
  it('başlangıçta her şey kapalı', () => {
    const sim = new Simulation();
    sim.run(100);
    const s = sim.snapshot();
    expect(s.plc.outputs[0]!.terminal).toBe(false);
    expect(s.K1.closed).toBe(false);
    expect(s.M1.running).toBe(false);
  });

  it('Start → Q0.0 → K1 çeker → motor döner; bırakınca mühürlenir', () => {
    const sim = new Simulation();
    startMotor(sim);
    const s = sim.snapshot();
    expect(s.S1.pressed).toBe(false);
    expect(s.plc.outputs[0]!.terminal).toBe(true);
    expect(s.K1.closed).toBe(true);
    expect(s.M1.powered).toBe(true);
    expect(s.M1.speed).toBeGreaterThan(0.99);
    expect(s.plc.trace['N1.hold']?.closed).toBe(true);
  });

  it('Stop → çıkış düşer, kontaktör bırakır, motor durur', () => {
    const sim = new Simulation();
    startMotor(sim);
    press(sim, 'S2');
    sim.run(10); // en fazla bir scan
    expect(sim.snapshot().plc.outputs[0]!.terminal).toBe(false);
    sim.run(15); // bırakma gecikmesi
    expect(sim.snapshot().K1.closed).toBe(false);
    expect(sim.snapshot().M1.powered).toBe(false);
    release(sim, 'S2');
    sim.run(20_000);
    const s = sim.snapshot();
    expect(s.M1.running).toBe(false);
    expect(s.plc.outputs[0]!.terminal).toBe(false); // stop bırakılınca kendiliğinden başlamaz
  });

  it('termik açması motoru durdurur; resetlenene kadar start etkisizdir', () => {
    const sim = new Simulation();
    startMotor(sim);
    sim.enqueue({ type: 'thermalTest' });
    sim.run(50);
    expect(sim.snapshot().F2.tripped).toBe(true);
    expect(sim.snapshot().K1.closed).toBe(false);

    press(sim, 'S1');
    sim.run(100);
    release(sim, 'S1');
    expect(sim.snapshot().plc.outputs[0]!.terminal).toBe(false);

    sim.enqueue({ type: 'thermalReset' });
    sim.run(20);
    // Reset tek başına motoru başlatmaz
    expect(sim.snapshot().plc.outputs[0]!.terminal).toBe(false);
    startMotor(sim);
    expect(sim.snapshot().M1.speed).toBeGreaterThan(0.99);
  });

  it('Start ve Stop birlikte basılıyken Stop önceliklidir', () => {
    const sim = new Simulation();
    press(sim, 'S1');
    press(sim, 'S2');
    sim.run(200);
    expect(sim.snapshot().plc.outputs[0]!.terminal).toBe(false);
    expect(sim.snapshot().K1.closed).toBe(false);
  });
});

describe('zamanlama ve scan-cycle', () => {
  it('Start\'tan çıkışa gecikme en fazla bir scan süresidir', () => {
    for (let offset = 0; offset < 10; offset++) {
      const sim = new Simulation();
      sim.run(100 + offset);
      press(sim, 'S1');
      let latency = 0;
      while (!sim.snapshot().plc.outputs[0]!.terminal) {
        sim.step();
        latency++;
      }
      expect(latency).toBeGreaterThanOrEqual(1);
      expect(latency).toBeLessThanOrEqual(10);
    }
  });

  it('kontaktör, çıkıştan pickup süresi (20 ms) sonra kapanır', () => {
    const sim = new Simulation();
    press(sim, 'S1');
    sim.step(); // tick 0: scan, Q0.0 = 1
    expect(sim.snapshot().plc.outputs[0]!.terminal).toBe(true);
    sim.run(18);
    expect(sim.snapshot().K1.closed).toBe(false);
    sim.step();
    expect(sim.snapshot().K1.closed).toBe(true);
  });

  it('iki scan arasına sığan kısa darbe PLC tarafından görülmez', () => {
    const sim = new Simulation();
    sim.run(1); // tick 0'daki scan geçti; sonraki scan tick 10'da
    press(sim, 'S1');
    sim.run(5);
    release(sim, 'S1');
    sim.run(100);
    expect(sim.plc.scanCount).toBeGreaterThan(5);
    expect(sim.snapshot().plc.outputs[0]!.terminal).toBe(false);
  });

  it('stepScan tam olarak bir sonraki scan\'e kadar ilerler', () => {
    const sim = new Simulation();
    sim.stepScan();
    expect(sim.tick).toBe(1);
    expect(sim.plc.scanCount).toBe(1);
    sim.stepScan();
    expect(sim.tick).toBe(11);
    expect(sim.plc.scanCount).toBe(2);
  });

  it('PII scan boyunca sabittir: terminal değişse de görüntü sonraki scan\'de güncellenir', () => {
    const sim = new Simulation();
    sim.run(1);
    press(sim, 'S1');
    sim.step();
    const s = sim.snapshot();
    expect(s.plc.inputs[0]!.terminal).toBe(true);
    expect(s.plc.inputs[0]!.image).toBe(false);
  });

  it('geçersiz scan süresi reddedilir', () => {
    expect(() => new Simulation({ scanTimeMs: 0 })).toThrow();
    expect(() => new Simulation({ scanTimeMs: 2.5 })).toThrow();
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
    const sim = new Simulation({ program: noHold });
    press(sim, 'S1');
    sim.run(100);
    expect(sim.snapshot().K1.closed).toBe(true);
    release(sim, 'S1');
    sim.run(100);
    expect(sim.snapshot().K1.closed).toBe(false);
  });
});

describe('determinizm', () => {
  it('aynı komut kaydı tekrar oynatıldığında aynı durum üretilir', () => {
    const sim = new Simulation();
    startMotor(sim);
    press(sim, 'S2');
    sim.run(37);
    release(sim, 'S2');
    sim.run(500);
    sim.enqueue({ type: 'thermalTest' });
    sim.run(123);

    const again = replay(sim.log, sim.tick);
    expect(again.snapshot()).toEqual(sim.snapshot());
    expect(again.log).toEqual(sim.log);
  });
});
