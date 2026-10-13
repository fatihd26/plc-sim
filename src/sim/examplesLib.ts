// Bileşen kütüphanesinin örnek projeleri: analog/PID, proses, sürücüler, akışkan gücü, robotik
// ve arıza bulma. Her örnek çalışan bir PLC programıyla gelir; açıklamada bir alıştırma önerilir.

import { always, box, builder, cmp, coil, nc, net, no, parallel, program, series } from './build';
import type { ModbusPoll } from './modbusMaster';
import type { Schematic } from './schematic';

type B = ReturnType<typeof builder>;

/** PLC beslemesi ve 24 V röle/kontaktör bobini (PLC çıkışı → bobin → 0 V). */
const plcPower = (b: B, plc = 'A1', psu = 'G1') => b.wire(`${psu}:L+`, `${plc}:L+`).wire(`${psu}:M`, `${plc}:M`);
const coilFrom = (b: B, out: string, k: string, psu = 'G1') => b.wire(out, `${k}:A1`).wire(`${k}:A2`, `${psu}:M`);
/** Buton: +24 V → kontak → PLC girişi. */
const buttonTo = (b: B, s: string, input: string, ncButton = false, psu = 'G1') =>
  b.wire(`${psu}:L+`, `${s}:${ncButton ? '11' : '13'}`).wire(`${s}:${ncButton ? '12' : '14'}`, input);
/** 3 telli cihaz beslemesi (+ / −). */
const supply = (b: B, dev: string, plus = '+', minus = '-', psu = 'G1') => b.wire(`${psu}:L+`, `${dev}:${plus}`).wire(`${psu}:M`, `${dev}:${minus}`);
/** 3~ yük: kontaktör ana kontakları (ters = U ve W yer değiştirir). */
const contactorTo = (b: B, k: string, load: string, reverse = false, src = 'X1', terms: [string, string, string] = ['U', 'V', 'W']) => {
  b.wire(`${src}:L1`, `${k}:1`).wire(`${src}:L2`, `${k}:3`).wire(`${src}:L3`, `${k}:5`);
  const [u, v, w] = reverse ? [terms[2], terms[1], terms[0]] : terms;
  return b.wire(`${k}:2`, `${load}:${u}`).wire(`${k}:4`, `${load}:${v}`).wire(`${k}:6`, `${load}:${w}`);
};

// --- Analog ve proses ------------------------------------------------------------------------

export function pidTankSchematic(): Schematic {
  const prog = program(
    net('N1', 'PID: seviye = set değeri (potansiyometre)', always(), box('PID', '%QW0', { PV: '%IW0', SP: '%IW1', KP: '3', TI: '4000', TD: '0', MIN: '0', MAX: '27648' })),
    net('N2', 'Seviye % (izleme)', always(), box('SCALE', '%MW0', { IN: '%IW0', IN_MIN: '0', IN_MAX: '27648', OUT_MIN: '0', OUT_MAX: '100' })),
    net('N3', 'Set % (izleme)', always(), box('SCALE', '%MW1', { IN: '%IW1', IN_MIN: '0', IN_MAX: '27648', OUT_MIN: '0', OUT_MAX: '100' })),
  );
  const b = builder('PID seviye kontrolü', [{ id: 'p1', title: 'Proses ve kontrol' }])
    .add('G1', 'psu24', 40, 20)
    .add('R1', 'potentiometer', 160, 160, { params: { initialPct: 50 } })
    .add('LT1', 'levelTx', 440, 40, { params: { target: 'T1', signal: '0-10V' } })
    .add('T1', 'processTank', 620, 40, { params: { inlet: 'analog', fillS: 20, drainS: 40, demandPct: 30, initialPct: 10 } })
    .add('A1', 'plc', 300, 340, { program: prog, params: { ai0Type: '0-10V', ai1Type: '0-10V' } });
  plcPower(b);
  supply(b, 'R1');
  supply(b, 'LT1');
  return b.wire('LT1:OUT', 'A1:AI0').wire('R1:OUT', 'A1:AI1').wire('A1:AQ0', 'T1:Y').build();
}

