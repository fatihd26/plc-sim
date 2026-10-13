import type { ContactType, LadderNode, LadderProgram, Network } from './ladder';
import { startStopProgram } from './programs';
import type { ModbusPoll } from './modbusMaster';
import {
  electroPneumaticSchematic,
  elevatorSchematic,
  excavatorSchematic,
  furnaceSchematic,
  garageDoorSchematic,
  hydraulicPressSchematic,
  pickPlaceSchematic,
  pidTankSchematic,
  positioningSchematic,
  robotCellSchematic,
  starDeltaSchematic,
  vfdModbusSchematic,
} from './examplesLib';
import type { ComponentInstance, Schematic, Wire } from './schematic';

let n = 0;
const w = (a: string, b: string): Wire => {
  const [ac, at] = a.split(':') as [string, string];
  const [bc, bt] = b.split(':') as [string, string];
  return { id: `w${++n}`, a: { component: ac, terminal: at }, b: { component: bc, terminal: bt } };
};

/**
 * Start-stop mühürleme devresi.
 * Güç: X1 → K1 ana kontaklar → F2 termik → M1.
 * Kumanda: G1 24 V → S1 (NO) / S2 (NC) / F2 95-96 → PLC girişleri; Q0.0 → K1 bobini.
 */
export function startStopSchematic(): Schematic {
  n = 0;
  return {
    version: 2,
    title: 'Start-stop örneği',
    pages: [{ id: 'p1', title: 'Güç ve kumanda devresi' }],
    components: [
      { id: 'X1', type: 'mains3', name: 'X1', x: 40, y: 40, rotation: 0 },
      { id: 'K1', type: 'contactor', name: 'K1', x: 40, y: 160, rotation: 0 },
      { id: 'F2', type: 'thermal', name: 'F2', x: 40, y: 300, rotation: 0 },
      { id: 'M1', type: 'motor3', name: 'M1', x: 40, y: 440, rotation: 0 },
      { id: 'G1', type: 'psu24', name: 'G1', x: 300, y: 20, rotation: 0 },
      { id: 'S1', type: 'buttonNO', name: 'S1', x: 380, y: 140, rotation: 0 },
      { id: 'S2', type: 'buttonNC', name: 'S2', x: 460, y: 140, rotation: 0 },
      { id: 'A1', type: 'plc', name: 'A1', x: 340, y: 280, rotation: 0, program: structuredClone(startStopProgram) },
    ],
    wires: [
      // Güç devresi
      w('X1:L1', 'K1:1'),
      w('X1:L2', 'K1:3'),
      w('X1:L3', 'K1:5'),
      w('K1:2', 'F2:1'),
      w('K1:4', 'F2:3'),
      w('K1:6', 'F2:5'),
      w('F2:2', 'M1:U'),
      w('F2:4', 'M1:V'),
      w('F2:6', 'M1:W'),
      // PLC beslemesi
      w('G1:L+', 'A1:L+'),
      w('G1:M', 'A1:M'),
      // Girişler
      w('G1:L+', 'S1:13'),
      w('S1:13', 'S2:11'),
      w('S1:14', 'A1:I0.0'),
      w('S2:12', 'A1:I0.1'),
      w('G1:L+', 'F2:95'),
      w('F2:96', 'A1:I0.2'),
      // Çıkış
      w('A1:Q0.0', 'K1:A1'),
      w('K1:A2', 'G1:M'),
    ],
  };
}

// --- Mekanik alıştırmalar --------------------------------------------------------------------

let k = 0;
const contact = (address: string, label: string, type: ContactType = 'NO'): LadderNode => ({
  kind: 'contact',
  id: `c${++k}`,
  address,
  contact: type,
  label,
});
const series = (...items: LadderNode[]): LadderNode => ({ kind: 'series', id: `s${++k}`, items });
const parallel = (...branches: LadderNode[]): LadderNode => ({ kind: 'parallel', id: `p${++k}`, branches });
const network = (id: string, title: string, logic: LadderNode, coil: string, label: string): Network => ({
  id,
  title,
  logic,
  coil: { id: `${id}.coil`, address: coil, label },
});

interface Part {
  components: ComponentInstance[];
  wires: Wire[];
}

