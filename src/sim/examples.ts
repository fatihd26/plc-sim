import type { ContactType, LadderNode, LadderProgram, Network } from './ladder';
import { startStopProgram } from './programs';
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
): Part {
  return {
    components: [{ id: relay, type: 'relay', name: relay, x, y, rotation: 0 }],
    wires: [
      w(`A1:${output}`, `${relay}:A1`),
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

export interface Example {
  id: string;
  title: string;
  /** Ne öğrettiği ve önerilen alıştırma. */
  description: string;
  build(): Schematic;
}

/** "Örnek" menüsü; kolaydan zora. */
export const EXAMPLES: Example[] = [
  {
    id: 'fan',
    title: 'Fan: start-stop',
    description:
      'PLC çıkışı K1 rölesini sürer, röle kontağı 230 V fanı besler (yük PLC çıkışına doğrudan bağlanmaz). Alıştırma: ikinci bir fan ve rölesini ekleyin.',
    build: fanSchematic,
  },
  {
    id: 'start-stop',
    title: 'Motor: start-stop',
    description: 'Kontaktör ve termik röleyle 3~ motor. Alıştırma: "motor çalışıyor" lambası ekleyin (PLC çıkışı → röle → lamba).',
    build: startStopSchematic,
  },
  {
    id: 'piston',
    title: 'Pnömatik piston: tek çevrim',
    description:
      "İleri uç sensörü pistonu geri döndürür. Alıştırma: geri sensörünü (I0.3) kullanarak stop'a basılana kadar sürekli ileri-geri çalıştırın.",
    build: pistonSchematic,
  },
  {
    id: 'conveyor',
    title: 'Konveyör: fotoselde dur',
    description:
      'Kutu fotosele gelince bant durur, start kutuyu gönderir. Alıştırma: bant çalışırken yanan yeşil bir "Bant çalışıyor" lambası (Q0.2) ekleyin; lambayı bir röle üzerinden besleyin.',
    build: conveyorSchematic,
  },
  {
    id: 'tank',
    title: 'Depo seviye kontrolü',
    description:
      'Otomatik modda alt seviyede pompa başlar, üst seviyede durur. Alıştırma: alt sensör kuruyken alarm lambası yakın (röle üzerinden).',
    build: tankSchematic,
  },
  {
    id: 'timer-counter',
    title: 'Zamanlayıcı ve sayıcı',
    description:
      'S1 basışları CTU ile sayılır, sayım sürerken P2 iki TON ile yanıp söner, 3. basıştan 2 s sonra P1 set edilir; S2 reset eder. Alıştırma: P1 yandıktan 5 s sonra kendiliğinden sönsün (TP veya TOF).',
    build: timerCounterSchematic,
  },
];
