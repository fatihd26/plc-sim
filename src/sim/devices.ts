// Saha cihazlarının basitleştirilmiş davranış modelleri.
// Elektrik çözücü yok: her cihaz durumunu sabit dt ile ilerletir.
// Determinizm için yalnız + − × ÷ kullanılır (Math.exp vb. yok).

export type ButtonContact = 'NO' | 'NC';

export class PushButton {
  pressed = false;

  constructor(readonly contact: ButtonContact) {}

  /** Butonun kontağı iletimde mi (NO: basılıyken, NC: bırakılmışken). */
  get contactClosed(): boolean {
    return this.contact === 'NO' ? this.pressed : !this.pressed;
  }
}

export interface ContactorParams {
  /** Bobin enerjilendikten sonra kontakların kapanma gecikmesi. */
  pickupMs: number;
  /** Bobin enerjisi kesildikten sonra kontakların açılma gecikmesi. */
  dropoutMs: number;
}

export class Contactor {
  coilEnergized = false;
  /** Ana ve NO yardımcı kontakların durumu. */
  closed = false;
  private pendingMs = 0;

  constructor(readonly params: ContactorParams = { pickupMs: 20, dropoutMs: 15 }) {}

  update(coilEnergized: boolean, dtMs: number): void {
    this.coilEnergized = coilEnergized;
    if (coilEnergized === this.closed) {
      // Hedef durumdayız; yarım kalmış bir geçiş iptal olur.
      this.pendingMs = 0;
      return;
    }
    this.pendingMs += dtMs;
    const delay = coilEnergized ? this.params.pickupMs : this.params.dropoutMs;
    if (this.pendingMs >= delay) {
      this.closed = coilEnergized;
      this.pendingMs = 0;
    }
  }
}

export interface ThermalRelayParams {
  /** Ayar akımı Ir [A]. */
  setCurrentA: number;
  /** Isıl zaman sabiti [ms]. */
  tauMs: number;
}

/**
 * Termik aşırı akım rölesi: birinci dereceden I² ısınma modeli.
 *   dθ/dt = ((I/Ir)² − θ) / τ
 * θ = 1, Ir'de kalıcı ısınma. θ ≥ TRIP_THETA ise açar (≈1.1·Ir sürekli akım sınırı).
 * τ = 300 s ile 7.2·Ir'de soğuk açma ≈ 7 s (Class 10 bandı: 4–10 s).
 */
export class ThermalRelay {
  static readonly TRIP_THETA = 1.21;
  /** Bu değerin altına soğumadan reset kabul edilmez. */
  static readonly RESET_THETA = 1.0;

  theta = 0;
  tripped = false;

  constructor(readonly params: ThermalRelayParams = { setCurrentA: 4, tauMs: 300_000 }) {}

  update(currentA: number, dtMs: number): void {
    const ratio = currentA / this.params.setCurrentA;
    this.theta += ((ratio * ratio - this.theta) * dtMs) / this.params.tauMs;
    if (this.theta >= ThermalRelay.TRIP_THETA) this.tripped = true;
  }

  /** Test butonu: mekanizmayı elle açtırır. */
  test(): void {
    this.tripped = true;
  }

  /** Manuel reset. Röle yeterince soğumadıysa reddedilir. */
  reset(): boolean {
    if (this.theta >= ThermalRelay.RESET_THETA) return false;
    this.tripped = false;
    return true;
  }

  /** 95-96 NC yardımcı kontak. */
  get ncClosed(): boolean {
    return !this.tripped;
  }
}

export interface MotorParams {
  ratedCurrentA: number;
  ratedRpm: number;
  /** Kalkış hız zaman sabiti [ms]. */
  startTauMs: number;
  /** Serbest duruş (yavaşlama) zaman sabiti [ms]. */
  coastTauMs: number;
  /** Kilitli rotor akımı / nominal akım. */
  lockedRotorRatio: number;
  /** Mil yükü, nominal yüke oranla [%]; kalıcı akımı belirler. */
  loadPct: number;
}

/**
 * 3~ asenkron motor, mekanik/elektriksel olarak basitleştirilmiş.
 * Hız birinci dereceden yaklaşır; akım kaymaya göre kalkış akımından nominale iner.
 * Faz sırası dönüş yönünü belirler (direction = +1 / −1).
 */
export interface MotorDriveOptions {
  ratio?: number;
  locked?: boolean;
  currentLimit?: number;
  currentScale?: number;
  tauScale?: number;
}

