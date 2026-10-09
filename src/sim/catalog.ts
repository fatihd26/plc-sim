// Bileşen kütüphanesi (elektriksel taraf): her tipin terminalleri ve etiket öneki.
// Çizim geometrisi UI katmanındadır; terminal adları iki taraf arasındaki sözleşmedir.

export type ComponentType =
  | 'mains3'
  | 'psu24'
  | 'buttonNO'
  | 'buttonNC'
  | 'estop'
  | 'contactor'
  | 'breaker3'
  | 'thermal'
  | 'motor3'
  | 'lamp'
  | 'plc'
  | 'terminal';

export type Category = 'Kaynaklar' | 'Komuta' | 'Şalt' | 'Koruma' | 'Tüketiciler' | 'Sinyal' | 'Kontrol' | 'Bağlantı';

export const CATEGORIES: readonly Category[] = [
  'Kaynaklar',
  'Komuta',
  'Şalt',
  'Koruma',
  'Tüketiciler',
  'Sinyal',
  'Kontrol',
  'Bağlantı',
];

export interface ComponentSpec {
  type: ComponentType;
  title: string;
  /** IEC 81346 benzeri etiket öneki (K1, S1, M1...). */
  prefix: string;
  /** Kütüphanede gösterilen kısa açıklama. */
  description: string;
  category: Category;
  terminals: readonly string[];
}

export const PLC_DI = ['I0.0', 'I0.1', 'I0.2', 'I0.3', 'I0.4', 'I0.5', 'I0.6', 'I0.7'] as const;
export const PLC_DQ = ['Q0.0', 'Q0.1', 'Q0.2', 'Q0.3', 'Q0.4', 'Q0.5', 'Q0.6', 'Q0.7'] as const;

export const CATALOG: Record<ComponentType, ComponentSpec> = {
  mains3: {
    type: 'mains3',
    title: 'Şebeke 3~ 400 V',
    prefix: 'X',
    category: 'Kaynaklar',
    description: 'L1-L2-L3 faz beslemesi (sağ dönüş sırası)',
    terminals: ['L1', 'L2', 'L3'],
  },
  psu24: {
    type: 'psu24',
    title: 'Güç kaynağı 24 V DC',
    prefix: 'G',
    category: 'Kaynaklar',
    description: 'Kumanda beslemesi: L+ = +24 V, M = 0 V',
    terminals: ['L+', 'M'],
  },
  buttonNO: {
    type: 'buttonNO',
    title: 'Buton (NO)',
    prefix: 'S',
    category: 'Komuta',
    description: 'Yaylı, basılıyken kapanan kontak (13-14)',
    terminals: ['13', '14'],
  },
  buttonNC: {
    type: 'buttonNC',
    title: 'Buton (NC)',
    prefix: 'S',
    category: 'Komuta',
    description: 'Yaylı, basılıyken açılan kontak (11-12)',
    terminals: ['11', '12'],
  },
  estop: {
    type: 'estop',
    title: 'Acil stop',
    prefix: 'S',
    category: 'Komuta',
    description: 'Mantar başlı, kilitlemeli NC kontak (11-12)',
    terminals: ['11', '12'],
  },
  contactor: {
    type: 'contactor',
    title: 'Kontaktör 24 V DC',
    prefix: 'K',
    category: 'Şalt',
    description: '3 ana kontak, 13-14 NO, 21-22 NC, bobin A1-A2',
    terminals: ['1', '2', '3', '4', '5', '6', '13', '14', '21', '22', 'A1', 'A2'],
  },
  breaker3: {
    type: 'breaker3',
    title: 'Motor koruma şalteri',
    prefix: 'Q',
    category: 'Koruma',
    description: '3 kutuplu, elle açılıp kapatılan güç şalteri',
    terminals: ['1', '2', '3', '4', '5', '6'],
  },
  thermal: {
    type: 'thermal',
    title: 'Termik röle',
    prefix: 'F',
    category: 'Koruma',
    description: 'Aşırı akım koruması, 95-96 NC / 97-98 NO',
    terminals: ['1', '2', '3', '4', '5', '6', '95', '96', '97', '98'],
  },
  motor3: {
    type: 'motor3',
    title: 'Asenkron motor 3~',
    prefix: 'M',
    category: 'Tüketiciler',
    description: '4 A nominal, faz sırası dönüş yönünü belirler',
    terminals: ['U', 'V', 'W'],
  },
  lamp: {
    type: 'lamp',
    title: 'Sinyal lambası 24 V',
    prefix: 'P',
    category: 'Sinyal',
    description: 'X1-X2 arasında 24 V DC varken yanar',
    terminals: ['X1', 'X2'],
  },
  plc: {
    type: 'plc',
    title: 'PLC (8 DI / 8 DQ)',
    prefix: 'A',
    category: 'Kontrol',
    description: '24 V DC giriş/çıkış, start-stop programı yüklü',
    terminals: ['L+', 'M', ...PLC_DI, ...PLC_DQ],
  },
  terminal: {
    type: 'terminal',
    title: 'Klemens',
    prefix: 'X',
    category: 'Bağlantı',
    description: 'Geçiş klemensi: 1 ve 2 her zaman bağlı',
    terminals: ['1', '2'],
  },
};

export const COMPONENT_TYPES = Object.keys(CATALOG) as ComponentType[];