/** G1 24 V, start (S1 NO → I0.0), stop (S2 NC → I0.1) ve programı verilen PLC. */
function controlPanel(x: number, program: LadderProgram): Part {
  return {
    components: [
      { id: 'G1', type: 'psu24', name: 'G1', x, y: 20, rotation: 0 },
      { id: 'S1', type: 'buttonNO', name: 'S1', x: x + 80, y: 140, rotation: 0 },
      { id: 'S2', type: 'buttonNC', name: 'S2', x: x + 160, y: 140, rotation: 0 },
      { id: 'A1', type: 'plc', name: 'A1', x: x + 40, y: 280, rotation: 0, program },
    ],
    wires: [
      w('G1:L+', 'A1:L+'),
      w('G1:M', 'A1:M'),
      w('G1:L+', 'S1:13'),
      w('S1:13', 'S2:11'),
      w('S1:14', 'A1:I0.0'),
      w('S2:12', 'A1:I0.1'),
    ],
  };
}

/** Şebeke → K1 → F2 termik → 3~ yük; K1 bobini Q0.0'dan, F2 95-96 I0.2'ye. */
function motorPower(load: ComponentInstance): Part {
  const id = load.id;
  return {
    components: [
      { id: 'X1', type: 'mains3', name: 'X1', x: 40, y: 40, rotation: 0 },
      { id: 'K1', type: 'contactor', name: 'K1', x: 40, y: 160, rotation: 0 },
      { id: 'F2', type: 'thermal', name: 'F2', x: 40, y: 300, rotation: 0 },
      load,
    ],
    wires: [
      w('X1:L1', 'K1:1'),
      w('X1:L2', 'K1:3'),
      w('X1:L3', 'K1:5'),
      w('K1:2', 'F2:1'),
      w('K1:4', 'F2:3'),
      w('K1:6', 'F2:5'),
      w('F2:2', `${id}:U`),
      w('F2:4', `${id}:V`),
      w('F2:6', `${id}:W`),
      w('G1:L+', 'F2:95'),
      w('F2:96', 'A1:I0.2'),
      w('A1:Q0.0', 'K1:A1'),
      w('K1:A2', 'G1:M'),
    ],
  };
}

/**
 * PLC çıkışı yükü doğrudan beslemez: çıkış `relay` rölesinin bobinini (A1-A2) sürer, rölenin
 * 13-14 NO kontağı `supply` beslemesini yüke verir. Varsayılan besleme G1 24 V DC.
 */
function relayLoad(
  relay: string,
  x: number,
  y: number,
  output: string,
  load: [string, string],
  supply: [string, string] = ['G1:L+', 'G1:M'],
  controller = 'A1',
): Part {
  return {
    components: [{ id: relay, type: 'relay', name: relay, x, y, rotation: 0 }],
    wires: [
      w(`${controller}:${output}`, `${relay}:A1`),
      w(`${relay}:A2`, 'G1:M'),
      w(supply[0], `${relay}:13`),
      w(`${relay}:14`, load[0]),
      w(load[1], supply[1]),
    ],
  };
}

const merge = (...parts: Part[]): Part => ({
  components: parts.flatMap((p) => p.components),
  wires: parts.flatMap((p) => p.wires),
});

/** Start ile mühürlenen, stop ile bırakılan çıkış: (I0.0 | Q) & I0.1 & ek koşullar. */
const startStopLogic = (q: string, ...more: LadderNode[]) =>
  series(parallel(contact('%I0.0', 'Start'), contact(q, 'Mühür')), contact('%I0.1', 'Stop'), ...more);

const begin = () => {
  n = 0;
  k = 0;
};

/** 24 V DC fan doğrudan PLC çıkışından: en basit start-stop. */
export function fanSchematic(): Schematic {
  begin();
  const program: LadderProgram = {
    networks: [network('N1', 'Fan E1 start-stop (mühürleme)', startStopLogic('%Q0.0'), '%Q0.0', 'Fan')],
  };
  return {
    version: 2,
    title: 'Fan: PLC + röle ile start-stop',
    pages: [{ id: 'p1', title: 'Kumanda' }],
    ...merge(
      controlPanel(40, program),
      relayLoad('K1', 60, 440, 'Q0.0', ['E1:X1', 'E1:X2'], ['X1:L1', 'X1:N']),
      {
        components: [
          { id: 'X1', type: 'mains3', name: 'X1', x: 320, y: 20, rotation: 0 },
          { id: 'E1', type: 'fan', name: 'E1', x: 60, y: 580, rotation: 0, params: { voltage: '230AC' } },
        ],
        wires: [],
      },
    ),
  };
}