export class Motor {
  /** Toplam mil devri (işaretli; enkoder için). */
  revs = 0;
  /** Nominal hıza oranla işaretli hız, −1..1. */
  speed = 0;
  currentA = 0;
  powered = false;
  direction: 1 | -1 = 1;
  /** Animasyon için mil açısı [derece], 0..360. */
  angleDeg = 0;

  constructor(
    readonly params: MotorParams = {
      ratedCurrentA: 4,
      ratedRpm: 1450,
      startTauMs: 400,
      coastTauMs: 1500,
      lockedRotorRatio: 6,
      loadPct: 100,
    },
  ) {}

  /**
   * `opts.ratio`: besleme frekansının nominale oranı (VFD; şebekede 1). `opts.locked`: mil
   * sıkışmış (arıza veya fren kapalı). `opts.currentLimit`: akım sınırı, In katı (VFD).
   * `opts.currentScale`: akım çarpanı (ör. yıldız bağlantıda 1/3). `opts.tauScale`: kalkış
   * zaman sabiti çarpanı (yıldızda düşük moment → yavaş kalkış).
   */
  update(powered: boolean, dtMs: number, direction: 1 | -1 = 1, opts: MotorDriveOptions = {}): void {
    const p = this.params;
    const ratio = opts.ratio ?? 1;
    this.powered = powered;
    if (powered) this.direction = direction;
    if (opts.locked) {
      this.speed = 0;
    } else {
      const target = powered ? direction * ratio : 0;
      const tau = powered ? p.startTauMs * (opts.tauScale ?? 1) : p.coastTauMs;
      this.speed += ((target - this.speed) * dtMs) / tau;
      if (!powered && Math.abs(this.speed) < 1e-4) this.speed = 0;
    }

    // Kayma: 0 (senkron) .. 1 (duruş) .. 2 (ters yönde dönerken frenleme); akım 1'de doyar.
    // Kalıcı akım yükle orantılı (basitleştirme), duruşta kilitli rotor akımı.
    const slip = ratio > 0 ? Math.min(1, Math.max(0, 1 - (this.speed * direction) / ratio)) : 1;
    const load = p.loadPct / 100;
    let current = powered ? p.ratedCurrentA * (load + (p.lockedRotorRatio - load) * slip) : 0;
    current *= opts.currentScale ?? 1;
    if (opts.currentLimit !== undefined) current = Math.min(current, p.ratedCurrentA * opts.currentLimit);
    this.currentA = current;
    this.revs += (this.speed * p.ratedRpm * dtMs) / 60_000;

    const degPerMs = (this.speed * p.ratedRpm * 360) / 60_000;
    this.angleDeg = (((this.angleDeg + degPerMs * dtMs) % 360) + 360) % 360;
  }

  get rpm(): number {
    return this.speed * this.params.ratedRpm;
  }

  get running(): boolean {
    return this.speed !== 0;
  }
}

// --- Mekanik elemanlar ---------------------------------------------------------------------

export interface CylinderParams {
  /** Tam stroku ileri gitme süresi [ms]. */
  extendMs: number;
  /** Tam stroku geri dönme süresi [ms]. */
  retractMs: number;
}

/**
 * Çift etkili pnömatik silindir, 5/2 yaylı (monostabil) valfle sürülür.
 * Valf bobini enerjiliyken piston sabit hızla ileri, değilse geri gider.
 * Uç sensörleri (reed) stroğun son SENSOR_BAND kadarlık kısmında algılar.
 */
export class Cylinder {
  static readonly SENSOR_BAND = 0.03;

  /** Piston konumu: 0 = tam geride, 1 = tam ileride. */
  position = 0;
  valve = false;

  constructor(readonly params: CylinderParams = { extendMs: 1000, retractMs: 1000 }) {}

  update(valve: boolean, dtMs: number): void {
    this.valve = valve;
    if (valve) this.position = Math.min(1, this.position + dtMs / this.params.extendMs);
    else this.position = Math.max(0, this.position - dtMs / this.params.retractMs);
  }

  get retracted(): boolean {
    return this.position <= Cylinder.SENSOR_BAND;
  }

  get extended(): boolean {
    return this.position >= 1 - Cylinder.SENSOR_BAND;
  }
}

export interface ConveyorParams {
  /** Nominal hızda bir noktanın bandın başından sonuna gitme süresi [ms]. */
  transitMs: number;
  /** Otomatik kutu besleme aralığı [ms]; 0 = kapalı. */
  feedMs: number;
  /** Kutu malzemesi: karton, metal veya sırayla karışık. */
  material?: 'cardboard' | 'metal' | 'mixed';
}

