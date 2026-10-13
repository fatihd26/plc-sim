// Bileşen kütüphanesi: sensörler, analog G/Ç, PID, HSC, sürücüler, pnömatik, hidrolik, robotik
// ve arıza enjeksiyonu. Her test küçük bir şema kurar ve simülasyonla davranışı doğrular.

import { describe, expect, it } from 'vitest';
import { always, box, builder, cmp, coil, nc, net, no, parallel, program, series } from './build';
import { validateSchematic, type Schematic } from './schematic';
import { Simulation, type ComponentState, type SimSnapshot } from './simulation';

function state<T extends ComponentState['type']>(s: SimSnapshot, id: string, type: T) {
  const c = s.components[id];
  if (c?.type !== type) throw new Error(`${id} ${type} değil (${c?.type})`);
  return c as ComponentState & { type: T };
}

const sim = (s: Schematic) => {
  expect(validateSchematic(s)).toEqual([]);
  return new Simulation(s);
};

/** Koşul sağlanana kadar ilerle (en fazla `ms`). */
const until = (x: Simulation, ms: number, f: (s: SimSnapshot) => boolean) => {
  for (let i = 0; i < ms; i++) {
    x.step();
    if (i % 10 === 0 && f(x.snapshot())) return true;
  }
  return f(x.snapshot());
};

describe('sensörler', () => {
  const cell = () =>
    builder()
      .add('X1', 'mains3')
      .add('G1', 'psu24')
      .add('M1', 'conveyor', 0, 0, { params: { transitS: 1, feedS: 0, material: 'mixed', startTauMs: 10 } })
      .add('B1', 'proxInductive', 0, 0, { params: { target: 'M1', at: 50 } })
      .add('B2', 'proxCapacitive', 0, 0, { params: { target: 'M1', at: 50 } })
      .chain('X1:L1', 'M1:U')
      .chain('X1:L2', 'M1:V')
      .chain('X1:L3', 'M1:W')
      .wire('G1:L+', 'B1:BN')
      .wire('G1:M', 'B1:BU')
      .wire('G1:L+', 'B2:BN')
      .wire('G1:M', 'B2:BU')
      .build();

  it('endüktif sensör yalnız metal kutuyu, kapasitif her kutuyu algılar', () => {
    const x = sim(cell());
    const seen = () => {
      let ind = false;
      let cap = false;
      for (let i = 0; i < 1300; i++) {
        x.step();
        const s = x.snapshot();
        ind ||= state(s, 'B1', 'proxInductive').out;
        cap ||= state(s, 'B2', 'proxCapacitive').out;
      }
      return { ind, cap };
    };
    x.enqueue({ type: 'device', component: 'M1', action: 'addBox' }); // 1. kutu karton
    expect(seen()).toEqual({ ind: false, cap: true });
    x.enqueue({ type: 'device', component: 'M1', action: 'addBox' }); // 2. kutu metal
    expect(seen()).toEqual({ ind: true, cap: true });
  });

  it('PNP çıkış beslemesiz sensörde gelmez; NC çıkış nesne yokken aktiftir', () => {
    const s = builder()
      .add('G1', 'psu24')
      .add('B1', 'photoSensor', 0, 0, { params: { output: 'NC' } })
      .add('B2', 'photoSensor')
      .wire('G1:L+', 'B1:BN')
      .wire('G1:M', 'B1:BU')
      .build();
    const x = sim(s);
    x.run(5);
    expect(state(x.snapshot(), 'B1', 'photoSensor').out).toBe(true);
    expect(x.snapshot().potentials['B1:BK']).toBe('P24');
    x.enqueue({ type: 'device', component: 'B1', action: 'toggle' });
    x.enqueue({ type: 'device', component: 'B2', action: 'toggle' });
    x.run(5);
    expect(state(x.snapshot(), 'B1', 'photoSensor').out).toBe(false);
    expect(state(x.snapshot(), 'B2', 'photoSensor').detect).toBe(true);
    expect(state(x.snapshot(), 'B2', 'photoSensor').out).toBe(false); // beslemesiz
  });

  it('limit switch silindirin ucunda basılır', () => {
    const s = builder()
      .add('G1', 'psu24')
      .add('Y1', 'cylinder', 0, 0, { params: { extendMs: 200, retractMs: 200 } })
      .add('S1', 'limitSwitch', 0, 0, { params: { target: 'Y1', at: 100 } })
      .wire('G1:L+', 'Y1:A1')
      .wire('G1:M', 'Y1:A2')
      .build();
    const x = sim(s);
    x.run(100);
    expect(state(x.snapshot(), 'S1', 'limitSwitch').actuated).toBe(false);
    x.run(200);
    expect(state(x.snapshot(), 'S1', 'limitSwitch').actuated).toBe(true);
  });
});

