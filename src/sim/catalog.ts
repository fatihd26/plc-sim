// Bileşen kütüphanesi (elektriksel taraf): her tipin terminalleri, etiket öneki ve parametreleri.
// Çizim geometrisi UI katmanındadır; terminal adları iki taraf arasındaki sözleşmedir.
// Çekirdek tipler burada, diğerleri bileşen modüllerinde (modules/) tanımlıdır; CATALOG ikisini
// birleştirir. Kullanıcı tanımlı bileşenler (`custom`) tanımlarını şema dokümanında taşır.

import { MODULES, type ModuleType } from './modules';
import {
  choice,
  num,
  readParam,
  voltageParam,
  VOLTAGE_OPTIONS,
  type ComponentSpec,
  type Domain,
  type ParamSpec,
  type ParamValue,
  type Voltage,
} from './spec';

export {
  CATEGORIES,
  VOLTAGE_OPTIONS,
  type Category,
  type ComponentSpec,
  type Domain,
  type ParamSpec,
  type ParamValue,
  type Voltage,
} from './spec';

/** Davranışı simulation.ts içinde olan çekirdek tipler. */
export type CoreType =
  | 'mains3'
  | 'psu24'
  | 'buttonNO'
  | 'buttonNC'
  | 'estop'
  | 'contactor'
  | 'relay'
  | 'breaker3'
  | 'fuse'
  | 'thermal'
  | 'motor3'
  | 'lamp'
  | 'plc'
  | 'esp32'
  | 'terminal'
  | 'junction'
  | 'xref'
  | 'custom';

export type ComponentType = CoreType | ModuleType;

export const PLC_DI = ['I0.0', 'I0.1', 'I0.2', 'I0.3', 'I0.4', 'I0.5', 'I0.6', 'I0.7'] as const;
export const PLC_DQ = ['Q0.0', 'Q0.1', 'Q0.2', 'Q0.3', 'Q0.4', 'Q0.5', 'Q0.6', 'Q0.7'] as const;
/** PLC analog girişleri (%IW0, %IW1) ve çıkışları (%QW0, %QW1). */
export const PLC_AI = ['AI0', 'AI1'] as const;
export const PLC_AQ = ['AQ0', 'AQ1'] as const;
/** ESP32 I/O kartının G/Ç pinleri (esp32.ts ile aynı sıra). */
export const ESP32_PINS = ['GPIO16', 'GPIO17', 'GPIO18', 'GPIO19'] as const;

const pinMode = (pin: string, def: 'in' | 'out'): ParamSpec => ({
  key: `mode_${pin}`,
  label: `${pin} yönü`,
  kind: 'enum',
  default: def,
  options: [
    { value: 'in', label: 'Giriş (24 V)' },
    { value: 'out', label: 'Çıkış (24 V, yalnız röle bobini)' },
  ],
});

/** ESP32 pininin process image biti: otomatik veya 0..7 (%I0.n / %Q0.n, yöne göre). */
const pinAddr = (pin: string): ParamSpec => ({
  key: `addr_${pin}`,
  label: `${pin} adresi`,
  kind: 'enum',
  default: 'auto',
  options: [
    { value: 'auto', label: 'Otomatik (boştaki ilk adres)' },
    ...Array.from({ length: 8 }, (_, n) => ({ value: String(n), label: `%I0.${n} / %Q0.${n} (yöne göre)` })),
  ],
});

const aiType = (i: number) =>
  choice(`ai${i}Type`, `AI${i} (%IW${i}) sinyal tipi`, '0-10V', [
    ['0-10V', '0–10 V'],
    ['4-20mA', '4–20 mA'],
  ]);

const hscMode = (i: number, a: string, b: string) =>
  choice(`hsc${i}`, `HSC${i} hızlı sayıcı (HC${i})`, 'off', [
    ['off', 'Kapalı'],
    ['up', `Yukarı sayma: ${a} darbe girişi`],
    ['quad', `A/B kuadratür: ${a} = A, ${b} = B (yön algılar)`],
  ]);