/**
 * Pnömatik piston, tek çevrim: start'a basınca ileri gider, ileri uç sensörü (I0.2) gelince
 * mühür bırakır ve piston geri döner. Geri sensörü I0.3'e bağlı (alıştırma için).
 */
export function pistonSchematic(): Schematic {
  begin();
  const program: LadderProgram = {
    networks: [
      network(
        'N1',
        'Piston ileri; ileri sensörü gelince geri dön',
        startStopLogic('%Q0.0', contact('%I0.2', 'İleri sensörü', 'NC')),
        '%Q0.0',
        'Valf',
      ),
    ],
  };
  return {
    version: 2,
    title: 'Pnömatik piston: tek çevrim',
    pages: [{ id: 'p1', title: 'Kumanda' }],
    ...merge(controlPanel(40, program), relayLoad('K1', 60, 440, 'Q0.0', ['Y1:A1', 'Y1:A2']), {
      components: [
        { id: 'Y1', type: 'cylinder', name: 'Y1', x: 60, y: 580, rotation: 0, params: { extendMs: 1500, retractMs: 1000 } },
      ],
      wires: [
        w('G1:L+', 'Y1:23'),
        w('Y1:24', 'A1:I0.2'),
        w('G1:L+', 'Y1:13'),
        w('Y1:14', 'A1:I0.3'),
      ],
    }),
  };
}

/**
 * Konveyör: bant çalışırken kutu fotosele (I0.3) gelince durur ve P1 yanar. Start'a basılınca
 * kutu gönderilir; kutu fotoseli geçince mühür bandı tekrar tutar.
 */
export function conveyorSchematic(): Schematic {
  begin();
  const program: LadderProgram = {
    networks: [
      network(
        'N1',
        'Bant: kutu fotosele gelince dur',
        series(
          parallel(contact('%I0.0', 'Start'), series(contact('%Q0.0', 'Mühür'), contact('%I0.3', 'Fotosel', 'NC'))),
          contact('%I0.1', 'Stop'),
          contact('%I0.2', 'Termik'),
        ),
        '%Q0.0',
        'Bant',
      ),
      network('N2', 'Kutu bekliyor lambası', contact('%I0.3', 'Fotosel'), '%Q0.1', 'Kutu bekliyor'),
    ],
  };
  const conveyor: ComponentInstance = {
    id: 'M1',
    type: 'conveyor',
    name: 'M1',
    x: 40,
    y: 440,
    rotation: 0,
    params: { transitS: 8, feedS: 3 },
  };
  return {
    version: 2,
    title: 'Konveyör: kutu fotosele gelince dur',
    pages: [{ id: 'p1', title: 'Güç ve kumanda devresi' }],
    ...merge(controlPanel(360, program), motorPower(conveyor), relayLoad('K2', 440, 440, 'Q0.1', ['P1:X1', 'P1:X2']), {
      components: [{ id: 'P1', type: 'lamp', name: 'P1', x: 460, y: 580, rotation: 0, params: { color: 'yellow' } }],
      wires: [w('G1:L+', 'M1:13'), w('M1:14', 'A1:I0.3')],
    }),
  };
}

/**
 * Depo seviye kontrolü: start ile otomatik moda geçilir (Q0.2). Otomatikte su alt sensörün (I0.3)
 * altına inince pompa çalışır, üst sensöre (I0.4) ulaşınca durur. Depo doluyken P1 yanar.
 */
