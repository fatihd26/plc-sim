// Analog transmitterler (seviye, sıcaklık, basınç) ve set değeri potansiyometresi.
//
// 3 telli bağlantı: + = 24 V, − = 0 V, OUT = analog çıkış (0–10 V veya 4–20 mA). Ölçüm aralığı
// [min..max] çıkış aralığına doğrusal eşlenir; aralık dışı değer sınırlanır. PLC'de %IW ham değeri
// 0..27648'dir; mühendislik birimine SCALE komutuyla çevrilir. Hedef (ölçülen proses) seçilmezse
// değer simülasyonda kaydırıcıyla verilir.

import { choice, num, paramReader, targetParam, type ComponentSpec } from '../spec';
import { defineModule } from './types';

interface TxData {
  quantity: string;
  min: number;
  max: number;
  current: boolean;
  powered: boolean;
  /** Ölçülen değer (mühendislik birimi). */
  value: number;
  manual: number;
  hasTarget: boolean;
  frozen: number | null;
}

const txFaults = [
  { key: 'dead', label: 'Transmitter arızalı / kablo kopuk (çıkış 0)' },
  { key: 'drift', label: 'Kalibrasyon kaymış (+%10 hata)' },
  { key: 'frozen', label: 'Değer donmuş (değişmiyor)' },
];

/** Ölçüm → çıkış sinyali (0..10 V veya 4..20 mA). */
export function txOutput(d: Pick<TxData, 'min' | 'max' | 'current'>, value: number) {
  const f = Math.max(0, Math.min(1, (value - d.min) / (d.max - d.min || 1)));
  return d.current ? { kind: 'mA' as const, ma: 4 + 16 * f } : { kind: 'V' as const, v: 10 * f };
}

function txModule<T extends string>(
  type: T,
  title: string,
  description: string,
  quantity: string,
  unit: string,
  range: [number, number, number, number],
) {
  const [lo, hi, rmin, rmax] = range;
  const spec: ComponentSpec<T> = {
    type,
    title,
    prefix: 'B',
    category: 'Sensörler',
    description: `${description} Bağlantı: + 24 V, − 0 V, OUT analog çıkış.`,
    terminals: ['+', '-', 'OUT'],
    params: [
      targetParam('target', 'Ölçtüğü proses', quantity),
      num('min', 'Ölçüm alt sınırı', lo, rmin, rmax, 1, unit),
      num('max', 'Ölçüm üst sınırı', hi, rmin, rmax, 1, unit),
      choice('signal', 'Çıkış sinyali', '4-20mA', [
        ['4-20mA', '4–20 mA'],
        ['0-10V', '0–10 V'],
      ]),
    ],
  };
  return defineModule({
    spec,
    faults: txFaults,
    create: (inst): TxData => {
      const p = paramReader(spec, inst);
      return {
        quantity,
        min: p.num('min'),
        max: p.num('max'),
        current: p.str('signal') === '4-20mA',
        powered: false,
        value: lo,
        manual: lo,
        hasTarget: !!p.str('target'),
        frozen: null,
      };
    },
    drive: (d, out) => {
      if (out.potential('+') !== 'P24' || out.potential('-') !== 'M0' || out.fault('dead')) {
        // Enerjisiz veya kopuk 4–20 mA döngüsü: akım yok (PLC kablo kopukluğu görür).
        if (d.current) out.drive('OUT', { kind: 'mA', ma: 0 });
        return;
      }
      const v = d.frozen ?? (out.fault('drift') ? d.value + 0.1 * (d.max - d.min) : d.value);
      out.drive('OUT', txOutput(d, v));
    },
    update: (d, io) => {
      d.powered = io.powered24('+', '-');
      const target = io.target('target');
      d.hasTarget = !!target;
      d.value = target ? (target.measure(d.quantity) ?? d.min) : d.manual;
      d.frozen = io.fault('frozen') ? (d.frozen ?? d.value) : null;
    },
    command: (d, action, value) => {
      if (action === 'set' && value !== undefined) d.manual = value;
    },
    state: (d) => {
      const o = txOutput(d, d.value);
      return {
        type,
        powered: d.powered,
        value: d.value,
        unit,
        min: d.min,
        max: d.max,
        output: o.kind === 'mA' ? o.ma : o.v,
        outputUnit: o.kind === 'mA' ? 'mA' : 'V',
        hasTarget: d.hasTarget,
      };
    },
    signals: (s) => ({
      deger: { label: 'Ölçülen değer', value: s.value, unit: s.unit },
      cikis: { label: 'Analog çıkış', value: s.powered ? s.output : 0, unit: s.outputUnit },
    }),
  });
}

export const levelTxModule = txModule(
  'levelTx',
  'Seviye transmitteri (ultrasonik)',
  'Tank seviyesini ölçer.',
  'level',
  '%',
  [0, 100, 0, 100],
);

export const tempTxModule = txModule(
  'tempTx',
  'Sıcaklık transmitteri (PT100)',
  'PT100 sensör + transmitter; fırın veya yağ sıcaklığını ölçer.',
  'temperature',
  '°C',
  [0, 400, -50, 1200],
);

export const pressureTxModule = txModule(
  'pressureTx',
  'Basınç transmitteri',
  'Hidrolik / pnömatik hat basıncını ölçer.',
  'pressure',
  'bar',
  [0, 250, 0, 1000],
);

// --- Potansiyometre -------------------------------------------------------------------------

const potSpec = {
  type: 'potentiometer' as const,
  title: 'Potansiyometre (set değeri)',
  prefix: 'R',
  category: 'Komuta' as const,
  description: 'Panodaki ayar düğmesi: OUT ucunda 0–10 V verir (+ 24 V, − 0 V). PLC analog girişine set değeri olarak bağlanır.',
  terminals: ['+', '-', 'OUT'],
  params: [num('initialPct', 'Başlangıç konumu', 50, 0, 100, 1, '%')],
};

export const potentiometerModule = defineModule({
  spec: potSpec,
  create: (inst) => ({ pct: paramReader(potSpec, inst).num('initialPct'), powered: false }),
  drive: (d, out) => {
    if (out.potential('+') === 'P24' && out.potential('-') === 'M0') out.drive('OUT', { kind: 'V', v: d.pct / 10 });
  },
  update: (d, io) => {
    d.powered = io.powered24('+', '-');
  },
  command: (d, action, value) => {
    if (action === 'set' && value !== undefined) d.pct = Math.max(0, Math.min(100, value));
  },
  state: (d) => ({ type: 'potentiometer' as const, pct: d.pct, volts: d.powered ? d.pct / 10 : 0, powered: d.powered }),
  signals: (s) => ({
    konum: { label: 'Düğme konumu', value: s.pct, unit: '%' },
    cikis: { label: 'Çıkış', value: s.volts, unit: 'V' },
  }),
});
