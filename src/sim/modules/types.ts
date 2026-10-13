// Bileşen modülü sözleşmesi.
//
// Yeni bir bileşen (sensör, mekanizma, sürücü, proses...) tek bir dosyada `defineModule` ile
// tanımlanır ve modules/index.ts'teki listeye eklenir. Çekirdek (simulation.ts) bileşen tipini
// bilmez; modülün kancalarını sabit bir faz sırasıyla çağırır:
//
//   tick:  komutlar → command()
//          elektrik çözümü  → links()      (kontaklar ve kaynaklar; önceki tick'in durumuyla)
//          sinyal sürme     → drive()      (analog 0-10 V / 4-20 mA, enkoder darbesi, VFD frekansı)
//          PLC scan'leri
//          elektrik çözümü + sinyal sürme (PLC çıkışları güncel)
//          akışkan çözümü   → fluidLinks() ve hidrolik debi paylaşımı → hydraulic()
//          güncelleme       → update()     (bobinler, motorlar, mekanik ve proses modelleri)
//          termik elemanlar → lineCurrent()
//   snapshot: state()       (UI'nın gördüğü salt-okunur durum)
//
// Kurallar: modül kodu deterministik olmalı (purity.test.ts), yalnız kendi verisini değiştirmeli;
// başka bileşenlere `io.target()` üzerinden salt-okunur erişir.

import type { NetPotential, Potential } from '../netlist';
import type { ModbusDataModel } from '../modbus';
import type { ComponentInstance } from '../schematic';
import type { ComponentSpec, Voltage } from '../spec';

/** Yükün (bobin/lamba) gördüğü besleme. */
export type Supply = 'DC24' | 'AC230' | 'AC400' | null;

/**
 * Bir netin taşıdığı sinyal (dijital potansiyelin yanında). Ortak referans (M / 0 V) her zaman
 * bağlı kabul edilir; analog devrede ayrı referans kablosu çözülmez.
 */
export type Signal =
  /** Gerilim çıkışı, 0..10 V. */
  | { kind: 'V'; v: number }
  /** Akım çıkışı, 4..20 mA (0 = kablo kopuk / cihaz enerjisiz). */
  | { kind: 'mA'; ma: number }
  /** Enkoder kanalı: toplam darbe sayısı (işaretli). `src` aynı enkoderin A/B kanallarını eşler. */
  | { kind: 'pulse'; pos: number; src: string }
  /** Frekans konvertörü çıkışı: motor beslemesinin frekansı [Hz]. */
  | { kind: 'drive'; hz: number };

/** Akışkan netinin durumu: P = basınçlı hat, T = tahliye (pnömatikte atmosfer, hidrolikte tank). */
export type FluidPotential = 'P' | 'T';
export type FluidNet = FluidPotential | 'short' | null;

/** Algılama türü: yalnız metal (endüktif) veya her nesne (kapasitif, optik, mekanik). */
export type Material = 'metal' | 'any';

export interface FaultSpec {
  key: string;
  label: string;
}

/** Trend grafiği ve görev senaryoları için adlandırılmış canlı değer. */
export interface SignalInfo {
  label: string;
  value: number | boolean;
  unit?: string;
}

// --- Fazlara verilen arayüzler ------------------------------------------------------------

interface Faults {
  /** Bu bileşende etkin arıza var mı (arıza enjeksiyonu). */
  fault(key: string): boolean;
}

export interface LinkApi extends Faults {
  /** İki terminali iletken olarak bağlar (kapalı kontak, köprü). */
  link(a: string, b: string): void;
  /** Terminale potansiyel verir (güç kaynağı, PNP sensör çıkışı). */
  source(terminal: string, p: Potential): void;
}

export interface DriveApi extends Faults {
  drive(terminal: string, signal: Signal): void;
  /** Kendi besleme durumunu okumak için (son elektrik çözümü). */
  potential(terminal: string): NetPotential;
}

export interface FluidLinkApi extends Faults {
  link(a: string, b: string): void;
  source(terminal: string, p: FluidPotential): void;
  /** Akışı kısar (kısma valfi): bu netten tahliye olan aktüatörün hızı `factor` ile çarpılır. */
  restrict(terminal: string, factor: number): void;
}

/** Başka bir bileşene salt-okunur erişim (sensör hedefi, transmitter prosesi). */
export interface TargetView {
  name: string;
  type: string;
  /** Konum algılama: `at` (0..1) noktasında algılanacak bir nesne var mı. */
  probe(at: number, material: Material): boolean | null;
  /** Ölçülen büyüklük (seviye %, sıcaklık °C, basınç bar, konum mm, devir...). */
  measure(quantity: string): number | null;
}