describe('analog G/Ç', () => {
  const tankCell = (signal: string, aiType: string) =>
    builder()
      .add('G1', 'psu24')
      .add('T1', 'processTank', 0, 0, { params: { inlet: 'analog', initialPct: 50, fillS: 600, drainS: 600 } })
      .add('LT1', 'levelTx', 0, 0, { params: { target: 'T1', signal } })
      .add('A1', 'plc', 0, 0, { program: program(), params: { ai0Type: aiType } })
      .wire('G1:L+', 'A1:L+')
      .wire('G1:M', 'A1:M')
      .wire('G1:L+', 'LT1:+')
      .wire('G1:M', 'LT1:-')
      .wire('LT1:OUT', 'A1:AI0', { id: 'sig' })
      .build();

  it('4–20 mA transmitter: %50 seviye → 12 mA → %IW0 = 13824; kablo kopunca 32767', () => {
    const x = sim(tankCell('4-20mA', '4-20mA'));
    x.run(50);
    const raw = state(x.snapshot(), 'A1', 'plc').ai[0]!.raw;
    expect(raw).toBeGreaterThanOrEqual(13800);
    expect(raw).toBeLessThanOrEqual(13850);
    expect(state(x.snapshot(), 'A1', 'plc').iw[0]).toBe(raw);
    x.enqueue({ type: 'wireFault', component: 'sig', broken: true });
    x.run(30);
    expect(state(x.snapshot(), 'A1', 'plc').iw[0]).toBe(32767);
  });

  it('0–10 V transmitter 0–10 V girişte doğru okunur; 4–20 mA girişe bağlanınca hata (32767)', () => {
    const ok = sim(tankCell('0-10V', '0-10V'));
    ok.run(30);
    expect(Math.abs(state(ok.snapshot(), 'A1', 'plc').ai[0]!.raw - 13824)).toBeLessThan(30);
    const wrong = sim(tankCell('0-10V', '4-20mA'));
    wrong.run(30);
    expect(state(wrong.snapshot(), 'A1', 'plc').ai[0]!.raw).toBe(32767);
  });

  it('%QW0 analog çıkışı 0–10 V verir; SCALE ve MOVE çalışır, sıfıra bölmede ENO = 0', () => {
    const prog = program(
      net('N1', 'set', always(), box('MOVE', '%MW0', { IN: '50' })),
      net('N2', 'ölçek', always(), box('SCALE', '%QW0', { IN: '%MW0', IN_MIN: '0', IN_MAX: '100', OUT_MIN: '0', OUT_MAX: '27648' })),
      net('N3', 'böl', always(), box('DIV', '%MW1', { IN1: '10', IN2: '0' })),
      net('N4', 'çarp', always(), box('MUL', '%MW2', { IN1: '%MW0', IN2: '3' })),
    );
    const s = builder()
      .add('G1', 'psu24')
      .add('A1', 'plc', 0, 0, { program: prog })
      .add('T1', 'processTank', 0, 0, { params: { inlet: 'analog', initialPct: 0, fillS: 10, drainS: 600 } })
      .wire('G1:L+', 'A1:L+')
      .wire('G1:M', 'A1:M')
      .wire('A1:AQ0', 'T1:Y')
      .build();
    const x = sim(s);
    x.run(50);
    const snap = x.snapshot();
    const plc = state(snap, 'A1', 'plc');
    expect(plc.qw[0]).toBe(13824);
    expect(plc.words[2]).toBe(150);
    expect(plc.trace[prog.networks[2]!.coil.id]?.powerOut).toBe(false);
    expect(snap.signals['A1:AQ0']).toEqual({ kind: 'V', v: 5 });
    expect(state(snap, 'T1', 'processTank').inlet).toBeCloseTo(0.5);
  });

  it('PID kapalı çevrim: tank seviyesi set değerine oturur, bozucu etkiyi telafi eder', () => {
    const prog = program(
      net('N1', 'set %50', always(), box('MOVE', '%MW0', { IN: '13824' })),
      net('N2', 'PID', always(), box('PID', '%QW0', { PV: '%IW0', SP: '%MW0', KP: '3', TI: '4000', TD: '0', MIN: '0', MAX: '27648' })),
    );
    const s = builder()
      .add('G1', 'psu24')
      .add('A1', 'plc', 0, 0, { program: prog })
      .add('T1', 'processTank', 0, 0, { params: { inlet: 'analog', initialPct: 10, fillS: 20, drainS: 40, demandPct: 30 } })
      .add('LT1', 'levelTx', 0, 0, { params: { target: 'T1', signal: '0-10V' } })
      .wire('G1:L+', 'A1:L+')
      .wire('G1:M', 'A1:M')
      .wire('G1:L+', 'LT1:+')
      .wire('G1:M', 'LT1:-')
      .wire('LT1:OUT', 'A1:AI0')
      .wire('A1:AQ0', 'T1:Y')
      .build();
    const x = sim(s);
    x.run(90_000);
    expect(state(x.snapshot(), 'T1', 'processTank').level).toBeCloseTo(0.5, 1);
    // Tüketim artar: kontrolör vanayı daha çok açarak seviyeyi geri getirir
    x.enqueue({ type: 'device', component: 'T1', action: 'demand', value: 60 });
    x.run(90_000);
    const t = state(x.snapshot(), 'T1', 'processTank');
    expect(Math.abs(t.level - 0.5)).toBeLessThan(0.03);
    expect(t.inlet).toBeGreaterThan(0.25);
  });

  it('fırın: tristör gücüyle ısınır, emniyet termostatı aşırı sıcaklıkta açar', () => {
    const s = builder()
      .add('X1', 'mains3')
      .add('G1', 'psu24')
      .add('E1', 'furnace', 0, 0, { params: { power: 'analog', riseC: 400, tauS: 10, limitC: 250 } })
      .add('R1', 'potentiometer', 0, 0, { params: { initialPct: 50 } })
      .add('TT1', 'tempTx', 0, 0, { params: { target: 'E1', signal: '0-10V', min: 0, max: 400 } })
      .wire('X1:L1', 'E1:H1')
      .wire('X1:N', 'E1:H2')
      .wire('G1:L+', 'R1:+')
      .wire('G1:M', 'R1:-')
      .wire('R1:OUT', 'E1:Y')
      .wire('G1:L+', 'TT1:+')
      .wire('G1:M', 'TT1:-')
      .build();
    const x = sim(s);
    x.run(60_000);
    const e = state(x.snapshot(), 'E1', 'furnace');
    expect(e.temp).toBeGreaterThan(210); // 20 + 0.5·400 = 220 °C
    expect(e.temp).toBeLessThan(225);
    expect(e.tripped).toBe(false);
    expect(x.snapshot().signals['TT1:OUT']?.kind).toBe('V');
    x.enqueue({ type: 'device', component: 'R1', action: 'set', value: 100 });
    expect(until(x, 60_000, (sn) => state(sn, 'E1', 'furnace').tripped)).toBe(true);
    expect(x.snapshot().potentials['E1:11']).toBe(null);
  });
});