export function furnaceSchematic(): Schematic {
  const prog = program(
    net('N1', 'Sıcaklık °C', always(), box('SCALE', '%MW0', { IN: '%IW0', IN_MIN: '0', IN_MAX: '27648', OUT_MIN: '0', OUT_MAX: '400' })),
    net('N2', '180 °C altında ısıt', series(no('%I0.0', 'Çalıştır'), cmp('%MW0', '<', '180')), coil('%Q0.0', 'set')),
    net('N3', '200 °C üstünde kes', parallel(cmp('%MW0', '>', '200'), nc('%I0.0')), coil('%Q0.0', 'reset')),
  );
  const b = builder('Fırın: aç-kapa sıcaklık kontrolü', [{ id: 'p1', title: 'Güç ve kumanda' }])
    .add('X1', 'mains3', 20, 20)
    .add('G1', 'psu24', 180, 20)
    .add('S1', 'buttonNO', 300, 160)
    .add('K1', 'relay', 40, 200)
    .add('E1', 'furnace', 40, 360, { params: { riseC: 300, tauS: 30, limitC: 280 } })
    .add('TT1', 'tempTx', 440, 160, { params: { target: 'E1', signal: '4-20mA', min: 0, max: 400 } })
    .add('A1', 'plc', 420, 340, { program: prog, params: { ai0Type: '4-20mA' } });
  plcPower(b);
  supply(b, 'TT1');
  buttonTo(b, 'S1', 'A1:I0.0');
  coilFrom(b, 'A1:Q0.0', 'K1');
  return b
    .chain('X1:L1', 'E1:11')
    .chain('E1:12', 'K1:13')
    .chain('K1:14', 'E1:H1')
    .chain('E1:H2', 'X1:N')
    .wire('TT1:OUT', 'A1:AI0')
    .build();
}

// --- Sürücüler -------------------------------------------------------------------------------

export function starDeltaSchematic(): Schematic {
  const prog = program(
    net('N1', 'Ana kontaktör K1 (start-stop)', series(parallel(no('%I0.0', 'Start'), no('%Q0.0')), no('%I0.1', 'Stop'), no('%I0.2', 'Termik')), coil('%Q0.0')),
    net('N2', 'Yıldız K2', series(no('%Q0.0'), nc('T0'), nc('%Q0.2')), coil('%Q0.1')),
    net('N3', 'Yıldız süresi', no('%Q0.0'), coil('T0', 'TON', { preset: 4000 })),
    net('N4', 'Üçgen K3', series(no('T0'), nc('%Q0.1')), coil('%Q0.2')),
  );
  const b = builder('Yıldız-üçgen yol verme', [{ id: 'p1', title: 'Güç ve kumanda devresi' }])
    .add('X1', 'mains3', 20, 20)
    .add('K1', 'contactor', 20, 120)
    .add('F1', 'thermal', 20, 260, { params: { setCurrentA: 9 } })
    .add('K3', 'contactor', 220, 400)
    .add('K2', 'contactor', 220, 540)
    .add('M1', 'motor6', 20, 540, { params: { ratedCurrentA: 9, loadPct: 60 } })
    .add('G1', 'psu24', 460, 20)
    .add('S1', 'buttonNO', 560, 120)
    .add('S2', 'buttonNC', 620, 120)
    .add('A1', 'plc', 480, 300, { program: prog });
  contactorTo(b, 'K1', 'F1', false, 'X1', ['1', '3', '5']);
  b.wire('F1:2', 'M1:U1').wire('F1:4', 'M1:V1').wire('F1:6', 'M1:W1');
  // Üçgen: U1-W2, V1-U2, W1-V2
  b.wire('F1:2', 'K3:1').wire('K3:2', 'M1:W2').wire('F1:4', 'K3:3').wire('K3:4', 'M1:U2').wire('F1:6', 'K3:5').wire('K3:6', 'M1:V2');
  // Yıldız: U2, V2, W2 K2 üzerinden köprülenir
  b.wire('M1:U2', 'K2:1').wire('M1:V2', 'K2:3').wire('M1:W2', 'K2:5').wire('K2:2', 'K2:4').wire('K2:4', 'K2:6');
  plcPower(b);
  buttonTo(b, 'S1', 'A1:I0.0');
  buttonTo(b, 'S2', 'A1:I0.1', true);
  b.wire('G1:L+', 'F1:95').wire('F1:96', 'A1:I0.2');
  coilFrom(b, 'A1:Q0.0', 'K1');
  coilFrom(b, 'A1:Q0.1', 'K2');
  coilFrom(b, 'A1:Q0.2', 'K3');
  return b.build();
}