const CORE: Record<CoreType, ComponentSpec> = {
  mains3: {
    type: 'mains3',
    title: 'Şebeke 3~/N 400/230 V',
    prefix: 'X',
    category: 'Kaynaklar',
    description: 'L1-L2-L3 faz (sağ dönüş sırası) ve N nötr; faz-nötr 230 V',
    terminals: ['L1', 'L2', 'L3', 'N'],
    params: [],
  },
  psu24: {
    type: 'psu24',
    title: 'Güç kaynağı 24 V DC',
    prefix: 'G',
    category: 'Kaynaklar',
    description: 'Kumanda beslemesi: L+ = +24 V, M = 0 V; kısa devrede çıkışı keser',
    terminals: ['L+', 'M'],
    params: [],
  },
  buttonNO: {
    type: 'buttonNO',
    title: 'Buton (NO)',
    prefix: 'S',
    category: 'Komuta',
    description: 'Yaylı, basılıyken kapanan kontak (13-14)',
    terminals: ['13', '14'],
    params: [],
  },
  buttonNC: {
    type: 'buttonNC',
    title: 'Buton (NC)',
    prefix: 'S',
    category: 'Komuta',
    description: 'Yaylı, basılıyken açılan kontak (11-12)',
    terminals: ['11', '12'],
    params: [],
  },
  estop: {
    type: 'estop',
    title: 'Acil stop',
    prefix: 'S',
    category: 'Komuta',
    description: 'Mantar başlı, kilitlemeli NC kontak (11-12)',
    terminals: ['11', '12'],
    params: [],
  },
  contactor: {
    type: 'contactor',
    title: 'Kontaktör',
    prefix: 'K',
    category: 'Şalt',
    description: '3 ana kontak, 13-14 NO, 21-22 NC, bobin A1-A2 (24 V DC / 230 V AC)',
    terminals: ['1', '2', '3', '4', '5', '6', '13', '14', '21', '22', 'A1', 'A2'],
    params: [
      voltageParam('coilVoltage', 'Bobin gerilimi'),
      num('pickupMs', 'Çekme süresi', 20, 1, 500, 1, 'ms'),
      num('dropoutMs', 'Bırakma süresi', 15, 1, 500, 1, 'ms'),
    ],
  },
  relay: {
    type: 'relay',
    title: 'Röle (ara röle)',
    prefix: 'K',
    category: 'Şalt',
    description:
      'PLC çıkışı ile yük arasında: bobin A1-A2, 13-14 ve 23-24 NO, 31-32 NC. Tek fazlı (230 V) ve 24 V yükler bu röle üzerinden beslenir',
    terminals: ['13', '14', '23', '24', '31', '32', 'A1', 'A2'],
    params: [
      voltageParam('coilVoltage', 'Bobin gerilimi'),
      num('pickupMs', 'Çekme süresi', 10, 1, 500, 1, 'ms'),
      num('dropoutMs', 'Bırakma süresi', 8, 1, 500, 1, 'ms'),
    ],
  },
  breaker3: {
    type: 'breaker3',
    title: 'Motor koruma şalteri',
    prefix: 'Q',
    category: 'Koruma',
    description: '3 kutuplu; aşırı akımda (termik) ve kısa devrede (manyetik) açar',
    terminals: ['1', '2', '3', '4', '5', '6'],
    params: [
      num('setCurrentA', 'Ayar akımı Ir', 4, 0.1, 100, 0.1, 'A'),
      num('tauS', 'Isıl zaman sabiti', 300, 1, 3600, 1, 's'),
    ],
  },
  fuse: {
    type: 'fuse',
    title: 'Otomatik sigorta 1P',
    prefix: 'F',
    category: 'Koruma',
    description: 'Kısa devrede açar (1-2); elle tekrar kapatılır',
    terminals: ['1', '2'],
    params: [],
  },
  thermal: {
    type: 'thermal',
    title: 'Termik röle',
    prefix: 'F',
    category: 'Koruma',
    description: 'Aşırı akım koruması, 95-96 NC / 97-98 NO',
    terminals: ['1', '2', '3', '4', '5', '6', '95', '96', '97', '98'],
    params: [
      num('setCurrentA', 'Ayar akımı Ir', 4, 0.1, 100, 0.1, 'A'),
      num('tauS', 'Isıl zaman sabiti', 300, 1, 3600, 1, 's'),
    ],
  },
  motor3: {
    type: 'motor3',
    title: 'Asenkron motor 3~',
    prefix: 'M',
    category: 'Tüketiciler',
    description: 'Faz sırası dönüş yönünü belirler; yük oranı akımı değiştirir. VFD çıkışında hız frekansla değişir',
    terminals: ['U', 'V', 'W'],
    params: [
      num('ratedCurrentA', 'Nominal akım', 4, 0.1, 100, 0.1, 'A'),
      num('ratedRpm', 'Nominal hız', 1450, 100, 3600, 10, 'dev/dk'),
      num('loadPct', 'Yük', 100, 0, 300, 5, '%'),
      num('lockedRotorRatio', 'Kalkış akımı / In', 6, 1, 10, 0.5),
      num('startTauMs', 'Kalkış zaman sabiti', 400, 10, 10_000, 10, 'ms'),
      num('coastTauMs', 'Duruş zaman sabiti', 1500, 10, 60_000, 10, 'ms'),
    ],
  },
  lamp: {
    type: 'lamp',
    title: 'Sinyal lambası',
    prefix: 'P',
    category: 'Sinyal',
    description: 'X1-X2 arasında anma gerilimi varken yanar (24 V DC / 230 V AC)',
    terminals: ['X1', 'X2'],
    params: [
      voltageParam('voltage', 'Anma gerilimi'),
      choice('color', 'Renk', 'green', [
        ['green', 'Yeşil'],
        ['red', 'Kırmızı'],
        ['yellow', 'Sarı'],
        ['white', 'Beyaz'],
      ]),
    ],
  },
  plc: {
    type: 'plc',
    title: 'PLC (8 DI / 8 DQ / 2 AI / 2 AQ)',
    prefix: 'A',
    category: 'Kontrol',
    description:
      '24 V DC giriş/çıkış, 2 analog giriş (%IW0-1, 0–10 V / 4–20 mA → 0..27648), 2 analog çıkış ' +
      '(%QW0-1 → 0–10 V), 2 hızlı sayıcı (HC0-1), RS485 Modbus RTU master',
    terminals: ['L+', 'M', ...PLC_DI, ...PLC_DQ, 'RS485_A', 'RS485_B', ...PLC_AI, ...PLC_AQ],
    params: [
      num('scanTimeMs', 'Scan süresi', 10, 1, 100, 1, 'ms'),
      aiType(0),
      aiType(1),
      hscMode(0, 'I0.0', 'I0.1'),
      hscMode(1, 'I0.2', 'I0.3'),
      choice('baud', 'RS485 baud hızı', '19200', ['9600', '19200', '38400', '115200'].map((v) => [v, `${v} bit/s`])),
      num('timeoutMs', 'Modbus zaman aşımı', 200, 10, 5000, 10, 'ms'),
    ],
  },
  esp32: {
    type: 'esp32',
    title: 'ESP32 I/O kartı',
    prefix: 'A',
    category: 'Kontrol',
    description:
      '24 V besleme, 4 GPIO (giriş/çıkış seçilebilir, 24 V), ADC1 (0–10 V), RS485 Modbus RTU slave. Çıkışlar yalnız röle bobini sürer',
    terminals: ['24V', 'GND', 'RS485_A', 'RS485_B', ...ESP32_PINS, 'ADC1'],
    params: [
      choice('firmware', 'Firmware', 'ladder', [
        ['ladder', 'Ladder programı (PLC gibi; alt panelden düzenlenir)'],
        ['modbusSlave', 'Modbus slave G/Ç (coil → çıkış, giriş → DI)'],
        ['local', 'Yerel: giriş çıkışa aktarılır (GPIO16 → 18, 17 → 19)'],
      ]),
      ...ESP32_PINS.flatMap((pin, i) => [pinMode(pin, i < 2 ? 'in' : 'out'), pinAddr(pin)]),
      num('slaveId', 'Modbus adresi', 1, 1, 247, 1),
      choice('baud', 'Baud hızı', '19200', ['9600', '19200', '38400', '115200'].map((v) => [v, `${v} bit/s`])),
      num('loopMs', 'Firmware döngüsü', 10, 1, 1000, 1, 'ms'),
    ],
  },
  terminal: {
    type: 'terminal',
    title: 'Klemens',
    prefix: 'X',
    category: 'Bağlantı',
    description: 'Geçiş klemensi: 1 ve 2 her zaman bağlı',
    terminals: ['1', '2'],
    params: [],
  },
  junction: {
    type: 'junction',
    title: 'Bağlantı noktası',
    prefix: 'J',
    category: 'Bağlantı',
    description: 'Kabloların dallandığı nokta; kablonun ortasına kablo bırakınca kendiliğinden oluşur',
    terminals: ['1'],
    params: [],
  },
  xref: {
    type: 'xref',
    title: 'Sayfa geçişi',
    prefix: 'XR',
    category: 'Bağlantı',
    description: 'Aynı etiketli tüm sayfa geçişleri elektriksel olarak bağlıdır (ör. "L+" veya "24V")',
    terminals: ['1'],
    params: [],
  },
  custom: {
    type: 'custom',
    title: 'Kullanıcı bileşeni',
    prefix: 'U',
    category: 'Kullanıcı',
    description: 'Kullanıcının tanımladığı kutuplardan oluşan bileşen',
    terminals: [],
    params: [],
    hidden: true,
  },
};