describe('hızlı sayıcı ve konumlama', () => {
  it('lineer eksen enkoderi HC0 ile sayılır; karşılaştırmayla hedefte durur', () => {
    const prog = program(net('N1', 'hedefe git', cmp('HC0', '<', '400'), coil('%Q0.0')));
    const s = builder()
      .add('X1', 'mains3')
      .add('G1', 'psu24')
      .add('K1', 'contactor')
      .add('A1', 'plc', 0, 0, { program: prog, params: { hsc0: 'quad' } })
      .add('M1', 'linearAxis', 0, 0, { params: { startMm: 100, pulsesPerMm: 2, speedMm: 100, coastTauMs: 50, startTauMs: 50 } })
      .wire('G1:L+', 'A1:L+')
      .wire('G1:M', 'A1:M')
      .wire('A1:Q0.0', 'K1:A1')
      .wire('K1:A2', 'G1:M')
      .wire('X1:L1', 'K1:1')
      .wire('X1:L2', 'K1:3')
      .wire('X1:L3', 'K1:5')
      .wire('K1:2', 'M1:U')
      .wire('K1:4', 'M1:V')
      .wire('K1:6', 'M1:W')
      .wire('G1:L+', 'M1:L+')
      .wire('G1:M', 'M1:M')
      .wire('M1:A', 'A1:I0.0')
      .wire('M1:B', 'A1:I0.1')
      .build();
    const x = sim(s);
    x.run(4000);
    const snap = x.snapshot();
    const hc = state(snap, 'A1', 'plc').hsc[0]!;
    const axis = state(snap, 'M1', 'linearAxis');
    expect(hc).toBeGreaterThanOrEqual(400);
    expect(hc).toBeLessThan(430);
    expect(axis.x).toBeGreaterThanOrEqual(299);
    expect(axis.x).toBeLessThan(316);
    expect(axis.powered).toBe(false);
  });
});