export function vfdModbusSchematic(): Schematic {
  const prog = program(
    net('N1', 'Çalış belleği', series(parallel(no('%I0.0', 'Start'), no('%M0.0')), no('%I0.1', 'Stop')), coil('%M0.0')),
    net('N2', 'Kontrol kelimesi: çalış', no('%M0.0'), box('MOVE', '%MW0', { IN: '1' })),
    net('N3', 'Kontrol kelimesi: dur', nc('%M0.0'), box('MOVE', '%MW0', { IN: '0' })),
    net('N4', 'Hız referansı (pot → 0..50,00 Hz)', always(), box('SCALE', '%MW1', { IN: '%IW0', IN_MIN: '0', IN_MAX: '27648', OUT_MIN: '0', OUT_MAX: '5000' })),
  );
  const polls: ModbusPoll[] = [
    { id: 'r1', unit: 2, fn: 16, remote: 0, qty: 2, local: '%MW0', periodMs: 50 },
    { id: 'r2', unit: 2, fn: 3, remote: 2, qty: 2, local: '%MW10', periodMs: 100 },
  ];
  const b = builder('VFD: Modbus RTU ile hız kontrolü', [{ id: 'p1', title: 'Sürücü ve kumanda' }])
    .add('X1', 'mains3', 20, 20)
    .add('T1', 'vfd', 20, 140, { params: { control: 'modbus', rampUpS: 3, rampDownS: 2 } })
    .add('M1', 'motor3', 20, 360)
    .add('G1', 'psu24', 420, 20)
    .add('S1', 'buttonNO', 520, 120)
    .add('S2', 'buttonNC', 580, 120)
    .add('R1', 'potentiometer', 660, 120, { params: { initialPct: 60 } })
    .add('A1', 'plc', 440, 300, { program: prog, modbusPolls: polls });
  b.wire('X1:L1', 'T1:L1').wire('X1:L2', 'T1:L2').wire('X1:L3', 'T1:L3');
  b.wire('T1:U', 'M1:U').wire('T1:V', 'M1:V').wire('T1:W', 'M1:W');
  plcPower(b);
  buttonTo(b, 'S1', 'A1:I0.0');
  buttonTo(b, 'S2', 'A1:I0.1', true);
  supply(b, 'R1');
  return b.wire('R1:OUT', 'A1:AI0').wire('A1:RS485_A', 'T1:RS485_A').wire('A1:RS485_B', 'T1:RS485_B').build();
}

// --- Akışkan gücü ----------------------------------------------------------------------------

export function electroPneumaticSchematic(): Schematic {
  const prog = program(
    net('N1', 'Çevrim: start + geride → ileri, ön sensörde geri', series(parallel(series(no('%I0.0', 'Start'), no('%I0.1', 'Geride')), no('%Q0.0')), nc('%I0.2', 'İleride')), coil('%Q0.0')),
  );
  const b = builder('Elektro-pnömatik: tek çevrim', [{ id: 'p1', title: 'Pnömatik ve elektrik' }])
    .add('G1', 'psu24', 20, 20)
    .add('S1', 'buttonNO', 140, 120)
    .add('K1', 'relay', 240, 100)
    .add('A1', 'plc', 120, 260, { program: prog })
    .add('P1', 'airSupply', 460, 420)
    .add('Y1', 'valve52', 560, 400)
    .add('V1', 'throttleCheck', 680, 300, { params: { openPct: 40 } })
    .add('Z1', 'cylDouble', 560, 180, { params: { extendMs: 700, retractMs: 600 } });
  plcPower(b);
  buttonTo(b, 'S1', 'A1:I0.0');
  coilFrom(b, 'A1:Q0.0', 'K1');
  b.wire('G1:L+', 'K1:13').wire('K1:14', 'Y1:A1').wire('Y1:A2', 'G1:M');
  b.wire('G1:L+', 'Z1:13').wire('Z1:14', 'A1:I0.1').wire('G1:L+', 'Z1:23').wire('Z1:24', 'A1:I0.2');
  return b.wire('P1:1', 'Y1:1').wire('Y1:4', 'Z1:A').wire('Y1:2', 'V1:1').wire('V1:2', 'Z1:B').build();
}