export const CATALOG: Record<ComponentType, ComponentSpec> = {
  ...CORE,
  ...(Object.fromEntries(MODULES.map((m) => [m.spec.type, m.spec as ComponentSpec])) as Record<ModuleType, ComponentSpec>),
};

export const COMPONENT_TYPES = Object.keys(CATALOG) as ComponentType[];

/** Çekirdek arızalar (modül arızaları modülde tanımlıdır). */
export const CORE_FAULTS: Partial<Record<CoreType, { key: string; label: string }[]>> = {
  buttonNO: [{ key: 'open', label: 'Kontak yanık (hiç kapanmıyor)' }],
  buttonNC: [{ key: 'open', label: 'Kontak yanık (hiç kapanmıyor)' }],
  estop: [{ key: 'open', label: 'Kontak yanık (devre sürekli açık)' }],
  contactor: [
    { key: 'coil', label: 'Bobin yanık (çekmiyor)' },
    { key: 'welded', label: 'Ana kontaklar yapışık (bırakmıyor)' },
  ],
  relay: [
    { key: 'coil', label: 'Bobin yanık (çekmiyor)' },
    { key: 'welded', label: 'Kontaklar yapışık (bırakmıyor)' },
  ],
  lamp: [{ key: 'burnt', label: 'Ampul yanık' }],
  motor3: [
    { key: 'jam', label: 'Mil sıkışmış (kilitli rotor)' },
    { key: 'phase', label: 'Bir faz kopuk (W sargısı)' },
  ],
  psu24: [{ key: 'dead', label: 'Güç kaynağı arızalı (çıkış yok)' }],
  thermal: [{ key: 'stuck', label: '95-96 kontağı açık kalmış' }],
};