/**
 * Konveyör bant: kutular bant hızıyla birlikte hareket eder. Konumlar bant uzunluğuna oranlıdır
 * (0 = baş, 1 = son). Ağırlık merkezi bant ucunu geçen kutu düşer; sondan düşenler "teslim" sayılır.
 */
export class Conveyor {
  /** Kutu boyu (bant uzunluğuna oranla). */
  static readonly BOX = 0.12;
  /** Kutular arasında bırakılan en küçük boşluk. */
  static readonly GAP = 0.04;
  /** Fotoselin bant üzerindeki konumu. */
  static readonly SENSOR = 0.76;

  /** Kutuların sol kenar konumları. */
  boxes: number[] = [];
  /** Kutu başına: metal mi (endüktif sensör yalnız metali algılar). */
  metal: boolean[] = [];
  private fed = 0;
  /** Bant yüzeyinin toplam yer değiştirmesi (animasyon için), 0..1. */
  beltPos = 0;
  /** Bandın sonundan düşen kutu sayısı. */
  delivered = 0;
  private feedTimerMs = 0;

  constructor(readonly params: ConveyorParams = { transitMs: 6000, feedMs: 4000 }) {}

  /** speed: tahrik motorunun nominal hıza oranla işaretli hızı (−1..1). */
  update(speed: number, dtMs: number): void {
    const dx = (speed * dtMs) / this.params.transitMs;
    this.beltPos = (((this.beltPos + dx) % 1) + 1) % 1;
    if (dx !== 0) {
      const kept: number[] = [];
      const metal: boolean[] = [];
      this.boxes.forEach((p, i) => {
        const q = p + dx;
        const center = q + Conveyor.BOX / 2;
        if (center > 1) this.delivered++;
        else if (center >= 0) {
          kept.push(q);
          metal.push(this.metal[i] ?? false);
        }
      });
      this.boxes = kept;
      this.metal = metal;
    }
    if (this.params.feedMs > 0) {
      this.feedTimerMs += dtMs;
      if (this.feedTimerMs >= this.params.feedMs && this.addBox()) this.feedTimerMs = 0;
    }
  }

  /** Bandın başına kutu koyar; başta yer yoksa reddedilir. */
  addBox(): boolean {
    if (this.boxes.some((p) => p < Conveyor.BOX + Conveyor.GAP)) return false;
    const m = this.params.material ?? 'cardboard';
    this.boxes.push(0);
    this.metal.push(m === 'metal' || (m === 'mixed' && this.fed % 2 === 1));
    this.fed++;
    return true;
  }

  /** `at` (0..1) noktasında kutu var mı; `metalOnly`: yalnız metal kutular. */
  boxAt(at: number, metalOnly = false): boolean {
    return this.boxes.some((p, i) => p <= at && p + Conveyor.BOX >= at && (!metalOnly || this.metal[i]));
  }

  /** Fotosel: ışın bir kutu tarafından kesiliyor mu. */
  get sensorBlocked(): boolean {
    return this.boxAt(Conveyor.SENSOR);
  }
}

export interface TankParams {
  /** Nominal pompa hızında boş depoyu doldurma süresi [ms]. */
  fillMs: number;
  /** Tüketimle dolu deponun boşalma süresi [ms]; 0 = tüketim yok. */
  drainMs: number;
  /** Başlangıç seviyesi, 0..1. */
  initialLevel: number;
}

/** Su deposu: pompa doldurur, tüketim sabit debiyle boşaltır. Dolu depoya basılan su taşar. */
export class Tank {
  static readonly LOW = 0.2;
  static readonly HIGH = 0.8;

  level: number;
  /** Depo dolu ve pompa hâlâ basıyor. */
  overflowing = false;

  constructor(readonly params: TankParams = { fillMs: 20_000, drainMs: 40_000, initialLevel: 0.1 }) {
    this.level = Math.min(1, Math.max(0, params.initialLevel));
  }

  /** flow: pompanın nominal debiye oranla debisi (0..1). */
  update(flow: number, dtMs: number): void {
    const inflow = (flow * dtMs) / this.params.fillMs;
    const outflow = this.params.drainMs > 0 ? dtMs / this.params.drainMs : 0;
    const next = this.level + inflow - outflow;
    this.overflowing = next > 1 && inflow > 0;
    this.level = Math.min(1, Math.max(0, next));
  }

  /** Alt seviye sensörü ıslak (su seviyesi sensöre ulaştı). */
  get lowWet(): boolean {
    return this.level >= Tank.LOW;
  }

  get highWet(): boolean {
    return this.level >= Tank.HIGH;
  }
}
