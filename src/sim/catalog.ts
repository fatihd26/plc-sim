// Bileşen kütüphanesi (elektriksel taraf): her tipin terminalleri, etiket öneki ve parametreleri.
// Çizim geometrisi UI katmanındadır; terminal adları iki taraf arasındaki sözleşmedir.
// Kullanıcı tanımlı bileşenler (`custom`) tanımlarını şema dokümanında taşır (CustomDef).

export type ComponentType =
  | 'mains3'
  | 'psu24'
  | 'buttonNO'
  | 'buttonNC'
  | 'estop'
  | 'contactor'
  | 'breaker3'
  | 'fuse'
  | 'thermal'
  | 'motor3'
  | 'lamp'
  | 'plc'
  | 'terminal'
  | 'junction'
  | 'xref'
  | 'custom';

export type Category =
  | 'Kaynaklar'
  | 'Komuta'
  | 'Şalt'
  | 'Koruma'
  | 'Tüketiciler'
  | 'Sinyal'
  | 'Kontrol'
  | 'Bağlantı'
  | 'Kullanıcı';

export const CATEGORIES: readonly Category[] = [
  'Kaynaklar',
  'Komuta',
  'Şalt',
  'Koruma',
  'Tüketiciler',
  'Sinyal',
  'Kontrol',
  'Bağlantı',
  'Kullanıcı',
];

/** Yük (bobin, lamba) anma gerilimi. */
export type Voltage = '24DC' | '230AC';

export const VOLTAGE_OPTIONS: { value: Voltage; label: string }[] = [
  { value: '24DC', label: '24 V DC' },
  { value: '230AC', label: '230 V AC' },
];

export type ParamSpec =
  | {
      key: string;
      label: string;
      kind: 'number';
      unit?: string;
      default: number;
      min: number;
      max: number;
      step: number;
    }
  | { key: string; label: string; kind: 'enum'; default: string; options: { value: string; label: string }[] };

export type ParamValue = number | string;

export interface ComponentSpec {
  type: ComponentType;
  title: string;
  /** IEC 81346 benzeri etiket öneki (K1, S1, M1...). */
  prefix: string;
  /** Kütüphanede gösterilen kısa açıklama. */
  description: string;
  category: Category;
  terminals: readonly string[];
  params: readonly ParamSpec[];
  /** Kütüphanede doğrudan listelenmez (ör. kullanıcı tanımlı bileşenin taban tipi). */
  hidden?: boolean;
}

export const PLC_DI = ['I0.0', 'I0.1', 'I0.2', 'I0.3', 'I0.4', 'I0.5', 'I0.6', 'I0.7'] as const;
export const PLC_DQ = ['Q0.0', 'Q0.1', 'Q0.2', 'Q0.3', 'Q0.4', 'Q0.5', 'Q0.6', 'Q0.7'] as const;

const num = (key: string, label: string, def: number, min: number, max: number, step: number, unit?: string): ParamSpec => ({
  key,
  label,
  kind: 'number',
  default: def,
  min,
  max,
  step,
  unit,
});

const voltageParam = (key: string, label: string): ParamSpec => ({
  key,
  label,
  kind: 'enum',
  default: '24DC',
  options: VOLTAGE_OPTIONS,
});

export const CATALOG: Record<ComponentType, ComponentSpec> = {
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
    description: 'Faz sırası dönüş yönünü belirler; yük oranı akımı değiştirir',
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
      {
        key: 'color',
        label: 'Renk',
        kind: 'enum',
        default: 'green',
        options: [
          { value: 'green', label: 'Yeşil' },
          { value: 'red', label: 'Kırmızı' },
          { value: 'yellow', label: 'Sarı' },
          { value: 'white', label: 'Beyaz' },
        ],
      },
    ],
  },
  plc: {
    type: 'plc',
    title: 'PLC (8 DI / 8 DQ)',
    prefix: 'A',
    category: 'Kontrol',
    description: '24 V DC giriş/çıkış, ladder programı PLC panelinden düzenlenir',
    terminals: ['L+', 'M', ...PLC_DI, ...PLC_DQ],
    params: [num('scanTimeMs', 'Scan süresi', 10, 1, 100, 1, 'ms')],
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

export const COMPONENT_TYPES = Object.keys(CATALOG) as ComponentType[];

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
  const spec = CATALOG[inst.type].params.find((p) => p.key === key);
  if (!spec) throw new Error(`${inst.type}: "${key}" parametresi yok`);
  const v = inst.params?.[key];
  if (spec.kind === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return spec.default;
    return Math.min(spec.max, Math.max(spec.min, v));
  }
  return typeof v === 'string' && spec.options.some((o) => o.value === v) ? v : spec.default;
}

export const numParam = (inst: InstanceLike, key: string) => paramOf(inst, key) as number;
export const strParam = (inst: InstanceLike, key: string) => paramOf(inst, key) as string;