export function hydraulicPressSchematic(): Schematic {
  const prog = program(
    net('N1', 'Pompa motoru', series(parallel(no('%I0.2', 'Pompa start'), no('%Q0.2')), no('%I0.3', 'Stop')), coil('%Q0.2')),
    net('N2', 'Basınç bar', always(), box('SCALE', '%MW0', { IN: '%IW0', IN_MIN: '0', IN_MAX: '27648', OUT_MIN: '0', OUT_MAX: '250' })),
    net('N3', 'Pres çevrimi başlat', series(no('%I0.0', 'Aşağı'), no('%Q0.2')), coil('%M0.0', 'set')),
    net('N4', 'Basınca ulaşınca (100 bar) bitir', series(no('%M0.0'), cmp('%MW0', '>=', '100')), coil('%Q0.3', 'set')),
    net('N5', 'Çevrim sonu / yukarı', parallel(no('%Q0.3'), no('%I0.1', 'Yukarı'), nc('%Q0.2')), coil('%M0.0', 'reset')),
    net('N6', 'Valf aşağı Y1', series(no('%M0.0'), nc('%Q0.1')), coil('%Q0.0')),
    net('N7', 'Valf yukarı Y2', series(no('%I0.1', 'Yukarı'), no('%Q0.2'), nc('%Q0.0')), coil('%Q0.1')),
    net('N8', 'Yukarıda "tamam" sıfırlanır', no('%I0.1'), coil('%Q0.3', 'reset')),
  );
  const b = builder('Hidrolik pres: basınç sınırlı', [{ id: 'p1', title: 'Hidrolik ve kumanda' }])
    .add('X1', 'mains3', 20, 20)
    .add('K3', 'contactor', 20, 100)
    .add('P1', 'hpu', 20, 240, { params: { flowLpm: 12, reliefBar: 160 } })
    .add('Y1', 'valve43', 260, 400, { params: { center: 'tandem' } })
    .add('Z1', 'hydCylinder', 240, 540, { params: { boreMm: 50, rodMm: 28, strokeMm: 250, loadKN: 8 } })
    .add('PT1', 'pressureTx', 260, 240, { params: { target: 'P1', min: 0, max: 250 } })
    .add('G1', 'psu24', 500, 20)
    .add('S1', 'buttonNO', 600, 100)
    .add('S2', 'buttonNO', 660, 100)
    .add('S3', 'buttonNO', 720, 100)
    .add('S4', 'buttonNC', 780, 100)
    .add('K1', 'relay', 560, 520)
    .add('K2', 'relay', 700, 520)
    .add('A1', 'plc', 560, 300, { program: prog, params: { ai0Type: '4-20mA' } });
  contactorTo(b, 'K3', 'P1');
  plcPower(b);
  buttonTo(b, 'S1', 'A1:I0.0');
  buttonTo(b, 'S2', 'A1:I0.1');
  buttonTo(b, 'S3', 'A1:I0.2');
  buttonTo(b, 'S4', 'A1:I0.3', true);
  coilFrom(b, 'A1:Q0.0', 'K1');
  coilFrom(b, 'A1:Q0.1', 'K2');
  coilFrom(b, 'A1:Q0.2', 'K3');
  b.wire('G1:L+', 'K1:13').wire('K1:14', 'Y1:A1').wire('Y1:A2', 'G1:M');
  b.wire('G1:L+', 'K2:13').wire('K2:14', 'Y1:B1').wire('Y1:B2', 'G1:M');
  supply(b, 'PT1');
  b.wire('PT1:OUT', 'A1:AI0').wire('G1:L+', 'Z1:23').wire('Z1:24', 'A1:I0.4');
  return b.wire('P1:P', 'Y1:P').wire('P1:T', 'Y1:T').wire('Y1:A', 'Z1:A').wire('Y1:B', 'Z1:B').build();
}