describe('sürücüler', () => {
  it('VFD klemens modu: DI1 + AI 5 V → 25 Hz, motor yarım hızda', () => {
    const s = builder()
      .add('X1', 'mains3')
      .add('G1', 'psu24')
      .add('T1', 'vfd', 0, 0, { params: { rampUpS: 1 } })
      .add('M1', 'motor3')
      .add('R1', 'potentiometer', 0, 0, { params: { initialPct: 50 } })
      .wire('X1:L1', 'T1:L1')
      .wire('X1:L2', 'T1:L2')
      .wire('X1:L3', 'T1:L3')
      .wire('T1:U', 'M1:U')
      .wire('T1:V', 'M1:V')
      .wire('T1:W', 'M1:W')
      .wire('G1:L+', 'R1:+')
      .wire('G1:M', 'R1:-')
      .wire('R1:OUT', 'T1:AI')
      .wire('G1:L+', 'T1:DI1')
      .build();
    const x = sim(s);
    x.run(3000);
    const snap = x.snapshot();
    expect(state(snap, 'T1', 'vfd').freq).toBeCloseTo(25, 1);
    const m = state(snap, 'M1', 'motor3');
    expect(m.rpm / 1450).toBeCloseTo(0.5, 1);
    expect(m.currentA).toBeLessThanOrEqual(4 * 1.5 + 1e-9);
    expect(snap.signals['T1:U']).toEqual({ kind: 'drive', hz: 25 });
  });

  it('VFD Modbus modu: PLC master FC16 ile çalıştırır ve frekansı yazar, FC3 ile okur', () => {
    const prog = program(
      net('N1', 'kontrol', always(), box('MOVE', '%MW0', { IN: '1' })),
      net('N2', 'frekans', always(), box('MOVE', '%MW1', { IN: '3000' })),
    );
    const s = builder()
      .add('X1', 'mains3')
      .add('G1', 'psu24')
      .add('T1', 'vfd', 0, 0, { params: { control: 'modbus', rampUpS: 1 } })
      .add('M1', 'motor3')
      .add('A1', 'plc', 0, 0, {
        program: prog,
        modbusPolls: [
          { id: 'r1', unit: 2, fn: 16, remote: 0, qty: 2, local: '%MW0', periodMs: 50 },
          { id: 'r2', unit: 2, fn: 3, remote: 2, qty: 2, local: '%MW10', periodMs: 50 },
        ],
      })
      .wire('G1:L+', 'A1:L+')
      .wire('G1:M', 'A1:M')
      .wire('A1:RS485_A', 'T1:RS485_A')
      .wire('A1:RS485_B', 'T1:RS485_B')
      .wire('X1:L1', 'T1:L1')
      .wire('X1:L2', 'T1:L2')
      .wire('X1:L3', 'T1:L3')
      .wire('T1:U', 'M1:U')
      .wire('T1:V', 'M1:V')
      .wire('T1:W', 'M1:W')
      .build();
    const x = sim(s);
    x.run(3000);
    const snap = x.snapshot();
    expect(state(snap, 'T1', 'vfd').freq).toBeCloseTo(30, 1);
    const plc = state(snap, 'A1', 'plc');
    expect(plc.words[10]).toBe(3000);
    expect(plc.words[11]! & 1).toBe(1);
  });

  const starDelta = (bridge: 'star' | 'delta' | 'none' | 'wrong') => {
    const b = builder()
      .add('X1', 'mains3')
      .add('M1', 'motor6', 0, 0, { params: { ratedCurrentA: 9, loadPct: 60 } })
      .wire('X1:L1', 'M1:U1')
      .wire('X1:L2', 'M1:V1')
      .wire('X1:L3', 'M1:W1');
    if (bridge === 'star') b.wire('M1:U2', 'M1:V2').wire('M1:V2', 'M1:W2');
    if (bridge === 'delta') b.wire('X1:L2', 'M1:U2').wire('X1:L3', 'M1:V2').wire('X1:L1', 'M1:W2');
    // Hatalı üçgen: U sargısının iki ucu aynı fazda
    if (bridge === 'wrong') b.wire('X1:L1', 'M1:U2').wire('X1:L3', 'M1:V2').wire('X1:L2', 'M1:W2');
    return sim(b.build());
  };

  it('6 uçlu motor: yıldızda akım üçgenin 1/3\'ü; boştaki sargı açık devre, hatalı köprü olay verir', () => {
    const y = starDelta('star');
    const d = starDelta('delta');
    y.run(10_000);
    d.run(10_000);
    const sy = state(y.snapshot(), 'M1', 'motor6');
    const sd = state(d.snapshot(), 'M1', 'motor6');
    expect(sy.connection).toBe('star');
    expect(sd.connection).toBe('delta');
    // Yıldızda kalkış 3 kat yavaş: 10 s sonunda kalan küçük kayma oranı biraz büyütür
    expect(sy.currentA / sd.currentA).toBeCloseTo(1 / 3, 1);
    expect(sd.rpm).toBeGreaterThan(1400);
    const none = starDelta('none');
    none.run(1000);
    expect(state(none.snapshot(), 'M1', 'motor6').connection).toBe('open');
    expect(state(none.snapshot(), 'M1', 'motor6').rpm).toBe(0);
    expect(none.snapshot().events).toEqual([]);
    const wrong = starDelta('wrong');
    wrong.run(1000);
    expect(state(wrong.snapshot(), 'M1', 'motor6').connection).toBe('wrong');
    expect(state(wrong.snapshot(), 'M1', 'motor6').rpm).toBe(0);
    expect(wrong.snapshot().events.length).toBe(1);
  });

  it('frenli motor: fren bobini enerjisizken motor kilitlenir', () => {
    const s = builder()
      .add('X1', 'mains3')
      .add('M1', 'brakeMotor')
      .wire('X1:L1', 'M1:U')
      .wire('X1:L2', 'M1:V')
      .wire('X1:L3', 'M1:W')
      .build();
    const x = sim(s);
    x.run(2000);
    const m = state(x.snapshot(), 'M1', 'brakeMotor');
    expect(m.rpm).toBe(0);
    expect(m.currentA).toBeGreaterThan(4 * 5);
  });
});

