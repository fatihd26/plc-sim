// Modüllerin ortak tahrik yardımcıları: 3~ motor (şebeke veya VFD'den), 24 V beslemeli cihaz.

import { Motor } from '../devices';
import type { ModuleIo } from './types';

/** Nominal frekans: VFD çıkışı bu frekansta motor nominal hızda döner. */
export const NOMINAL_HZ = 50;

/** VFD'den beslenen motorun akım sınırı (In katı). */
export const VFD_CURRENT_LIMIT = 1.5;

type Reader = { num(key: string): number };

/** Katalogdaki driveParams'tan motor. */
export function motorFromParams(p: Reader, loadPct = 100): Motor {
  return new Motor({
    ratedCurrentA: p.num('ratedCurrentA'),
    ratedRpm: p.num('ratedRpm'),
    startTauMs: p.num('startTauMs'),
    coastTauMs: p.num('coastTauMs'),
    lockedRotorRatio: p.num('lockedRotorRatio'),
    loadPct,
  });
}

/**
 * U-V-W terminalli 3~ motoru bir tick ilerletir: üç farklı faz gerekir, faz sırası yönü belirler,
 * VFD çıkışında hız frekansla orantılıdır. `locked`: mil sıkışmış.
 */
export function stepMotor3(
  motor: Motor,
  io: ModuleIo,
  dtMs: number,
  opts: { terminals?: readonly [string, string, string]; locked?: boolean; currentScale?: number; tauScale?: number } = {},
): void {
  const [u, v, w] = opts.terminals ?? ['U', 'V', 'W'];
  const tp = io.threePhase(u, v, w);
  const vfd = tp.powered && tp.hz !== null;
  motor.update(tp.powered, dtMs, tp.powered ? tp.direction : motor.direction, {
    ratio: vfd ? tp.hz! / NOMINAL_HZ : 1,
    locked: opts.locked,
    currentLimit: vfd ? VFD_CURRENT_LIMIT : undefined,
    currentScale: opts.currentScale,
    tauScale: opts.tauScale,
  });
}

/** Motor durumunun UI'ya giden ortak alanları. */
export const motorFields = (m: Motor) => ({
  powered: m.powered,
  speed: m.speed,
  rpm: m.rpm,
  currentA: m.currentA,
  angleDeg: m.angleDeg,
  direction: m.direction,
});