export function tankSchematic(): Schematic {
  begin();
  const program: LadderProgram = {
    networks: [
      network('N1', 'Otomatik mod (start-stop)', startStopLogic('%Q0.2'), '%Q0.2', 'Otomatik'),
      network(
        'N2',
        'Pompa: alt seviyede başla, üst seviyede dur',
        series(
          contact('%Q0.2', 'Otomatik'),
          parallel(contact('%I0.3', 'Alt seviye', 'NC'), contact('%Q0.0', 'Mühür')),
          contact('%I0.4', 'Üst seviye', 'NC'),
          contact('%I0.2', 'Termik'),
        ),
        '%Q0.0',
        'Pompa',
      ),
      network('N3', 'Depo dolu lambası', contact('%I0.4', 'Üst seviye'), '%Q0.1', 'Depo dolu'),
    ],
  };
  const pump: ComponentInstance = {
    id: 'M1',
    type: 'pump',
    name: 'M1',
    x: 40,
    y: 440,
    rotation: 0,
    params: { fillS: 15, drainS: 40, initialPct: 30 },
  };
  return {
    version: 2,
    title: 'Depo seviye kontrolü',
    pages: [{ id: 'p1', title: 'Güç ve kumanda devresi' }],
    ...merge(controlPanel(360, program), motorPower(pump), relayLoad('K2', 440, 440, 'Q0.1', ['P1:X1', 'P1:X2']), {
      components: [{ id: 'P1', type: 'lamp', name: 'P1', x: 460, y: 580, rotation: 0, params: { color: 'yellow' } }],
      wires: [w('G1:L+', 'M1:13'), w('M1:14', 'A1:I0.3'), w('G1:L+', 'M1:23'), w('M1:24', 'A1:I0.4')],
    }),
  };
}

/**
 * Zamanlayıcı ve sayıcı: S1 basışları C0 (CTU, PV 3) ile sayılır. Sayım sürerken P2 yanıp söner
 * (T1/T2 flaşör). 3. basıştan 2 s sonra (T0, TON) P1 set edilir. S2 (stop) sayıcıyı ve P1'i
 * sıfırlar.
 */
export function timerCounterSchematic(): Schematic {
  begin();
  const box = (id: string, title: string, logic: LadderNode, coil: Network['coil']): Network => ({ id, title, logic, coil });
  const program: LadderProgram = {
    networks: [
      box('N1', 'Start basışlarını say', contact('%I0.0', 'Start'), {
        id: 'N1.coil',
        address: 'C0',
        type: 'CTU',
        preset: 3,
        label: 'Basış sayısı',
      }),
      box('N2', '3 basış olunca 2 s bekle', contact('C0', 'Sayım tamam'), {
        id: 'N2.coil',
        address: 'T0',
        type: 'TON',
        preset: 2000,
        label: 'Gecikme',
      }),
      box('N3', 'Süre dolunca P1 yanar (set)', contact('T0', 'Gecikme bitti'), {
        id: 'N3.coil',
        address: '%Q0.0',
        type: 'set',
        label: 'Hazır',
      }),
      box('N4', 'Stop: sayıcıyı sıfırla', contact('%I0.1', 'Stop', 'NC'), {
        id: 'N4.coil',
        address: 'C0',
        type: 'reset',
      }),
      box('N5', 'Stop: P1 söner (reset)', contact('%I0.1', 'Stop', 'NC'), {
        id: 'N5.coil',
        address: '%Q0.0',
        type: 'reset',
        label: 'Hazır',
      }),
      box(
        'N6',
        'Flaşör: sayım varken T1 çalışır',
        series({ kind: 'compare', id: `cmp${++k}`, op: '>', a: 'C0', b: '0', label: 'Sayım var' }, contact('T2', 'Flaşör', 'NC')),
        { id: 'N6.coil', address: 'T1', type: 'TON', preset: 500, label: 'Yanık süre' },
      ),
      box('N7', 'Flaşör: T2 sönük süre', contact('T1', 'Flaşör'), {
        id: 'N7.coil',
        address: 'T2',
        type: 'TON',
        preset: 500,
        label: 'Sönük süre',
      }),
      network('N8', 'P2 yanıp söner (sayım sürüyor)', series(contact('T1', 'Flaşör'), contact('%Q0.0', 'Hazır', 'NC')), '%Q0.1', 'Sayıyor'),
    ],
  };
  return {
    version: 2,
    title: 'Zamanlayıcı ve sayıcı',
    pages: [{ id: 'p1', title: 'Kumanda' }],
    ...merge(
      controlPanel(40, program),
      relayLoad('K1', 60, 440, 'Q0.0', ['P1:X1', 'P1:X2']),
      relayLoad('K2', 200, 440, 'Q0.1', ['P2:X1', 'P2:X2']),
      {
        components: [
          { id: 'P1', type: 'lamp', name: 'P1', x: 60, y: 580, rotation: 0, params: { voltage: '24DC', color: 'green' } },
          { id: 'P2', type: 'lamp', name: 'P2', x: 200, y: 580, rotation: 0, params: { voltage: '24DC', color: 'yellow' } },
        ],
        wires: [],
      },
    ),
  };
}

