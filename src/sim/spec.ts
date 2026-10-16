// Bileşen tanımı (spec) tipleri ve parametre yardımcıları.
// Hem çekirdek kataloğu (catalog.ts) hem bileşen modülleri (modules/) bunu kullanır; bu dosya
// ikisinden de bir şey import etmez (döngüsel bağımlılık olmasın diye).

/** Yük (bobin, lamba) anma gerilimi. */
export type Voltage = '24DC' | '230AC';

export const VOLTAGE_OPTIONS: { value: Voltage; label: string }[] = [
  { value: '24DC', label: '24 V DC' },
  { value: '230AC', label: '230 V AC' },
];

export type Category =
  | 'Kaynaklar'
  | 'Komuta'
  | 'Şalt'
  | 'Koruma'
  | 'Tüketiciler'
  | 'Sürücüler'
  | 'Sinyal'
  | 'Sensörler'
  | 'Kontrol'
  | 'Bağlantı'
  | 'Mekanik'
  | 'Proses'
  | 'Pnömatik'
  | 'Hidrolik'
  | 'Robotik'
  | 'Sahneler'
  | 'Kullanıcı';

export const CATEGORIES: readonly Category[] = [
  'Kaynaklar',
  'Komuta',
  'Şalt',
  'Koruma',
  'Tüketiciler',
  'Sürücüler',
  'Sinyal',
  'Sensörler',
  'Kontrol',
  'Bağlantı',
  'Mekanik',
  'Proses',
  'Pnömatik',
  'Hidrolik',
  'Robotik',
  'Sahneler',
  'Kullanıcı',
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
  | { key: string; label: string; kind: 'enum'; default: string; options: { value: string; label: string }[] }
  /**
   * Başka bir bileşenin adı (sensörün algıladığı mekanizma, transmitterin ölçtüğü proses).
   * `accepts`: hedefin sağlaması gereken yetenek ('probe' = konum algılama, ya da ölçülen büyüklük).
   * Boş değer = hedef yok (simülasyonda elle değiştirilir).
   */
  | { key: string; label: string; kind: 'target'; default: string; accepts: string };

export type ParamValue = number | string;

/**
 * Terminalin ait olduğu fiziksel alan. Kablo yalnız aynı alandaki terminalleri bağlar:
 * elektrik kablosu, pnömatik hortum veya hidrolik hat.
 */
export type Domain = 'electric' | 'pneumatic' | 'hydraulic';

export interface ComponentSpec<T extends string = string> {
  type: T;
  title: string;
  /** IEC 81346 benzeri etiket öneki (K1, S1, M1...). */
  prefix: string;
  /** Kütüphanede gösterilen kısa açıklama. */
  description: string;
  category: Category;
  terminals: readonly string[];
  params: readonly ParamSpec[];
  /** Elektrik dışı terminallerin alanı (yazılmayanlar elektriktir). */
  domains?: Readonly<Record<string, Exclude<Domain, 'electric'>>>;
  /** Kütüphanede doğrudan listelenmez (ör. kullanıcı tanımlı bileşenin taban tipi). */
  hidden?: boolean;
}

export const num = (
  key: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
  unit?: string,
): ParamSpec => ({ key, label, kind: 'number', default: def, min, max, step, unit });

export const choice = (key: string, label: string, def: string, options: [string, string][]): ParamSpec => ({
  key,
  label,
  kind: 'enum',
  default: def,
  options: options.map(([value, l]) => ({ value, label: l })),
});

export const voltageParam = (key: string, label: string, def: Voltage = '24DC'): ParamSpec => ({
  key,
  label,
  kind: 'enum',
  default: def,
  options: VOLTAGE_OPTIONS,
});

export const targetParam = (key: string, label: string, accepts: string): ParamSpec => ({
  key,
  label,
  kind: 'target',
  default: '',
  accepts,
});

/** Mekanik elemanların tahrik motoru (3~): akım ve zaman sabitleri. */
export const driveParams = (ratedCurrentA: number, ratedRpm: number): ParamSpec[] => [
  num('ratedCurrentA', 'Motor nominal akımı', ratedCurrentA, 0.1, 100, 0.1, 'A'),
  num('ratedRpm', 'Motor nominal hızı', ratedRpm, 100, 3600, 10, 'dev/dk'),
  num('lockedRotorRatio', 'Kalkış akımı / In', 6, 1, 10, 0.5),
  num('startTauMs', 'Kalkış zaman sabiti', 400, 10, 10_000, 10, 'ms'),
  num('coastTauMs', 'Duruş zaman sabiti', 800, 10, 60_000, 10, 'ms'),
];

interface ParamHolder {
  params?: Record<string, ParamValue>;
}

/** Parametre değeri; tanımsız, tipi yanlış veya aralık dışıysa varsayılan/sınırlanmış değer. */
export function readParam(specs: readonly ParamSpec[], inst: ParamHolder, key: string, owner = '?'): ParamValue {
  const spec = specs.find((p) => p.key === key);
  if (!spec) throw new Error(`${owner}: "${key}" parametresi yok`);
  const v = inst.params?.[key];
  if (spec.kind === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return spec.default;
    return Math.min(spec.max, Math.max(spec.min, v));
  }
  if (spec.kind === 'target') return typeof v === 'string' ? v : spec.default;
  return typeof v === 'string' && spec.options.some((o) => o.value === v) ? v : spec.default;
}

/** Bir spec'e bağlı kısa okuyucular: `p.num('extendMs')`, `p.str('coilVoltage')`. */
export function paramReader(spec: Pick<ComponentSpec, 'type' | 'params'>, inst: ParamHolder) {
  return {
    num: (key: string) => readParam(spec.params, inst, key, spec.type) as number,
    str: (key: string) => readParam(spec.params, inst, key, spec.type) as string,
  };
}
