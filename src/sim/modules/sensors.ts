// Dijital sensörler: endüktif / kapasitif yaklaşım, optik (fotoelektrik), limit switch ve
// artımlı enkoder.
//
// 3 telli PNP sensörler (IEC 60947-5-2 renk kodu): BN kahverengi = +24 V, BU mavi = 0 V,
// BK siyah = çıkış. Çıkış, sensör beslenirken ve algılarken +24 V verir (PLC girişine doğrudan
// bağlanır). Algılama hedefi bir mekanizmadır (konveyör, silindir, eksen...): sensör hedefin
// `at` noktasına bakar. Hedef seçilmezse simülasyonda sensöre tıklayarak nesne konur/kaldırılır.

import { choice, num, paramReader, targetParam, type ComponentSpec } from '../spec';
import { defineModule, type Material, type ModuleIo } from './types';

const PNP = ['BN', 'BU', 'BK'] as const;

interface PnpData {
  material: Material;
  at: number;
  nc: boolean;
  powered: boolean;
  detect: boolean;
  /** Elle konmuş nesne (hedef yokken). */
  manual: boolean;
  hasTarget: boolean;
  out: boolean;
}

const pnpFaults = [
  { key: 'dead', label: 'Sensör arızalı (çıkış hiç gelmiyor)' },
  { key: 'stuck', label: 'Çıkış sürekli aktif (kısa devre / kirli)' },
  { key: 'misaligned', label: 'Ayar kaymış (nesneyi göremiyor)' },
];

function pnpSpec(type: string, title: string, description: string): ComponentSpec {
  return {
    type,
    title,
    prefix: 'B',
    category: 'Sensörler',
    description: `${description} 3 telli PNP: BN +24 V, BU 0 V, BK çıkış (PLC girişine).`,
    terminals: PNP,
    params: [
      targetParam('target', 'Algıladığı mekanizma', 'probe'),
      num('at', 'Mekanizmadaki konumu', 50, 0, 100, 1, '%'),
      choice('output', 'Çıkış', 'NO', [
        ['NO', 'NO (nesne varken +24 V)'],
        ['NC', 'NC (nesne yokken +24 V)'],
      ]),
    ],
  };
}

/** PNP sensör modülü fabrikası; `material`: algıladığı malzeme ('any' = hepsi). */
function pnpModule<T extends string>(type: T, title: string, description: string, material: Material) {
  const spec = pnpSpec(type, title, description) as ComponentSpec<T>;
  return defineModule({
    spec,
    faults: pnpFaults,
    create: (inst): PnpData => {
      const p = paramReader(spec, inst);
      return {
        material,
        at: p.num('at') / 100,
        nc: p.str('output') === 'NC',
        powered: false,
        detect: false,
        manual: false,
        hasTarget: !!p.str('target'),
        out: false,
      };
    },
    links: (d, net) => {
      if (d.powered && d.out) net.source('BK', 'P24');
    },
    update: (d, io) => updatePnp(d, io),
    command: (d, action, value) => {
      if (action === 'toggle') d.manual = !d.manual;
      else if (action === 'set') d.manual = !!value;
    },
    state: (d) => ({
      type,
      powered: d.powered,
      detect: d.detect,
      out: d.out,
      manual: d.manual,
      hasTarget: d.hasTarget,
    }),
    signals: (s) => ({
      cikis: { label: 'Çıkış (BK)', value: s.out },
      algiliyor: { label: 'Nesne algılıyor', value: s.detect },
    }),
  });
}

function updatePnp(d: PnpData, io: ModuleIo): void {
  d.powered = io.powered24('BN', 'BU');
  const target = io.target('target');
  d.hasTarget = !!target;
  const seen = target ? (target.probe(d.at, d.material) ?? false) : d.manual;
  d.detect = seen && !io.fault('misaligned');
  const active = io.fault('stuck') ? !d.nc : d.detect;
  d.out = d.powered && !io.fault('dead') && active !== d.nc;
}

export const inductiveModule = pnpModule(
  'proxInductive',
  'Endüktif yaklaşım sensörü',
  'Yalnız metal nesneleri algılar (karton kutuyu görmez).',
  'metal',
);

export const capacitiveModule = pnpModule(
  'proxCapacitive',
  'Kapasitif yaklaşım sensörü',
  'Metal, plastik, karton, sıvı: her malzemeyi algılar.',
  'any',
);

export const photoModule = pnpModule(
  'photoSensor',
  'Optik sensör (fotosel)',
  'Reflektörlü fotoelektrik sensör: ışını kesen her nesneyi algılar. NC çıkış = "karanlıkta"/"aydınlıkta" seçimi.',
  'any',
);