/**
 * ESP32 I/O kartı, ladder firmware'i: S1 (GPIO16 → %I0.0) basılınca P1 yanar, bırakıldıktan
 * 2 s sonra söner (TOF T0 → %Q0.0 → GPIO18 → K1). ADC1 5 V'u geçince (%MW0 > 2047) P2 yanar
 * (%Q0.1 → GPIO19 → K2). Pin adresleri otomatik eşlenir (girişler %I0.0, çıkışlar %Q0.0'dan). Yükler PLC'deki gibi röle üzerinden beslenir.
 */
export function esp32Schematic(): Schematic {
  begin();
  const program: LadderProgram = {
    networks: [
      {
        id: 'N1',
        title: 'S1 bırakılınca 2 s daha',
        logic: contact('%I0.0', 'S1 (GPIO16)'),
        coil: { id: 'N1.coil', address: 'T0', type: 'TOF', preset: 2000, label: 'Kapanma gecikmesi' },
      },
      network('N2', 'P1 lambası', contact('T0', 'Gecikmeli'), '%Q0.0', 'GPIO18 → K1'),
      network(
        'N3',
        'ADC 5 V üstünde P2',
        { kind: 'compare', id: `cmp${++k}`, op: '>', a: '%MW0', b: '2047', label: 'ADC ham' },
        '%Q0.1',
        'GPIO19 → K2',
      ),
    ],
  };
  return {
    version: 2,
    title: 'ESP32 I/O kartı (ladder)',
    pages: [{ id: 'p1', title: 'Kumanda' }],
    ...merge(
      relayLoad('K1', 80, 440, 'GPIO18', ['P1:X1', 'P1:X2']),
      relayLoad('K2', 220, 440, 'GPIO19', ['P2:X1', 'P2:X2']),
      {
        components: [
          { id: 'G1', type: 'psu24', name: 'G1', x: 40, y: 20, rotation: 0 },
          { id: 'S1', type: 'buttonNO', name: 'S1', x: 200, y: 120, rotation: 0 },
          { id: 'A1', type: 'esp32', name: 'A1', x: 40, y: 260, rotation: 0, program },
          { id: 'P1', type: 'lamp', name: 'P1', x: 80, y: 580, rotation: 0, params: { color: 'green' } },
          { id: 'P2', type: 'lamp', name: 'P2', x: 220, y: 580, rotation: 0, params: { color: 'yellow' } },
        ],
        wires: [w('G1:L+', 'A1:24V'), w('G1:M', 'A1:GND'), w('G1:L+', 'S1:13'), w('S1:14', 'A1:GPIO16')],
      },
    ),
  };
}

/**
 * PLC ↔ ESP32 Modbus RTU: A1 (PLC, master) ve A2 (ESP32, slave 1) RS485 ile bağlı.
 *   - S1 (PLC %I0.0) → %M12.0 → FC15 → ESP32 coil 0 → GPIO18 → K1 → P1
 *   - S2 (ESP32 GPIO16) → DI0 → FC2 → %M10.0 → PLC %Q0.0 → K2 → P2
 *   - ESP32 ADC1 → IR0 → FC4 → %MW10; %MW10 > 2047 (5 V) → PLC %Q0.1 → K3 → P3
 */
