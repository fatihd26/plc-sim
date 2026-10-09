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
}

/**
 * 3~ asenkron motor, mekanik/elektriksel olarak basitleştirilmiş.
 * Hız birinci dereceden yaklaşır; akım kaymaya göre kalkış akımından nominale iner.
 * Faz sırası dönüş yönünü belirler (direction = +1 / −1).
 */
export class Motor {
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
    },
  ) {}

  update(powered: boolean, dtMs: number, direction: 1 | -1 = 1): void {
    const p = this.params;
    this.powered = powered;
    if (powered) this.direction = direction;
    const target = powered ? direction : 0;
    const tau = powered ? p.startTauMs : p.coastTauMs;
    this.speed += ((target - this.speed) * dtMs) / tau;
    if (!powered && Math.abs(this.speed) < 1e-4) this.speed = 0;

    // Kayma: 0 (senkron) .. 1 (duruş) .. 2 (ters yönde dönerken frenleme); akım 1'de doyar.
    const slip = Math.min(1, Math.max(0, 1 - this.speed * direction));
    this.currentA = powered ? p.ratedCurrentA * (1 + (p.lockedRotorRatio - 1) * slip) : 0;

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