// --- Kullanıcı tanımlı bileşen ----------------------------------------------------------

/**
 * Kutup türleri:
 *  link   – her zaman bağlı (köprü)
 *  pushNO – elle basılıyken kapanan kontak, pushNC – elle basılıyken açılan
 *  NO/NC  – bileşenin bobini çekince kapanan / açılan kontak
 *  coil   – bobin (tanımdaki gerilimde çeker), lamp – gösterge lambası
 */
export type PoleKind = 'link' | 'pushNO' | 'pushNC' | 'NO' | 'NC' | 'coil' | 'lamp';

export const POLE_KINDS: { value: PoleKind; label: string }[] = [
  { value: 'NO', label: 'Kontak NO (bobinle)' },
  { value: 'NC', label: 'Kontak NC (bobinle)' },
  { value: 'pushNO', label: 'Buton NO (elle)' },
  { value: 'pushNC', label: 'Buton NC (elle)' },
  { value: 'coil', label: 'Bobin' },
  { value: 'lamp', label: 'Lamba' },
  { value: 'link', label: 'Köprü (sabit)' },
];

export interface CustomPole {
  kind: PoleKind;
  top: string;
  bottom: string;
}

export interface CustomDef {
  id: string;
  title: string;
  prefix: string;
  /** Bobin ve lambaların anma gerilimi. */
  voltage: Voltage;
  poles: CustomPole[];
}