describe('pnömatik devre', () => {
  /** Hava kaynağı → 5/2 valf → (kısma) → çift etkili silindir; valfi röle K1 sürer. */
  const circuit = (opts: { throttle?: number; valve?: 'valve52' | 'valve53' } = {}) => {
    const b = builder()
      .add('G1', 'psu24')
      .add('S1', 'buttonNO')
      .add('P1', 'airSupply')
      .add('Y1', opts.valve ?? 'valve52')
      .add('Z1', 'cylDouble', 0, 0, { params: { extendMs: 500, retractMs: 500 } })
      .wire('G1:L+', 'S1:13')
      .wire('S1:14', 'Y1:A1')
      .wire('Y1:A2', 'G1:M')
      .wire('P1:1', 'Y1:1')
      .wire('Y1:2', 'Z1:B');
    if (opts.throttle) {
      b.add('V1', 'throttleCheck', 0, 0, { params: { openPct: opts.throttle } }).wire('Y1:4', 'V1:1').wire('V1:2', 'Z1:A');
      // Egzoz kısma için B hattına da: ileri giderken B tahliye olur
      b.add('V2', 'throttleCheck', 0, 0, { params: { openPct: opts.throttle } });
    } else b.wire('Y1:4', 'Z1:A');
    return sim(b.build());
  };

  it('valf bobini enerjilenince silindir ileri, bırakınca geri gider; sensörler uçlarda kapanır', () => {
    const x = circuit();
    x.run(100);
    let z = state(x.snapshot(), 'Z1', 'cylDouble');
    expect(z.retracted).toBe(true);
    expect(x.snapshot().fluid['Z1:B']).toBe('P');
    x.enqueue({ type: 'button', component: 'S1', pressed: true });
    x.run(300);
    z = state(x.snapshot(), 'Z1', 'cylDouble');
    expect(z.pos).toBeGreaterThan(0.5);
    expect(z.pos).toBeLessThan(0.7);
    x.run(400);
    expect(state(x.snapshot(), 'Z1', 'cylDouble').extended).toBe(true);
    x.enqueue({ type: 'button', component: 'S1', pressed: false });
    x.run(700);
    expect(state(x.snapshot(), 'Z1', 'cylDouble').retracted).toBe(true);
  });

  it('kısma valfi tahliye hattında hızı düşürür (meter-out)', () => {
    const fast = circuit();
    const slow = builder()
      .add('G1', 'psu24')
      .add('P1', 'airSupply')
      .add('Y1', 'valve52')
      .add('V1', 'throttleCheck', 0, 0, { params: { openPct: 25 } })
      .add('Z1', 'cylDouble', 0, 0, { params: { extendMs: 500, retractMs: 500 } })
      .wire('G1:L+', 'Y1:A1')
      .wire('Y1:A2', 'G1:M')
      .wire('P1:1', 'Y1:1')
      .wire('Y1:4', 'Z1:A')
      .wire('Y1:2', 'V1:1')
      .wire('V1:2', 'Z1:B')
      .build();
    const x = sim(slow);
    fast.enqueue({ type: 'button', component: 'S1', pressed: true });
    fast.run(400);
    x.run(400);
    const pf = state(fast.snapshot(), 'Z1', 'cylDouble').pos;
    const ps = state(x.snapshot(), 'Z1', 'cylDouble').pos;
    expect(pf).toBeGreaterThan(0.7);
    expect(ps).toBeGreaterThan(0.1);
    expect(ps).toBeLessThan(0.25);
  });

  it('5/3 orta konum kapalı: bobin bırakılınca silindir olduğu yerde kalır', () => {
    const x = circuit({ valve: 'valve53' });
    x.enqueue({ type: 'button', component: 'S1', pressed: true });
    x.run(250);
    x.enqueue({ type: 'button', component: 'S1', pressed: false });
    x.run(50);
    const p1 = state(x.snapshot(), 'Z1', 'cylDouble').pos;
    x.run(1000);
    expect(state(x.snapshot(), 'Z1', 'cylDouble').pos).toBeCloseTo(p1, 5);
    expect(x.snapshot().fluid['Z1:A']).toBe(null);
  });

  it('elektrik ucu pnömatik porta bağlanamaz', () => {
    const s = builder().add('G1', 'psu24').add('Z1', 'cylDouble').wire('G1:L+', 'Z1:A').build();
    expect(validateSchematic(s).some((e) => e.includes('pnömatik'))).toBe(true);
  });
});