export function excavatorSchematic(): Schematic {
  const b = builder('Kepçe: elle hidrolik kumanda', [{ id: 'p1', title: 'Hidrolik kumanda' }])
    .add('X1', 'mains3', 20, 20)
    .add('P1', 'hpu', 20, 100, { params: { flowLpm: 60, reliefBar: 200 } })
    .add('G1', 'psu24', 240, 20)
    .add('E1', 'excavator', 520, 300);
  b.wire('X1:L1', 'P1:U').wire('X1:L2', 'P1:V').wire('X1:L3', 'P1:W');
  supply(b, 'E1', 'L+', 'M');
  const joints = [
    ['Y1', 'bom', 'E1:A1', 'E1:B1'],
    ['Y2', 'arm', 'E1:A2', 'E1:B2'],
    ['Y3', 'kova', 'E1:A3', 'E1:B3'],
  ] as const;
  joints.forEach(([y, , a, bb], i) => {
    const x = 220 + i * 200;
    b.add(y, 'valve43', 240, 260 + i * 120).add(`S${2 * i + 1}`, 'buttonNO', x, 120).add(`S${2 * i + 2}`, 'buttonNO', x + 60, 120);
    b.wire('G1:L+', `S${2 * i + 1}:13`).wire(`S${2 * i + 1}:14`, `${y}:A1`).wire(`${y}:A2`, 'G1:M');
    b.wire('G1:L+', `S${2 * i + 2}:13`).wire(`S${2 * i + 2}:14`, `${y}:B1`).wire(`${y}:B2`, 'G1:M');
    b.wire('P1:P', `${y}:P`).wire('P1:T', `${y}:T`).wire(`${y}:A`, a).wire(`${y}:B`, bb);
  });
  return b.build();
}

// --- Robotik ve konumlama --------------------------------------------------------------------

export function positioningSchematic(): Schematic {
  const prog = program(
    net('N1', 'Referansa git isteği', no('%I0.3', 'Referans'), coil('%M0.1', 'set')),
    net('N2', 'Referansta veya sınırda dur', parallel(no('%I0.4', 'REF'), nc('%I0.5', 'LSN')), coil('%M0.1', 'reset')),
    net('N3', 'Referansta sayıcıyı sıfırla', no('%I0.4', 'REF'), coil('HC0', 'reset')),
    net('N4', 'Hedefe git isteği', no('%I0.2', 'Git'), coil('%M0.0', 'set')),
    net('N5', 'Hedefte dur (800 darbe = 400 mm)', parallel(cmp('HC0', '>=', '800'), nc('%I0.6', 'LSP')), coil('%M0.0', 'reset')),
    net('N6', 'İleri K1', series(no('%M0.0'), nc('%M0.1'), nc('%Q0.1')), coil('%Q0.0')),
    net('N7', 'Geri K2', series(no('%M0.1'), nc('%Q0.0')), coil('%Q0.1')),
  );
  const b = builder('Konumlama: enkoder + hızlı sayıcı', [{ id: 'p1', title: 'Eksen ve kumanda' }])
    .add('X1', 'mains3', 20, 20)
    .add('K1', 'contactor', 20, 100)
    .add('K2', 'contactor', 200, 100)
    .add('M1', 'linearAxis', 20, 260, { params: { startMm: 500, refMm: 50, pulsesPerMm: 2, speedMm: 120, coastTauMs: 80 } })
    .add('G1', 'psu24', 420, 20)
    .add('S1', 'buttonNO', 520, 120)
    .add('S2', 'buttonNO', 580, 120)
    .add('A1', 'plc', 420, 420, { program: prog, params: { hsc0: 'quad' } });
  contactorTo(b, 'K1', 'M1');
  contactorTo(b, 'K2', 'M1', true);
  plcPower(b);
  supply(b, 'M1', 'L+', 'M');
  buttonTo(b, 'S1', 'A1:I0.2');
  buttonTo(b, 'S2', 'A1:I0.3');
  coilFrom(b, 'A1:Q0.0', 'K1');
  coilFrom(b, 'A1:Q0.1', 'K2');
  return b
    .wire('M1:A', 'A1:I0.0')
    .wire('M1:B', 'A1:I0.1')
    .wire('M1:REF', 'A1:I0.4')
    .wire('M1:LSN', 'A1:I0.5')
    .wire('M1:LSP', 'A1:I0.6')
    .build();
}