export function modbusSchematic(): Schematic {
  begin();
  const program: LadderProgram = {
    networks: [
      network('N1', "S1 → ESP32 GPIO18 (coil 0)", contact('%I0.0', 'S1'), '%M12.0', 'ESP32 coil 0'),
      network('N2', "ESP32 S2 (DI0) → P2", contact('%M10.0', 'ESP32 DI0'), '%Q0.0', 'P2'),
      network(
        'N3',
        'ESP32 ADC 5 V üstünde → P3',
        { kind: 'compare', id: `cmp${++k}`, op: '>', a: '%MW10', b: '2047', label: 'ESP32 ADC' },
        '%Q0.1',
        'P3',
      ),
    ],
  };
  const modbusPolls: ModbusPoll[] = [
    { id: 'p1', unit: 1, fn: 2, remote: 0, qty: 2, local: '%M10.0', periodMs: 50 },
    { id: 'p2', unit: 1, fn: 4, remote: 0, qty: 1, local: '%MW10', periodMs: 100 },
    { id: 'p3', unit: 1, fn: 15, remote: 0, qty: 2, local: '%M12.0', periodMs: 50 },
  ];
  return {
    version: 2,
    title: 'PLC ↔ ESP32 Modbus RTU',
    pages: [{ id: 'p1', title: 'Kumanda ve RS485' }],
    ...merge(
      relayLoad('K2', 20, 440, 'Q0.0', ['P2:X1', 'P2:X2']),
      relayLoad('K3', 160, 440, 'Q0.1', ['P3:X1', 'P3:X2']),
      relayLoad('K1', 400, 440, 'GPIO18', ['P1:X1', 'P1:X2'], ['G1:L+', 'G1:M'], 'A2'),
      {
        components: [
          { id: 'G1', type: 'psu24', name: 'G1', x: 40, y: 20, rotation: 0 },
          { id: 'S1', type: 'buttonNO', name: 'S1', x: 140, y: 140, rotation: 0 },
          { id: 'S2', type: 'buttonNO', name: 'S2', x: 540, y: 140, rotation: 0 },
          {
            id: 'A1',
            type: 'plc',
            name: 'A1',
            x: 40,
            y: 280,
            rotation: 0,
            program,
            modbusPolls,
          },
          { id: 'A2', type: 'esp32', name: 'A2', x: 420, y: 280, rotation: 0, params: { firmware: 'modbusSlave' } },
          { id: 'P2', type: 'lamp', name: 'P2', x: 20, y: 580, rotation: 0, params: { color: 'green' } },
          { id: 'P3', type: 'lamp', name: 'P3', x: 160, y: 580, rotation: 0, params: { color: 'yellow' } },
          { id: 'P1', type: 'lamp', name: 'P1', x: 400, y: 580, rotation: 0, params: { color: 'white' } },
        ],
        wires: [
          w('G1:L+', 'A1:L+'),
          w('G1:M', 'A1:M'),
          w('G1:L+', 'A2:24V'),
          w('G1:M', 'A2:GND'),
          w('G1:L+', 'S1:13'),
          w('S1:14', 'A1:I0.0'),
          w('G1:L+', 'S2:13'),
          w('S2:14', 'A2:GPIO16'),
          // RS485: A-A, B-B
          w('A1:RS485_A', 'A2:RS485_A'),
          w('A1:RS485_B', 'A2:RS485_B'),
        ],
      },
    ),
  };
}

/** Arıza bulma: start-stop devresi, stop butonunun PLC girişine giden kablosu kopuk (gizli). */
export function troubleshootSchematic(): Schematic {
  const s = startStopSchematic();
  s.title = 'Arıza bulma: motor çalışmıyor';
  s.hideFaults = true;
  const w = s.wires.find((x) => x.a.component === 'S2' && x.a.terminal === '12');
  if (w) w.broken = true;
  return s;
}

export type ExampleGroup = 'Temel' | 'Mekanik' | 'Analog ve proses' | 'Sürücüler' | 'Akışkan gücü' | 'Robotik' | 'Arıza bulma' | 'Görevler';

export interface Example {
  id: string;
  group: ExampleGroup;
  title: string;
  /** Ne öğrettiği ve önerilen alıştırma. */
  description: string;
  build(): Schematic;
}