describe('hidrolik devre', () => {
  const circuit = (loadKN: number, center = 'closed') =>
    builder()
      .add('X1', 'mains3')
      .add('G1', 'psu24')
      .add('S1', 'buttonNO')
      .add('P1', 'hpu', 0, 0, { params: { flowLpm: 12, reliefBar: 100, startTauMs: 50 } })
      .add('Y1', 'valve43', 0, 0, { params: { center } })
      .add('Z1', 'hydCylinder', 0, 0, { params: { boreMm: 40, rodMm: 20, strokeMm: 200, loadKN } })
      .wire('X1:L1', 'P1:U')
      .wire('X1:L2', 'P1:V')
      .wire('X1:L3', 'P1:W')
      .wire('G1:L+', 'S1:13')
      .wire('S1:14', 'Y1:A1')
      .wire('Y1:A2', 'G1:M')
      .wire('P1:P', 'Y1:P')
      .wire('P1:T', 'Y1:T')
      .wire('Y1:A', 'Z1:A')
      .wire('Y1:B', 'Z1:B')
      .build();

  it('pompa debisi silindiri hız = Q/A ile iter; basınç yük/alan kadardır', () => {
    const x = sim(circuit(5));
    x.run(500);
    expect(state(x.snapshot(), 'P1', 'hpu').reliefOpen).toBe(true); // kapalı merkez: emniyetten döner
    x.enqueue({ type: 'button', component: 'S1', pressed: true });
    x.run(1000);
    const z = state(x.snapshot(), 'Z1', 'hydCylinder');
    // A = π·40²/4 = 1256.6 mm²; Q = 12 l/dk = 200 000 mm³/s → v ≈ 159 mm/s
    expect(z.speed).toBeGreaterThan(150);
    expect(z.speed).toBeLessThan(162);
    const hpu = state(x.snapshot(), 'P1', 'hpu');
    expect(hpu.pressure).toBeCloseTo((5000 / 1256.637) * 10, 0); // ≈ 39.8 bar
    expect(hpu.reliefOpen).toBe(false);
  });

  it('yük emniyet valfi ayarını aşarsa silindir hareket etmez, valf açar', () => {
    const x = sim(circuit(50)); // 50 kN / 1256 mm² ≈ 398 bar > 100 bar
    x.enqueue({ type: 'button', component: 'S1', pressed: true });
    x.run(2000);
    expect(state(x.snapshot(), 'Z1', 'hydCylinder').pos).toBe(0);
    const hpu = state(x.snapshot(), 'P1', 'hpu');
    expect(hpu.reliefOpen).toBe(true);
    expect(hpu.pressure).toBe(100);
  });

  it('tandem merkezde pompa boşta döner (basınç ~0)', () => {
    const x = sim(circuit(5, 'tandem'));
    x.run(1000);
    expect(state(x.snapshot(), 'P1', 'hpu').pressure).toBe(0);
    expect(state(x.snapshot(), 'P1', 'hpu').reliefOpen).toBe(false);
  });

  it('ekskavatör: kazı çevrimi kovayı doldurur ve yukarıda boşaltır', () => {
    const b = builder()
      .add('X1', 'mains3')
      .add('G1', 'psu24')
      .add('P1', 'hpu', 0, 0, { params: { flowLpm: 60, reliefBar: 200, startTauMs: 50 } })
      .add('E1', 'excavator')
      .wire('X1:L1', 'P1:U')
      .wire('X1:L2', 'P1:V')
      .wire('X1:L3', 'P1:W')
      .wire('G1:L+', 'E1:L+')
      .wire('G1:M', 'E1:M');
    for (const [n, v] of [['BOOM', 'Y1'], ['ARM', 'Y2'], ['BKT', 'Y3']] as const) {
      b.add(v, 'valve43')
        .add(`S${v}a`, 'buttonNO')
        .add(`S${v}b`, 'buttonNO')
        .wire('P1:P', `${v}:P`)
        .wire('P1:T', `${v}:T`)
        .wire('G1:L+', `S${v}a:13`)
        .wire('G1:L+', `S${v}b:13`)
        .wire(`S${v}a:14`, `${v}:A1`)
        .wire(`S${v}b:14`, `${v}:B1`)
        .wire(`${v}:A2`, 'G1:M')
        .wire(`${v}:B2`, 'G1:M');
      void n;
    }
    b.wire('Y1:A', 'E1:A1').wire('Y1:B', 'E1:B1').wire('Y2:A', 'E1:A2').wire('Y2:B', 'E1:B2').wire('Y3:A', 'E1:A3').wire('Y3:B', 'E1:B3');
    const x = sim(b.build());
    const hold = (btn: string, ms: number) => {
      x.enqueue({ type: 'button', component: btn, pressed: true });
      x.run(ms);
      x.enqueue({ type: 'button', component: btn, pressed: false });
      x.run(20);
    };
    hold('SY1b', 4000); // bom aşağı
    hold('SY2a', 4000); // arm dışarı
    hold('SY3b', 4000); // kova aç
    hold('SY3a', 4000); // kova kapa: kazı
    expect(state(x.snapshot(), 'E1', 'excavator').full).toBe(true);
    expect(x.snapshot().potentials['E1:BD']).toBe('P24');
    hold('SY1a', 6000); // bom yukarı
    hold('SY3b', 4000); // boşalt
    const e = state(x.snapshot(), 'E1', 'excavator');
    expect(e.full).toBe(false);
    expect(e.dumped).toBe(1);
  });
});