export interface ModuleIo extends Faults {
  readonly tick: number;
  potential(terminal: string): NetPotential;
  /** İki terminal aynı elektrik netinde mi (ör. yıldız köprüsü). */
  sameNet(a: string, b: string): boolean;
  supply(a: string, b: string): Supply;
  /** 24 V DC sinyal girişi: uç +24 V'ta mı (PLC girişi gibi; yük sayılmaz). */
  high(terminal: string): boolean;
  /** 24 V DC beslemeli cihaz (sensör, sürücü elektroniği): a = +24 V, b = 0 V. */
  powered24(plus: string, minus: string): boolean;
  /**
   * Yük (bobin, lamba, valf, ısıtıcı) beslemesi: anma geriliminde çalışır, aşırı gerilimde arıza.
   * Ucu PLC/ESP32 çıkış netinde olan yük çalışmaz ve arıza verir (araya röle konmalıdır).
   */
  load(rating: Voltage, a: string, b: string): { on: boolean; fault: string | null };
  /** 3~ motor sargıları: üç farklı faz var mı, faz sırasına göre yön, VFD'den besleniyorsa frekans. */
  threePhase(u: string, v: string, w: string): { powered: boolean; direction: 1 | -1; hz: number | null };
  signal(terminal: string): Signal | null;
  fluid(terminal: string): FluidNet;
  /** Terminale (kopuk olmayan) bir kablo/hortum bağlı mı. Bağlantısız pnömatik port atmosfere açıktır. */
  wired(terminal: string): boolean;
  /** Netteki en kısıtlayıcı kısma valfi (1 = kısıtsız). */
  restriction(terminal: string): number;
  /** Parametresi verilen hedef bileşen (yoksa veya adı boşsa null). */
  target(param: string): TargetView | null;
  event(text: string): void;
}

/** Hidrolik pompa (güç ünitesi) çıkışı. */
export interface HydraulicSupply {
  /** Basınç portu. */
  port: string;
  /** Anlık debi [l/dk]. */
  flowLpm: number;
  /** Emniyet valfi açma basıncı [bar]. */
  reliefBar: number;
}

/** Hareket etmek isteyen hidrolik aktüatör odası. */
export interface HydraulicDemand {
  /** Talep kimliği (aynı modül içinde, ör. "boom+"). */
  id: string;
  /** Basınç alan port (P netinde olmalı) ve tahliye eden port (T netinde olmalı). */
  inlet: string;
  outlet: string;
  /** Hareket için gereken basınç [bar] (yük / alan). */
  pressureBar: number;
  /** Tam hızda harcanan debi [l/dk] (alan × en yüksek hız). */
  maxFlowLpm: number;
}

export interface HydraulicResult {
  /** Talebe verilen debi [l/dk]; 0 = hareket yok. */
  grants: Record<string, number>;
  /** Talep portunun bağlı olduğu pompanın sistem basıncı [bar]. */
  pressure: Record<string, number>;
}

// --- Modül tanımı -------------------------------------------------------------------------

export interface DeviceModule<T extends string = string, D = unknown, S extends { type: T } = { type: T }> {
  spec: ComponentSpec<T>;
  /** Enjekte edilebilecek arızalar. */
  faults?: readonly FaultSpec[];
  /** Simülasyon kurulurken bir kez: cihaz verisini oluşturur. */
  create(inst: ComponentInstance): D;
  links?(d: D, api: LinkApi): void;
  drive?(d: D, api: DriveApi): void;
  fluidLinks?(d: D, api: FluidLinkApi): void;
  /** Hidrolik pompa: basınç portu ve debi. */
  hydraulicSupply?(d: D): HydraulicSupply | null;
  /** Hidrolik aktüatör: hareket talepleri (io ile port durumlarını okur). */
  hydraulicDemands?(d: D, io: ModuleIo): HydraulicDemand[];
  update?(d: D, io: ModuleIo, dtMs: number, hydraulic: HydraulicResult): void;
  /** Termik/şalter akım ölçümü: bu terminallerden geçen hat akımı. */
  lineCurrent?(d: D): { terminals: readonly string[]; currentA: number } | null;
  /** RS485 uçları ve (varsa) Modbus slave belleği. */
  modbus?(d: D): { a: string; b: string; unit: number; baud: number; model: ModbusDataModel; powered: boolean };
  /** Konum algılama ve ölçüm (sensör/transmitter hedefi olabilmek için). */
  probe?(d: D, at: number, material: Material): boolean;
  measure?(d: D, quantity: string): number | null;
  /** Ölçülebilen büyüklükler (UI'da hedef seçerken filtre için: 'probe', 'level', 'temperature'...). */
  provides?: readonly string[];
  /** Simülasyonda kullanıcı eylemi (UI düğmesi, görev senaryosu). */
  command?(d: D, action: string, value: number | undefined, io: Pick<ModuleIo, 'event'>): void;
  state(d: D): S;
  /** Trend ve görev senaryosu için canlı değerler (snapshot durumundan). */
  signals?(s: S): Record<string, SignalInfo>;
}

/** Tip çıkarımını koruyarak modül tanımlar. */
export function defineModule<T extends string, D, S extends { type: T }>(m: DeviceModule<T, D, S>): DeviceModule<T, D, S> {
  return m;
}