/** "Örnek" menüsü; kolaydan zora. */
export const EXAMPLES: Example[] = [
  {
    id: 'fan',
    group: 'Temel',
    title: 'Fan: start-stop',
    description:
      'PLC çıkışı K1 rölesini sürer, röle kontağı 230 V fanı besler (yük PLC çıkışına doğrudan bağlanmaz). Alıştırma: ikinci bir fan ve rölesini ekleyin.',
    build: fanSchematic,
  },
  {
    id: 'start-stop',
    group: 'Temel',
    title: 'Motor: start-stop',
    description: 'Kontaktör ve termik röleyle 3~ motor. Alıştırma: "motor çalışıyor" lambası ekleyin (PLC çıkışı → röle → lamba).',
    build: startStopSchematic,
  },
  {
    id: 'piston',
    group: 'Mekanik',
    title: 'Pnömatik piston: tek çevrim',
    description:
      "İleri uç sensörü pistonu geri döndürür. Alıştırma: geri sensörünü (I0.3) kullanarak stop'a basılana kadar sürekli ileri-geri çalıştırın.",
    build: pistonSchematic,
  },
  {
    id: 'conveyor',
    group: 'Mekanik',
    title: 'Konveyör: fotoselde dur',
    description:
      'Kutu fotosele gelince bant durur, start kutuyu gönderir. Alıştırma: bant çalışırken yanan yeşil bir "Bant çalışıyor" lambası (Q0.2) ekleyin; lambayı bir röle üzerinden besleyin.',
    build: conveyorSchematic,
  },
  {
    id: 'tank',
    group: 'Mekanik',
    title: 'Depo seviye kontrolü',
    description:
      'Otomatik modda alt seviyede pompa başlar, üst seviyede durur. Alıştırma: alt sensör kuruyken alarm lambası yakın (röle üzerinden).',
    build: tankSchematic,
  },
  {
    id: 'timer-counter',
    group: 'Temel',
    title: 'Zamanlayıcı ve sayıcı',
    description:
      'S1 basışları CTU ile sayılır, sayım sürerken P2 iki TON ile yanıp söner, 3. basıştan 2 s sonra P1 set edilir; S2 reset eder. Alıştırma: P1 yandıktan 5 s sonra kendiliğinden sönsün (TP veya TOF).',
    build: timerCounterSchematic,
  },
  {
    id: 'esp32',
    group: 'Temel',
    title: 'ESP32 I/O kartı',
    description:
      'ESP32 ladder ile programlanır: S1 (GPIO16) bırakıldıktan 2 s sonra P1 söner (TOF), ADC1 5 V üstünde P2 yanar. Programı alt panelden düzenleyin, ADC1\'i Özellikler panelindeki kaydırıcıyla değiştirin. Alıştırma: GPIO17\'ye ikinci bir buton bağlayıp P1\'i sayıcıyla 3 basışta yakın.',
    build: esp32Schematic,
  },
  {
    id: 'modbus',
    group: 'Temel',
    title: 'PLC ↔ ESP32 Modbus RTU',
    description:
      'PLC master, ESP32 slave: S1 (PLC) ESP32\'nin P1 lambasını, S2 (ESP32) PLC\'nin P2 lambasını yakar; ESP32 ADC değeri %MW10\'a okunur. Modbus tablosunu PLC programı panelindeki "Modbus" düğmesinden açın. Alıştırma: RS485 A/B kablolarını ters bağlayın ve zaman aşımını gözleyin.',
    build: modbusSchematic,
  },
  {
    id: 'pid-tank',
    group: 'Analog ve proses',
    title: 'PID seviye kontrolü',
    description:
      'Seviye transmitteri (AI0) ve set potansiyometresi (AI1) PID kutusuna girer, %QW0 oransal vanayı sürer. Tankın tüketimini Özellikler panelinden değiştirip kontrolörün telafisini izleyin. Alıştırma: KP ve TI değerlerini değiştirip aşım ve oturma süresini karşılaştırın.',
    build: pidTankSchematic,
  },
  {
    id: 'furnace',
    group: 'Analog ve proses',
    title: 'Fırın: aç-kapa sıcaklık kontrolü',
    description:
      'PT100 transmitteri 4–20 mA ile okunur, SCALE ile °C\'ye çevrilir; 180–200 °C histerezis bandında röle ısıtıcıyı açıp kapar. Alıştırma: kapağı açınca (fırına tıklayın) ısınma süresinin nasıl değiştiğini gözleyin; sıcaklık 250 °C\'yi geçerse alarm biti (%M) set edin.',
    build: furnaceSchematic,
  },
  {
    id: 'star-delta',
    group: 'Sürücüler',
    title: 'Yıldız-üçgen yol verme',
    description:
      'K1 ana, K2 yıldız, K3 üçgen kontaktörü; T0 (4 s) sonra yıldızdan üçgene geçilir. Motor akımını Özellikler panelinde izleyin: yıldızda 1/3. Alıştırma: K2 ve K3 arasına 100 ms geçiş beklemesi ekleyin.',
    build: starDeltaSchematic,
  },
  {
    id: 'vfd-modbus',
    group: 'Sürücüler',
    title: 'VFD: Modbus ile hız kontrolü',
    description:
      'PLC, frekans konvertörüne FC16 ile kontrol kelimesi (HR0) ve frekans referansını (HR1) yazar, FC3 ile çıkış frekansını %MW10\'a okur. Hız potansiyometreyle ayarlanır. Alıştırma: S1/S2 ile yön değiştirme ekleyin (HR0 bit1).',
    build: vfdModbusSchematic,
  },
  {
    id: 'electro-pneumatic',
    group: 'Akışkan gücü',
    title: 'Elektro-pnömatik: tek çevrim',
    description:
      'Hava kaynağı → 5/2 valf → kısma valfi → çift etkili silindir. Hortumlar basınçlıyken kalın çizilir. Kısma açıklığını değiştirip ileri gitme hızını izleyin. Alıştırma: ikinci bir silindirle A+ B+ A− B− dizisini kurun.',
    build: electroPneumaticSchematic,
  },
  {
    id: 'hydraulic-press',
    group: 'Akışkan gücü',
    title: 'Hidrolik pres: basınç sınırlı',
    description:
      'Güç ünitesi + tandem merkezli 4/3 valf + silindir. S3 pompayı çalıştırır, S1 pres çevrimini başlatır: silindir iner, uçta basınç yükselir; transmitter 100 bar\'ı görünce valf orta konuma döner ve Q0.3 "tamam" olur. S2 yukarı. Alıştırma: Q0.3\'e röle üzerinden "pres tamam" lambası bağlayın.',
    build: hydraulicPressSchematic,
  },
  {
    id: 'excavator',
    group: 'Akışkan gücü',
    title: 'Kepçe: elle hidrolik kumanda',
    description:
      'Üç 4/3 valf, butonlarla doğrudan sürülür (bom, arm, kova). Bomu indirin, armı uzatın, kovayı açıp kapatarak kazın, bomu kaldırıp boşaltın. Alıştırma: PLC ve sınır sensörleriyle otomatik kazı çevrimi yazın.',
    build: excavatorSchematic,
  },
  {
    id: 'positioning',
    group: 'Robotik',
    title: 'Konumlama: enkoder + HSC',
    description:
      'Eksen enkoderi PLC\'nin HC0 hızlı sayıcısına (A/B kuadratür) bağlı. S2 referansa götürür ve sayıcıyı sıfırlar, S1 800 darbede (400 mm) durdurur. Alıştırma: hedefe yaklaşınca yavaşlamak için VFD ekleyin.',
    build: positioningSchematic,
  },
  {
    id: 'pick-place',
    group: 'Robotik',
    title: 'Pick & place: otomatik çevrim',
    description:
      'Elektro-pnömatik portal parçayı alır ve kutuya koyar; sensörlerle kilitlemeli sıralama (Z aşağıdayken X hareketi yok). Alıştırma: yerleştirilen parçaları CTU ile sayıp 5\'te duran bir çevrim yapın.',
    build: pickPlaceSchematic,
  },
  {
    id: 'robot-cell',
    group: 'Robotik',
    title: 'Robot hücresi: el sıkışma',
    description:
      'PLC, robota START ve program numarasını verir; robot READY / BUSY / DONE / FAULT ile yanıtlar. Alıştırma: S1\'e basmadan sürekli çalışan otomatik mod ve program 2 (A→C) seçimi ekleyin.',
    build: robotCellSchematic,
  },
  {
    id: 'elevator',
    group: 'Robotik',
    title: 'Asansör: 3 kat',
    description:
      'Kat çağrıları hafızaya alınır, son geçilen kat hatırlanır, yön kontaktörleri karşılıklı kilitlidir. Alıştırma: her kat için çağrı lambası ve kapı bekleme süresi (TON) ekleyin.',
    build: elevatorSchematic,
  },
  {
    id: 'garage-door',
    group: 'Robotik',
    title: 'Garaj kapısı: engel algılamalı',
    description:
      'Kapanırken fotosel kesilirse kapı geri açılır. Kapının altına tıklayarak engel koyun. Alıştırma: tam açıkta 10 s bekleyip kendiliğinden kapanma ekleyin.',
    build: garageDoorSchematic,
  },
  {
    id: 'troubleshoot',
    group: 'Arıza bulma',
    title: 'Arıza bulma: motor çalışmıyor',
    description:
      'Devrede gizli bir arıza var: start\'a basınca motor çalışmıyor. Simülasyonda kablo potansiyellerini ve PLC giriş LED\'lerini izleyerek arızayı bulun (Özellikler › Proje\'den gizlemeyi kapatınca cevap görünür).',
    build: troubleshootSchematic,
  },
];
