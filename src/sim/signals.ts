// Bileşenlerin adlandırılmış canlı değerleri: trend grafiği ve görev senaryoları bunları okur.
// Modüller kendi `signals()` fonksiyonunu verir; çekirdek tipler burada tanımlıdır.
// Adlandırma: "<bileşen>.<sinyal>" (ör. "K1.kontak", "B1.seviye"); PLC'de adresler ("A1.%Q0.0").

import { PLC_AI, PLC_AQ, PLC_DI, PLC_DQ, type ComponentType } from './catalog';
import { moduleOf } from './modules';
import type { SignalInfo } from './modules/types';
import type { ComponentState, SimSnapshot } from './simulation';
import type { Schematic } from './schematic';

export type { SignalInfo };

const b = (label: string, value: boolean): SignalInfo => ({ label, value });
const n = (label: string, value: number, unit?: string): SignalInfo => ({ label, value, unit });

/** Bir bileşenin sinyalleri. İlk anahtar, bileşen adı tek başına yazıldığında kullanılır. */
export function componentSignals(s: ComponentState): Record<string, SignalInfo> {
  const mod = moduleOf(s.type);
  if (mod) return mod.signals?.(s) ?? {};
  switch (s.type) {
    case 'buttonNO':
    case 'buttonNC':
    case 'estop':
      return { basili: b('Basılı', s.pressed), kontak: b('Kontak kapalı', s.contactClosed) };
    case 'contactor':
    case 'relay':
      return { kontak: b('Kontaklar kapalı (çekili)', s.closed), bobin: b('Bobin enerjili', s.coilEnergized) };
    case 'lamp':
      return { yanik: b('Yanıyor', s.lit) };
    case 'motor3':
      return {
        calisiyor: b('Enerjili', s.powered),
        hiz: n('Hız', s.rpm, 'dev/dk'),
        akim: n('Akım', s.currentA, 'A'),
      };
    case 'thermal':
      return { atti: b('Attı', s.tripped), akim: n('Akım', s.currentA, 'A') };
    case 'breaker3':
      return { kapali: b('Kapalı', s.closed), atti: b('Açtı (koruma)', s.tripped), akim: n('Akım', s.currentA, 'A') };
    case 'fuse':
      return { kapali: b('Kapalı', s.closed), atti: b('Açtı', s.tripped) };
    case 'psu24':
      return { normal: b('Çıkış normal', !s.limited) };
    case 'plc': {
      const out: Record<string, SignalInfo> = { run: b('RUN', s.powered) };
      PLC_DI.forEach((t, i) => (out[`%${t}`] = b(`%${t}`, s.pii[i] ?? false)));
      PLC_DQ.forEach((t, i) => (out[`%${t}`] = b(`%${t}`, s.piq[i] ?? false)));
      PLC_AI.forEach((_, i) => (out[`%IW${i}`] = n(`%IW${i}`, s.iw[i] ?? 0)));
      PLC_AQ.forEach((_, i) => (out[`%QW${i}`] = n(`%QW${i}`, s.qw[i] ?? 0)));
      s.hsc.forEach((v, i) => v !== null && (out[`HC${i}`] = n(`HC${i}`, v)));
      s.words.slice(0, 8).forEach((v, i) => (out[`%MW${i}`] = n(`%MW${i}`, v)));
      s.timers.forEach((t, i) => t.et > 0 && (out[`T${i}`] = n(`T${i} geçen süre`, t.et, 'ms')));
      s.counters.forEach((c, i) => c.cv !== 0 && (out[`C${i}`] = n(`C${i} değeri`, c.cv)));
      return out;
    }
    case 'esp32':
      return {
        calisiyor: b('Enerjili', s.powered),
        ...Object.fromEntries(s.pins.map((p) => [p.pin, b(`${p.pin} (${p.mode === 'in' ? 'giriş' : 'çıkış'})`, p.on)])),
        adc: n('ADC1', s.adcMv / 1000, 'V'),
      };
    default:
      return {};
  }
}

export interface NamedSignal extends SignalInfo {
  /** "K1.kontak" */
  key: string;
  component: string;
}

/** Snapshot'taki tüm sinyaller, bileşen adlarıyla. */
export function allSignals(schematic: Schematic, snapshot: SimSnapshot): NamedSignal[] {
  const out: NamedSignal[] = [];
  for (const c of schematic.components) {
    const st = snapshot.components[c.id];
    if (!st) continue;
    for (const [k, info] of Object.entries(componentSignals(st))) {
      out.push({ ...info, key: `${c.name}.${k}`, component: c.id });
    }
  }
  return out;
}

/** Bileşenin hedef olarak sağladığı yetenekler ('probe', 'level', 'temperature'...). */
export function providesOf(type: ComponentType): readonly string[] {
  if (type === 'motor3') return ['revs'];
  return moduleOf(type)?.provides ?? [];
}