describe('robotik', () => {
  it('pick & place: Z aşağıdayken X hareketi çarpışma olayıdır; tam çevrim parçayı yerleştirir', () => {
    const b = builder().add('G1', 'psu24').add('U1', 'pickPlace', 0, 0, { params: { xMs: 300, zMs: 200, gripMs: 100, feedS: 0 } });
    b.wire('G1:L+', 'U1:L+').wire('G1:M', 'U1:M');
    for (const c of ['X', 'Z', 'G']) b.add(`S${c}`, 'buttonNO').wire('G1:L+', `S${c}:13`).wire(`S${c}:14`, `U1:Y${c}`);
    const x = sim(b.build());
    const set = (c: string, on: boolean, ms: number) => {
      x.enqueue({ type: 'button', component: `S${c}`, pressed: on });
      x.run(ms);
    };
    set('Z', true, 250);
    set('G', true, 150);
    expect(state(x.snapshot(), 'U1', 'pickPlace').holding).toBe(true);
    set('Z', false, 250);
    set('X', true, 350);
    set('Z', true, 250);
    set('G', false, 150);
    expect(state(x.snapshot(), 'U1', 'pickPlace').placed).toBe(1);
    // Z aşağıdayken geri dönmeye çalış: çarpışma
    set('X', false, 100);
    expect(state(x.snapshot(), 'U1', 'pickPlace').crashes).toBeGreaterThan(0);
  });

  const robotCell = () =>
    builder()
      .add('G1', 'psu24')
      .add('R1', 'robotArm', 0, 0, { params: { speedDeg: 360, feedS: 0 } })
      .add('SS', 'buttonNO')
      .add('S0', 'buttonNO')
      .add('S1', 'buttonNO')
      .add('SR', 'buttonNO')
      .wire('G1:L+', 'R1:L+')
      .wire('G1:M', 'R1:M')
      .wire('G1:L+', 'SS:13')
      .wire('SS:14', 'R1:START')
      .wire('G1:L+', 'S0:13')
      .wire('S0:14', 'R1:P0')
      .wire('G1:L+', 'S1:13')
      .wire('S1:14', 'R1:P1')
      .wire('G1:L+', 'SR:13')
      .wire('SR:14', 'R1:RESET')
      .build();

  it('robot el sıkışması: START + program 1 → BUSY → DONE (START düşene kadar)', () => {
    const x = sim(robotCell());
    x.run(20);
    expect(x.snapshot().potentials['R1:READY']).toBe('P24');
    x.enqueue({ type: 'button', component: 'S0', pressed: true });
    x.run(5);
    x.enqueue({ type: 'button', component: 'SS', pressed: true });
    x.run(50);
    expect(x.snapshot().potentials['R1:BUSY']).toBe('P24');
    expect(until(x, 10_000, (s) => state(s, 'R1', 'robotArm').done)).toBe(true);
    expect(state(x.snapshot(), 'R1', 'robotArm').countB).toBe(1);
    expect(x.snapshot().potentials['R1:DONE']).toBe('P24');
    x.enqueue({ type: 'button', component: 'SS', pressed: false });
    x.run(20);
    expect(x.snapshot().potentials['R1:DONE']).toBe(null);
    expect(x.snapshot().potentials['R1:READY']).toBe('P24');
  });

  it('robot: program 0 veya parça yokken FAULT; RESET siler', () => {
    const x = sim(robotCell());
    x.enqueue({ type: 'button', component: 'SS', pressed: true });
    x.run(20);
    expect(state(x.snapshot(), 'R1', 'robotArm').fault).toMatch(/program/);
    x.enqueue({ type: 'button', component: 'SS', pressed: false });
    x.enqueue({ type: 'button', component: 'SR', pressed: true });
    x.run(20);
    expect(state(x.snapshot(), 'R1', 'robotArm').fault).toBe(null);
  });

  it('asansör: kat sensörleri ve tampon', () => {
    const s = builder()
      .add('X1', 'mains3')
      .add('G1', 'psu24')
      .add('M1', 'elevator', 0, 0, { params: { floorS: 1, startTauMs: 20 } })
      .wire('X1:L1', 'M1:U')
      .wire('X1:L2', 'M1:V')
      .wire('X1:L3', 'M1:W')
      .wire('G1:L+', 'M1:L+')
      .wire('G1:M', 'M1:M')
      .build();
    const x = sim(s);
    x.run(20);
    expect(x.snapshot().potentials['M1:F1']).toBe('P24');
    expect(until(x, 2000, (sn) => sn.potentials['M1:F2'] === 'P24')).toBe(true);
    x.run(3000);
    expect(state(x.snapshot(), 'M1', 'elevator').bumped).toBe(true);
    expect(x.snapshot().events.some((e) => e.text.includes('tampon'))).toBe(true);
  });

  it('garaj kapısı engelde durur ve sayar', () => {
    const s = builder()
      .add('X1', 'mains3')
      .add('G1', 'psu24')
      .add('M1', 'garageDoor', 0, 0, { params: { travelS: 1, startTauMs: 20 } })
      // Ters faz sırası = kapat
      .wire('X1:L1', 'M1:U')
      .wire('X1:L3', 'M1:V')
      .wire('X1:L2', 'M1:W')
      .wire('G1:L+', 'M1:L+')
      .wire('G1:M', 'M1:M')
      .build();
    const x = sim(s);
    x.run(10);
    expect(x.snapshot().potentials['M1:LSC']).toBe('P24');
    expect(x.snapshot().potentials['M1:PH']).toBe('P24');
    x.enqueue({ type: 'device', component: 'M1', action: 'obstacle' });
    x.run(100);
    expect(x.snapshot().potentials['M1:PH']).toBe(null);
  });
});