export function pickPlaceSchematic(): Schematic {
  const X0 = '%I0.0';
  const X1 = '%I0.1';
  const Z0 = '%I0.2';
  const Z1 = '%I0.3';
  const GP = '%I0.4';
  const PS = '%I0.5';
  const prog = program(
    net('N1', 'Kavra (alma noktasında aşağıda, parça var)', series(no(X0), no(Z1), no(PS)), coil('%M0.0', 'set')),
    net('N2', 'Bırak (yerleştirmede aşağıda)', series(no(X1), no(Z1), no('%M0.0')), coil('%M0.0', 'reset')),
    net('N3', 'Tutucu YG', no('%M0.0'), coil('%Q0.2')),
    net(
      'N4',
      'Z aşağı YZ',
      parallel(series(no(X0), nc(GP), parallel(no(PS), no('%M0.0'))), series(no(X1), parallel(no('%M0.0'), no(GP)))),
      coil('%Q0.1'),
    ),
    net('N5', 'X yerleştirmeye YX', parallel(series(no('%M0.0'), no(Z0)), series(no('%M0.0'), no(X1)), series(no(X1), nc(Z0))), coil('%Q0.0')),
  );
  const b = builder('Pick & place: otomatik çevrim', [{ id: 'p1', title: 'Portal ve kumanda' }])
    .add('G1', 'psu24', 20, 20)
    .add('A1', 'plc', 40, 300, { program: prog })
    .add('K1', 'relay', 160, 100)
    .add('K2', 'relay', 300, 100)
    .add('K3', 'relay', 440, 100)
    .add('U1', 'pickPlace', 400, 260, { params: { feedS: 2 } });
  plcPower(b);
  supply(b, 'U1', 'L+', 'M');
  ['YX', 'YZ', 'YG'].forEach((y, i) => {
    coilFrom(b, `A1:Q0.${i}`, `K${i + 1}`);
    b.wire('G1:L+', `K${i + 1}:13`).wire(`K${i + 1}:14`, `U1:${y}`);
  });
  ['X0', 'X1', 'Z0', 'Z1', 'GP', 'PS'].forEach((s, i) => b.wire(`U1:${s}`, `A1:I0.${i}`));
  return b.build();
}

export function robotCellSchematic(): Schematic {
  const prog = program(
    net('N1', 'İstek: start + robot hazır', series(no('%I0.0', 'Start'), no('%I0.1', 'READY')), coil('%M0.0', 'set')),
    net('N2', 'Robot bitirdi', no('%I0.2', 'DONE'), coil('%M0.0', 'reset')),
    net('N3', 'START sinyali', no('%M0.0'), coil('%Q0.0')),
    net('N4', 'Program no: P0 = 1 (A→B)', always(), coil('%Q0.1')),
    net('N5', 'Robot hatası → RESET butonu', series(no('%I0.3', 'FAULT'), no('%I0.4', 'Reset')), coil('%Q0.3')),
  );
  const b = builder('Robot hücresi: PLC el sıkışması', [{ id: 'p1', title: 'Hücre' }])
    .add('G1', 'psu24', 20, 20)
    .add('S1', 'buttonNO', 140, 120)
    .add('S2', 'buttonNO', 200, 120)
    .add('A1', 'plc', 40, 280, { program: prog })
    .add('R1', 'robotArm', 420, 120, { params: { feedS: 3 } });
  plcPower(b);
  supply(b, 'R1', 'L+', 'M');
  buttonTo(b, 'S1', 'A1:I0.0');
  buttonTo(b, 'S2', 'A1:I0.4');
  return b
    .wire('A1:Q0.0', 'R1:START')
    .wire('A1:Q0.1', 'R1:P0')
    .wire('A1:Q0.3', 'R1:RESET')
    .wire('R1:READY', 'A1:I0.1')
    .wire('R1:DONE', 'A1:I0.2')
    .wire('R1:FAULT', 'A1:I0.3')
    .build();
}

