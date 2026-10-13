// Bileşen modüllerinin UI tarafı: çizim geometrisi (terminal konumları), sembol gövdesi ve
// simülasyondaki etkileşim. Çekirdek modülüyle (src/sim/modules) aynı `type` ile eşleşir.

import type { ReactNode } from 'react';
import type { ComponentInstance } from '../../sim/schematic';
import type { ComponentState } from '../../sim/simulation';
import type { SymbolGeo } from '../editor/geometry';

export type SymbolInstance = Pick<ComponentInstance, 'type' | 'custom' | 'params'>;

/** Bir tipin simülasyon durumu: `StateOf<'vfd'>`. */
export type StateOf<T extends ComponentState['type']> = Extract<ComponentState, { type: T }>;

type Num<S> = number | ((s: S) => number);

/** Özellikler panelinde, simülasyon sırasında gösterilen kontrol. */
export type Control<S> = { when?: (s: S) => boolean } & (
  /** Tek tık: modül eylemi gönderir. */
  | { kind: 'button'; label: string | ((s: S) => string); action: string; value?: (s: S) => number }
  /** Basılı tut / bırak (modüle 'press' eylemi 1 / 0). */
  | { kind: 'hold'; label: string; held: (s: S) => boolean }
  /** Kaydırıcı: değer değişince modüle eylem gönderir. */
  | {
      kind: 'slider';
      label: string;
      action: string;
      min: Num<S>;
      max: Num<S>;
      step: number;
      unit?: string | ((s: S) => string);
      value: (s: S) => number;
    }
);

export interface DeviceView<S = never> {
  type: string;
  geometry: SymbolGeo;
  /** Sembol gövdesi (yerel koordinat). Durum yoksa (düzenleme, önizleme) dinlenme konumu. */
  Body(props: { inst: SymbolInstance; s: S | undefined }): ReactNode;
  /**
   * Simülasyonda gövdeye tıklama: 'hold' basılı tutma (modüle press 1/0), action ise tek tıkla
   * modül eylemi.
   */
  click?: 'hold' | { action: string; value?: (s: S) => number };
  /** Özellikler › Canlı durum altındaki kontroller (sinyal tablosuna ek olarak). */
  controls?: Control<S>[];
}

/** Tip güvenli tanım yardımcısı: durum tipi modülün state() dönüşüyle eşleşmeli. */
export function defineView<S>(v: DeviceView<S>): DeviceView<S> {
  return v;
}

/** Kayıt için tip silinmiş görünüm. */
export type AnyView = DeviceView<any>;

export const numOf = <S,>(v: Num<S>, s: S) => (typeof v === 'function' ? v(s) : v);