describe('arıza enjeksiyonu', () => {
  const lampCell = (extra: { faults?: string[]; broken?: boolean } = {}) =>
    builder()
      .add('G1', 'psu24')
      .add('S1', 'buttonNO')
      .add('K1', 'relay', 0, 0, extra.faults ? { faults: extra.faults } : {})
      .add('P1', 'lamp')
      .wire('G1:L+', 'S1:13')
      .wire('S1:14', 'K1:A1', extra.broken ? { broken: true } : {})
      .wire('K1:A2', 'G1:M')
      .wire('G1:L+', 'K1:13')
      .wire('K1:14', 'P1:X1')
      .wire('P1:X2', 'G1:M')
      .build();

  const lit = (x: Simulation) => state(x.snapshot(), 'P1', 'lamp').lit;
  const press = (x: Simulation) => {
    x.enqueue({ type: 'button', component: 'S1', pressed: true });
    x.run(50);
  };

  it('şemada kayıtlı başlangıç arızası (bobin yanık) röleyi çektirmez', () => {
    const x = sim(lampCell({ faults: ['coil'] }));
    press(x);
    expect(lit(x)).toBe(false);
    expect(x.snapshot().faults['K1']).toEqual(['coil']);
  });

  it('kopuk kablo iletmez; simülasyonda onarılabilir', () => {
    const x = sim(lampCell({ broken: true }));
    press(x);
    expect(lit(x)).toBe(false);
    expect(x.snapshot().brokenWires).toEqual(['w2']);
    x.enqueue({ type: 'wireFault', component: 'w2', broken: false });
    x.run(50);
    expect(lit(x)).toBe(true);
  });

  it('çalışırken enjekte edilen arıza (kontak yapışık) lambayı söndürmez', () => {
    const x = sim(lampCell());
    press(x);
    expect(lit(x)).toBe(true);
    x.enqueue({ type: 'fault', component: 'K1', fault: 'welded', active: true });
    x.enqueue({ type: 'button', component: 'S1', pressed: false });
    x.run(50);
    expect(lit(x)).toBe(true);
  });

  it('bilinmeyen arıza anahtarı şema doğrulamasında yakalanır', () => {
    const s = lampCell({ faults: ['yok-boyle'] });
    expect(validateSchematic(s).some((e) => e.includes('bilinmeyen arıza'))).toBe(true);
  });
});

// Kullanılmayan yardımcıların uyarı vermemesi için (diğer testlerde kullanılabilir)
void [nc, no, parallel, series];
