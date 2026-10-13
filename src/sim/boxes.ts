// Ladder kutu komutları: taşıma, aritmetik, ölçekleme ve PID.
// Her komut bildirimsel olarak tanımlanır (girişler, varsayılanlar, açıklama); editör formu ve
// ladder çizimi bu tablodan üretilir. Yeni bir kutu komutu eklemek için BOX_SPECS'e bir satır
// ve `evalBox` içine hesabını eklemek yeterlidir.
//
// Ortak davranış: rung enerjiliyken (EN) her scan'de hesaplanır ve sonuç çıkış adresine (OUT:
// %MW veya %QW) yazılır; ENO = EN (sıfıra bölmede ENO = 0, çıkış yazılmaz). Rung enerjisizken
// çıkış değişmez.

export type BoxType = 'MOVE' | 'ADD' | 'SUB' | 'MUL' | 'DIV' | 'SCALE' | 'PID';

export const BOX_TYPES: BoxType[] = ['MOVE', 'ADD', 'SUB', 'MUL', 'DIV', 'SCALE', 'PID'];
export const isBox = (t: string | undefined): t is BoxType => BOX_TYPES.includes(t as BoxType);

export interface BoxArg {
  key: string;
  label: string;
  /** Yeni komutta önerilen değer. */
  default: string;
}

export interface BoxSpec {
  type: BoxType;
  title: string;
  description: string;
  args: BoxArg[];
  /** Yeni komutta önerilen çıkış adresi. */
  defaultOut: string;
}

const arg = (key: string, label: string, def: string): BoxArg => ({ key, label, default: def });

export const BOX_SPECS: Record<BoxType, BoxSpec> = {
  MOVE: {
    type: 'MOVE',
    title: 'Taşı (MOVE)',
    description: 'OUT = IN. Sabit, kelime, analog giriş, zamanlayıcı/sayıcı değeri veya HC taşınabilir.',
    args: [arg('IN', 'IN – kaynak', '0')],
    defaultOut: '%MW0',
  },
  ADD: {
    type: 'ADD',
    title: 'Topla (ADD)',
    description: 'OUT = IN1 + IN2',
    args: [arg('IN1', 'IN1', '%MW0'), arg('IN2', 'IN2', '1')],
    defaultOut: '%MW0',
  },
  SUB: {
    type: 'SUB',
    title: 'Çıkar (SUB)',
    description: 'OUT = IN1 − IN2 (%MW işaretsizdir; negatif sonuç 0 olur)',
    args: [arg('IN1', 'IN1', '%MW0'), arg('IN2', 'IN2', '1')],
    defaultOut: '%MW0',
  },
  MUL: {
    type: 'MUL',
    title: 'Çarp (MUL)',
    description: 'OUT = IN1 × IN2 (tamsayıya yuvarlanır)',
    args: [arg('IN1', 'IN1', '%MW0'), arg('IN2', 'IN2', '2')],
    defaultOut: '%MW1',
  },
  DIV: {
    type: 'DIV',
    title: 'Böl (DIV)',
    description: 'OUT = IN1 ÷ IN2 (tamsayı bölme, kesir atılır). IN2 = 0 ise ENO = 0.',
    args: [arg('IN1', 'IN1', '%MW0'), arg('IN2', 'IN2', '2')],
    defaultOut: '%MW1',
  },
  SCALE: {
    type: 'SCALE',
    title: 'Ölçekle (SCALE)',
    description:
      'Doğrusal ölçekleme: IN, [IN_MIN..IN_MAX] aralığından [OUT_MIN..OUT_MAX] aralığına çevrilir ve sınırlanır. ' +
      'Örn. %IW0 (0..27648) → seviye 0..100 %; ya da set değeri 0..100 → %QW0 (0..27648).',
    args: [
      arg('IN', 'IN – ölçeklenecek değer', '%IW0'),
      arg('IN_MIN', 'IN_MIN', '0'),
      arg('IN_MAX', 'IN_MAX', '27648'),
      arg('OUT_MIN', 'OUT_MIN', '0'),
      arg('OUT_MAX', 'OUT_MAX', '100'),
    ],
    defaultOut: '%MW0',
  },
  PID: {
    type: 'PID',
    title: 'PID kontrolör',
    description:
      'Kapalı çevrim kontrol: hata e = SP − PV. OUT = KP·(e + (1/TI)∫e dt − TD·dPV/dt), [MIN..MAX] ile sınırlı ' +
      '(integral doyması engellenir). TI = 0: integral yok; TD = 0: türev yok. Rung enerjisizken ' +
      'kontrolör sıfırlanır (manuel). PV ve SP aynı birimde olmalı (ör. ikisi de ham 0..27648).',
    args: [
      arg('PV', 'PV – ölçülen değer', '%IW0'),
      arg('SP', 'SP – hedef (set) değer', '%MW0'),
      arg('KP', 'KP – oransal kazanç', '2'),
      arg('TI', 'TI – integral süresi (ms, 0 = yok)', '5000'),
      arg('TD', 'TD – türev süresi (ms, 0 = yok)', '0'),
      arg('MIN', 'Çıkış alt sınırı', '0'),
      arg('MAX', 'Çıkış üst sınırı', '27648'),
    ],
    defaultOut: '%QW0',
  },
};

/** PID'in scan'ler arasında sakladığı durum. */
export interface PidState {
  integral: number;
  prevPv: number;
  started: boolean;
}

export const newPidState = (): PidState => ({ integral: 0, prevPv: 0, started: false });

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));

/**
 * Kutuyu hesaplar. `a`: girişlerin değerleri (spec.args sırasıyla). Sonuç null ise çıkış yazılmaz
 * ve ENO = 0 olur.
 */
export function evalBox(type: BoxType, a: number[], pid: PidState | null, dtMs: number): number | null {
  const v = (i: number) => a[i] ?? 0;
  switch (type) {
    case 'MOVE':
      return v(0);
    case 'ADD':
      return v(0) + v(1);
    case 'SUB':
      return v(0) - v(1);
    case 'MUL':
      return Math.round(v(0) * v(1));
    case 'DIV':
      return v(1) === 0 ? null : Math.trunc(v(0) / v(1));
    case 'SCALE': {
      const [x, inMin, inMax, outMin, outMax] = [v(0), v(1), v(2), v(3), v(4)];
      if (inMax === inMin) return null;
      return Math.round(clamp(outMin + ((x - inMin) * (outMax - outMin)) / (inMax - inMin), outMin, outMax));
    }
    case 'PID': {
      const [pv, sp, kp, ti, td, min, max] = [v(0), v(1), v(2), v(3), v(4), v(5), v(6)];
      const s = pid!;
      const e = sp - pv;
      if (!s.started) {
        s.prevPv = pv;
        s.started = true;
      }
      if (ti > 0) s.integral = clamp(s.integral + (kp * e * dtMs) / ti, min, max);
      else s.integral = 0;
      const d = td > 0 && dtMs > 0 ? (-kp * td * (pv - s.prevPv)) / dtMs : 0;
      s.prevPv = pv;
      return Math.round(clamp(kp * e + s.integral + d, min, max));
    }
  }
}