export function elevatorSchematic(): Schematic {
  const prog = program(
    net('N1', 'Kat çağrısı 1', no('%I0.0'), coil('%M0.1', 'set')),
    net('N2', 'Kat çağrısı 2', no('%I0.1'), coil('%M0.2', 'set')),
    net('N3', 'Kat çağrısı 3', no('%I0.2'), coil('%M0.3', 'set')),
    net('N4', '1. kata gelindi', no('%I0.3'), coil('%M0.1', 'reset')),
    net('N5', '2. kata gelindi', no('%I0.4'), coil('%M0.2', 'reset')),
    net('N6', '3. kata gelindi', no('%I0.5'), coil('%M0.3', 'reset')),
    net('N7', 'Son kat 1', parallel(no('%I0.3'), series(no('%M1.1'), nc('%I0.4'), nc('%I0.5'))), coil('%M1.1')),
    net('N8', 'Son kat 2', parallel(no('%I0.4'), series(no('%M1.2'), nc('%I0.3'), nc('%I0.5'))), coil('%M1.2')),
    net('N9', 'Son kat 3', parallel(no('%I0.5'), series(no('%M1.3'), nc('%I0.3'), nc('%I0.4'))), coil('%M1.3')),
    net('N10', 'Yukarı K1', series(parallel(series(no('%M0.2'), no('%M1.1')), series(no('%M0.3'), parallel(no('%M1.1'), no('%M1.2')))), nc('%Q0.1')), coil('%Q0.0')),
    net('N11', 'Aşağı K2', series(parallel(series(no('%M0.1'), parallel(no('%M1.2'), no('%M1.3'))), series(no('%M0.2'), no('%M1.3'))), nc('%Q0.0')), coil('%Q0.1')),
  );
  const b = builder('Asansör: 3 kat', [{ id: 'p1', title: 'Asansör' }])
    .add('X1', 'mains3', 20, 20)
    .add('K1', 'contactor', 20, 100)
    .add('K2', 'contactor', 200, 100)
    .add('M1', 'elevator', 60, 260, { params: { floorS: 3 } })
    .add('G1', 'psu24', 420, 20)
    .add('S1', 'buttonNO', 520, 120)
    .add('S2', 'buttonNO', 580, 120)
    .add('S3', 'buttonNO', 640, 120)
    .add('A1', 'plc', 420, 320, { program: prog });
  contactorTo(b, 'K1', 'M1');
  contactorTo(b, 'K2', 'M1', true);
  plcPower(b);
  supply(b, 'M1', 'L+', 'M');
  ['S1', 'S2', 'S3'].forEach((s, i) => buttonTo(b, s, `A1:I0.${i}`));
  ['F1', 'F2', 'F3'].forEach((f, i) => b.wire(`M1:${f}`, `A1:I0.${i + 3}`));
  coilFrom(b, 'A1:Q0.0', 'K1');
  coilFrom(b, 'A1:Q0.1', 'K2');
  return b.build();
}

export function garageDoorSchematic(): Schematic {
  const prog = program(
    net('N1', 'Kapanırken engel → geri aç', series(no('%Q0.1'), nc('%I0.4', 'PH')), coil('%M0.0', 'set')),
    net('N2', 'Tam açıkta geri açma biter', no('%I0.2', 'LSO'), coil('%M0.0', 'reset')),
    net('N3', 'Aç K1', series(parallel(no('%I0.0', 'Aç'), no('%Q0.0'), no('%M0.0')), nc('%I0.2', 'LSO'), nc('%Q0.1')), coil('%Q0.0')),
    net(
      'N4',
      'Kapat K2',
      series(parallel(no('%I0.1', 'Kapat'), no('%Q0.1')), nc('%I0.3', 'LSC'), no('%I0.4', 'PH'), nc('%Q0.0'), nc('%M0.0')),
      coil('%Q0.1'),
    ),
  );
  const b = builder('Garaj kapısı: engel algılamalı', [{ id: 'p1', title: 'Kapı' }])
    .add('X1', 'mains3', 20, 20)
    .add('K1', 'contactor', 20, 100)
    .add('K2', 'contactor', 200, 100)
    .add('M1', 'garageDoor', 40, 260, { params: { travelS: 6 } })
    .add('G1', 'psu24', 420, 20)
    .add('S1', 'buttonNO', 520, 120)
    .add('S2', 'buttonNO', 580, 120)
    .add('A1', 'plc', 420, 320, { program: prog });
  contactorTo(b, 'K1', 'M1');
  contactorTo(b, 'K2', 'M1', true);
  plcPower(b);
  supply(b, 'M1', 'L+', 'M');
  buttonTo(b, 'S1', 'A1:I0.0');
  buttonTo(b, 'S2', 'A1:I0.1');
  b.wire('M1:LSO', 'A1:I0.2').wire('M1:LSC', 'A1:I0.3').wire('M1:PH', 'A1:I0.4');
  coilFrom(b, 'A1:Q0.0', 'K1');
  coilFrom(b, 'A1:Q0.1', 'K2');
  return b.build();
}