export const MAX_CUSTOM_POLES = 8;

export function validateCustomDef(def: CustomDef): string[] {
  const errors: string[] = [];
  if (!def.title.trim()) errors.push('Ad boş olamaz');
  if (!/^[A-Z]{1,3}$/.test(def.prefix)) errors.push('Önek 1-3 büyük harf olmalı (ör. K, KA)');
  if (def.poles.length === 0 || def.poles.length > MAX_CUSTOM_POLES) {
    errors.push(`Kutup sayısı 1-${MAX_CUSTOM_POLES} olmalı`);
  }
  const names = def.poles.flatMap((p) => [p.top.trim(), p.bottom.trim()]);
  if (names.some((n) => !n)) errors.push('Terminal adı boş olamaz');
  const dup = names.find((n, i) => n && names.indexOf(n) !== i);
  if (dup) errors.push(`Terminal adı tekrarlanıyor: ${dup}`);
  if (!def.poles.some((p) => p.kind === 'coil') && def.poles.some((p) => p.kind === 'NO' || p.kind === 'NC')) {
    errors.push('Bobinle çalışan kontaklar için en az bir bobin kutbu gerekir');
  }
  if (!VOLTAGE_OPTIONS.some((o) => o.value === def.voltage)) errors.push('Geçersiz gerilim');
  return errors;
}

// --- Örnek bazında erişim -----------------------------------------------------------------

interface InstanceLike {
  type: ComponentType;
  params?: Record<string, ParamValue>;
  custom?: CustomDef;
}

export function terminalsOf(inst: InstanceLike): readonly string[] {
  if (inst.type === 'custom') return inst.custom?.poles.flatMap((p) => [p.top, p.bottom]) ?? [];
  return CATALOG[inst.type].terminals;
}

export function titleOf(inst: InstanceLike): string {
  return inst.type === 'custom' ? (inst.custom?.title ?? CATALOG.custom.title) : CATALOG[inst.type].title;
}

export function prefixOf(inst: InstanceLike): string {
  return inst.type === 'custom' ? (inst.custom?.prefix ?? CATALOG.custom.prefix) : CATALOG[inst.type].prefix;
}

/** Parametre değeri; tanımsız, tipi yanlış veya aralık dışıysa varsayılan/sınırlanmış değer. */
export function paramOf(inst: InstanceLike, key: string): ParamValue {
  return readParam(CATALOG[inst.type].params, inst, key, inst.type);
}

export const numParam = (inst: InstanceLike, key: string) => paramOf(inst, key) as number;
export const strParam = (inst: InstanceLike, key: string) => paramOf(inst, key) as string;

/** Terminalin fiziksel alanı (elektrik, pnömatik, hidrolik). */
export function terminalDomain(inst: InstanceLike, terminal: string): Domain {
  if (inst.type === 'custom') return 'electric';
  return CATALOG[inst.type].domains?.[terminal] ?? 'electric';
}

/** Örneğin parametre okuyucusu: `readParamOf(c).num('pickupMs')`. */
export const readParamOf = (inst: InstanceLike) => ({
  num: (key: string) => numParam(inst, key),
  str: (key: string) => strParam(inst, key),
});