// --- Limit switch ---------------------------------------------------------------------------

const limitSpec = {
  type: 'limitSwitch' as const,
  title: 'Limit switch',
  prefix: 'S',
  category: 'Sensörler' as const,
  description:
    'Mekanik sınır anahtarı: makaraya basılınca 13-14 (NO) kapanır, 21-22 (NC) açılır. Beslemesiz, kuru kontak.',
  terminals: ['13', '14', '21', '22'],
  params: [targetParam('target', 'Bastığı mekanizma', 'probe'), num('at', 'Mekanizmadaki konumu', 100, 0, 100, 1, '%')],
};

export const limitSwitchModule = defineModule({
  spec: limitSpec,
  faults: [
    { key: 'bent', label: 'Makara kolu eğilmiş (hiç basılmıyor)' },
    { key: 'welded', label: '13-14 kontağı yapışık' },
  ],
  create: (inst) => ({ at: paramReader(limitSpec, inst).num('at') / 100, actuated: false, manual: false, hasTarget: false }),
  links: (d, net) => {
    if (d.actuated || net.fault('welded')) net.link('13', '14');
    if (!d.actuated) net.link('21', '22');
  },
  update: (d, io) => {
    const target = io.target('target');
    d.hasTarget = !!target;
    d.actuated = !io.fault('bent') && (target ? (target.probe(d.at, 'any') ?? false) : d.manual);
  },
  command: (d, action, value) => {
    if (action === 'press') d.manual = !!value;
  },
  state: (d) => ({ type: 'limitSwitch' as const, actuated: d.actuated, pressed: d.manual, hasTarget: d.hasTarget }),
  signals: (s) => ({ basili: { label: 'Basılı (13-14 kapalı)', value: s.actuated } }),
});

// --- Artımlı enkoder ------------------------------------------------------------------------

const encoderSpec = {
  type: 'encoder' as const,
  title: 'Artımlı enkoder',
  prefix: 'B',
  category: 'Sensörler' as const,
  description:
    'Mile bağlı A/B kuadratür enkoder (PNP 24 V). Tur başına darbe sayısı ayarlanır. PLC\'de HSC ' +
    '(hızlı sayıcı) ile I0.0 = A, I0.1 = B girişlerinden sayılır. Hedef: motor veya motorlu mekanizma.',
  terminals: ['+', '-', 'A', 'B'],
  params: [targetParam('target', 'Bağlı olduğu mil', 'revs'), num('ppr', 'Tur başına darbe', 100, 1, 2000, 1, 'darbe/tur')],
};

/** Kuadratür seviyeleri: konum (darbe) → A, B kanalları. */
export const quadrature = (pos: number) => {
  const q = ((Math.floor(pos) % 4) + 4) % 4;
  return { a: q === 1 || q === 2, b: q === 2 || q === 3 };
};

export const encoderModule = defineModule({
  spec: encoderSpec,
  faults: [
    { key: 'dead', label: 'Enkoder arızalı (darbe yok)' },
    { key: 'chB', label: 'B kanalı kopuk' },
  ],
  create: (inst) => ({ src: inst.id, ppr: paramReader(encoderSpec, inst).num('ppr'), pos: 0, powered: false, hasTarget: false }),
  links: (d, net) => {
    if (!d.powered || net.fault('dead')) return;
    const q = quadrature(d.pos);
    if (q.a) net.source('A', 'P24');
    if (q.b && !net.fault('chB')) net.source('B', 'P24');
  },
  drive: (d, out) => {
    if (!d.powered || out.fault('dead')) return;
    out.drive('A', { kind: 'pulse', pos: Math.floor(d.pos), src: d.src });
    if (!out.fault('chB')) out.drive('B', { kind: 'pulse', pos: Math.floor(d.pos), src: d.src });
  },
  update: (d, io) => {
    d.powered = io.powered24('+', '-');
    const target = io.target('target');
    d.hasTarget = !!target;
    const revs = target?.measure('revs');
    if (revs !== null && revs !== undefined) d.pos = revs * d.ppr;
  },
  state: (d) => ({ type: 'encoder' as const, powered: d.powered, pulses: Math.floor(d.pos), hasTarget: d.hasTarget, ...quadrature(d.pos) }),
  signals: (s) => ({
    darbe: { label: 'Toplam darbe', value: s.pulses },
    a: { label: 'A kanalı', value: s.a },
    b: { label: 'B kanalı', value: s.b },
  }),
});
