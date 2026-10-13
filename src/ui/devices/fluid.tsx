// Pnömatik ve hidrolik semboller (ISO 1219 esinli). Valfler kare dizisiyle çizilir; etkin konumun
// karesi portların altına kayar (ders kitabındaki gibi).

import { numParam, strParam } from '../../sim/catalog';
import { bottom, Lead, left, motorClass, right, Rotor, top } from './common';
import { defineView, type StateOf, type SymbolInstance } from './types';

const SQ = 40;
const VY = 20;

/** Kare içi bağlantı türleri (yerel koordinat 0..40). */
type Glyph = { arrows?: [number, number, number, number][]; blocks?: [number, number][]; lines?: [number, number, number, number][] };

function Square({ x, g, active }: { x: number; g: Glyph; active: boolean }) {
  return (
    <g transform={`translate(${x} ${VY})`}>
      <rect width={SQ} height={SQ} className={active ? 'valve-pos active' : 'valve-pos'} />
      {g.lines?.map(([x1, y1, x2, y2], i) => <line key={`l${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className="thin" />)}
      {g.arrows?.map(([x1, y1, x2, y2], i) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const hx = x2 - ux * 6;
        const hy = y2 - uy * 6;
        return (
          <g key={`a${i}`}>
            <line x1={x1} y1={y1} x2={hx} y2={hy} className="thin" />
            <path d={`M ${x2} ${y2} L ${hx - uy * 3} ${hy + ux * 3} L ${hx + uy * 3} ${hy - ux * 3} Z`} className="arrow" />
          </g>
        );
      })}
      {g.blocks?.map(([bx, by], i) => (
        <path key={`b${i}`} d={`M ${bx} ${by} v ${by === 0 ? 6 : -6} m -4 0 h 8`} className="thin" />
      ))}
    </g>
  );
}

/**
 * Valf kareleri: `squares` soldan sağa, `portCol` portların bağlı olduğu kare indeksi, `active`
 * etkin kare indeksi. Kareler, etkin olan port sütununa gelecek şekilde kaydırılır.
 */
function ValveSquares({ x0, squares, portCol, active }: { x0: number; squares: Glyph[]; portCol: number; active: number }) {
  const shift = (portCol - active) * SQ;
  return (
    <g transform={`translate(${shift} 0)`} className="valve-squares">
      {squares.map((g, i) => (
        <Square key={i} x={x0 + i * SQ} g={g} active={i === active} />
      ))}
    </g>
  );
}

/** Egzoz üçgeni (atmosfere açık port). */
const Exhaust = ({ x }: { x: number }) => <path d={`M ${x} ${VY + SQ} v 6 m -5 0 h 10 l -5 6 Z`} className="thin exhaust" />;

/** Yay (geri getirme). */
const Spring = ({ x }: { x: number }) => <path d={`M ${x} ${VY + 20} l 3 -6 l 4 12 l 4 -12 l 4 12 l 3 -6`} className="thin" />;

// Port yerleşimi (kare içi): 4 sol üst, 2 sağ üst, 1 alt orta, 5 / 3 egzoz alt sol / sağ.
const G52: Record<'a' | 'b', Glyph> = {
  a: { arrows: [[20, 40, 10, 0], [30, 0, 30, 40]] },
  b: { arrows: [[20, 40, 30, 0], [10, 0, 10, 40]] },
};
const CLOSED: Glyph = { blocks: [[10, 0], [30, 0], [20, 40]] };

function SolenoidLeft({ s, inst, label = 'Y1' }: { s?: { y1: boolean; fault?: string | null }; inst: SymbolInstance; label?: string }) {
  return (
    <g>
      <path d="M 0 30 H 8 M 0 50 H 8" />
      <rect x={8} y={26} width={18} height={28} className={s?.y1 ? 'coil on' : s?.fault ? 'coil fault' : 'coil'} />
      <path d="M 12 30 L 22 50" className="thin" />
      <text x={17} y={20} className="sym-text tiny">
        {label}
      </text>
      {strParam(inst, 'coilVoltage') === '230AC' && (
        <text x={17} y={60} className="sym-text tiny">
          ~
        </text>
      )}
      <line x1={26} y1={40} x2={30} y2={40} />
    </g>
  );
}

function SolenoidRight({ x, on, label = 'Y2' }: { x: number; on?: boolean; label?: string }) {
  return (
    <g>
      <line x1={x} y1={40} x2={x + 4} y2={40} />
      <rect x={x + 4} y={26} width={18} height={28} className={on ? 'coil on' : 'coil'} />
      <path d={`M ${x + 8} 30 L ${x + 18} 50`} className="thin" />
      <path d={`M ${x + 22} 30 H ${x + 30} M ${x + 22} 50 H ${x + 30}`} />
      <text x={x + 13} y={20} className="sym-text tiny">
        {label}
      </text>
    </g>
  );
}

// --- Pnömatik valfler -----------------------------------------------------------------------

type Valve = StateOf<'valve52'> | StateOf<'valve52bi'> | StateOf<'valve53'> | StateOf<'valve32'>;
const posIndex = (s: Valve | undefined, order: string[], rest: string) => order.indexOf(s?.pos ?? rest);

/** 2 kareli 5/2 valf portları (port sütunu x = 70..110). */
const PORTS52 = [left('A1', 30), left('A2', 50), top('4', 80), top('2', 100), bottom('1', 90, 80)];

export const valve52View = defineView<StateOf<'valve52'>>({
  type: 'valve52',
  geometry: { w: 140, h: 80, terminals: PORTS52 },
  Body: ({ inst, s }) => (
    <g className={`mech valve${s?.fault ? ' tripped' : ''}`}>
      <rect x={0} y={0} width={140} height={80} className="hit" />
      <SolenoidLeft s={s} inst={inst} />
      <ValveSquares x0={30} squares={[G52.a, G52.b]} portCol={1} active={posIndex(s, ['a', 'b'], 'b')} />
      <Spring x={110} />
      <Lead x={80} y1={0} y2={VY} />
      <Lead x={100} y1={0} y2={VY} />
      <Lead x={90} y1={VY + SQ} y2={80} />
      <Exhaust x={80} />
      <Exhaust x={100} />
    </g>
  ),
  click: 'hold',
  controls: [{ kind: 'hold', label: 'Elle kumanda (manuel buton)', held: (s) => s.pressed }],
});

export const valve52biView = defineView<StateOf<'valve52bi'>>({
  type: 'valve52bi',
  geometry: { w: 140, h: 80, terminals: [...PORTS52, right('B1', 30, 140), right('B2', 50, 140)] },
  Body: ({ inst, s }) => (
    <g className={`mech valve${s?.fault ? ' tripped' : ''}`}>
      <rect x={0} y={0} width={140} height={80} className="hit" />
      <SolenoidLeft s={s} inst={inst} />
      <ValveSquares x0={30} squares={[G52.a, G52.b]} portCol={1} active={posIndex(s, ['a', 'b'], 'b')} />
      <SolenoidRight x={110} on={s?.y2} />
      <Lead x={80} y1={0} y2={VY} />
      <Lead x={100} y1={0} y2={VY} />
      <Lead x={90} y1={VY + SQ} y2={80} />
      <Exhaust x={80} />
      <Exhaust x={100} />
    </g>
  ),
});

export const valve53View = defineView<StateOf<'valve53'>>({
  type: 'valve53',
  geometry: { w: 180, h: 80, terminals: [...PORTS52, right('B1', 30, 180), right('B2', 50, 180)] },
  Body: ({ inst, s }) => (
    <g className={`mech valve${s?.fault ? ' tripped' : ''}`}>
      <rect x={0} y={0} width={180} height={80} className="hit" />
      <SolenoidLeft s={s} inst={inst} />
      <ValveSquares x0={30} squares={[G52.a, CLOSED, G52.b]} portCol={1} active={posIndex(s, ['a', 'center', 'b'], 'center')} />
      <SolenoidRight x={150} on={s?.y2} />
      <Lead x={80} y1={0} y2={VY} />
      <Lead x={100} y1={0} y2={VY} />
      <Lead x={90} y1={VY + SQ} y2={80} />
      <Exhaust x={80} />
      <Exhaust x={100} />
    </g>
  ),
});

const G32: Record<'a' | 'b', Glyph> = {
  a: { arrows: [[10, 40, 20, 0]], blocks: [[30, 40]] },
  b: { arrows: [[20, 0, 30, 40]], blocks: [[10, 40]] },
};

export const valve32View = defineView<StateOf<'valve32'>>({
  type: 'valve32',
  geometry: { w: 140, h: 80, terminals: [left('A1', 30), left('A2', 50), top('2', 90), bottom('1', 80, 80)] },
  Body: ({ inst, s }) => (
    <g className={`mech valve${s?.fault ? ' tripped' : ''}`}>
      <rect x={0} y={0} width={140} height={80} className="hit" />
      <SolenoidLeft s={s} inst={inst} />
      <ValveSquares x0={30} squares={[G32.a, G32.b]} portCol={1} active={posIndex(s, ['a', 'b'], 'b')} />
      <Spring x={110} />
      <Lead x={90} y1={0} y2={VY} />
      <Lead x={80} y1={VY + SQ} y2={80} />
      <Exhaust x={100} />
    </g>
  ),
  click: 'hold',
  controls: [{ kind: 'hold', label: 'Elle kumanda (manuel buton)', held: (s) => s.pressed }],
});

// --- Hava kaynağı ve kısma valfi ------------------------------------------------------------

export const airSupplyView = defineView<StateOf<'airSupply'>>({
  type: 'airSupply',
  geometry: { w: 60, h: 60, terminals: [right('1', 30, 60)] },
  Body: ({ inst, s }) => (
    <g className={`mech${s && !s.on ? ' tripped' : ''}`}>
      <rect x={0} y={0} width={60} height={60} className="hit" />
      <circle cx={26} cy={30} r={16} className="box" />
      <path d="M 26 18 L 36 30 L 16 30 Z" className={s?.on !== false ? 'arrow open-air' : 'arrow'} />
      <line x1={42} y1={30} x2={60} y2={30} />
      <text x={26} y={56} className="sym-text tiny">
        {numParam(inst, 'pressureBar')} bar
      </text>
    </g>
  ),
  click: { action: 'toggle' },
  controls: [{ kind: 'button', label: (s) => (s.on ? 'Kompresörü durdur' : 'Kompresörü çalıştır'), action: 'toggle' }],
});

export const throttleView = defineView<StateOf<'throttleCheck'>>({
  type: 'throttleCheck',
  geometry: { w: 60, h: 60, terminals: [top('1', 20), bottom('2', 20, 60)] },
  Body: ({ inst, s }) => (
    <g className="mech">
      <rect x={0} y={0} width={60} height={60} className="hit" />
      <path d="M 20 0 V 60" />
      {/* Kısma: iki yay */}
      <path d="M 14 22 q 6 8 0 16 M 26 22 q -6 8 0 16" className="thin" />
      <path d="M 8 40 L 32 20 m -6 0 h 6 v 6" className="thin" />
      {/* Çek valf paralel kolda */}
      <path d="M 20 12 H 44 V 48 H 20" className="thin" />
      <circle cx={44} cy={32} r={4} className="box" />
      <path d="M 38 38 L 44 28 L 50 38" className="thin" />
      <text x={50} y={8} className="sym-text tiny">
        {Math.round((s?.open ?? numParam(inst, 'openPct') / 100) * 100)}%
      </text>
    </g>
  ),
  controls: [{ kind: 'slider', label: 'Kısma açıklığı', action: 'set', min: 5, max: 100, step: 5, unit: '%', value: (s) => s.open * 100 }],
});

// --- Silindirler ----------------------------------------------------------------------------

/** Silindir gövdesi: namlu 30..130, piston + mil. Uç sensörleri üstte. */
function CylinderShape({
  pos,
  single,
  retracted,
  extended,
  thick,
}: {
  pos: number;
  single?: boolean;
  retracted?: boolean;
  extended?: boolean;
  thick?: boolean;
}) {
  const x0 = 20;
  const x1 = 140;
  const px = x0 + 4 + (x1 - x0 - 16) * pos;
  const y0 = thick ? 22 : 26;
  const y1 = thick ? 54 : 50;
  return (
    <g>
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} className="box" />
      <rect x={px} y={y0 + 2} width={8} height={y1 - y0 - 4} className="piston" />
      <rect x={px + 8} y={(y0 + y1) / 2 - 3} width={130} height={6} className="rod" />
      {single && (
        <path
          d={`M ${px + 10} ${y0 + 4} ${Array.from({ length: 6 }, (_, i) => `L ${px + 10 + ((x1 - px - 12) * (i + 1)) / 6} ${i % 2 ? y0 + 4 : y1 - 4}`).join(' ')}`}
          className="thin spring"
        />
      )}
      {/* Manyetik sensörler: geride 13-14 (x 30-50), ileride 23-24 (x 110-130) */}
      <rect x={30} y={10} width={20} height={8} rx={2} className={retracted ? 'sensor on' : 'sensor'} />
      <rect x={110} y={10} width={20} height={8} rx={2} className={extended ? 'sensor on' : 'sensor'} />
      <path d="M 30 0 V 10 M 50 0 V 10 M 110 0 V 10 M 130 0 V 10" />
    </g>
  );
}

const reedTerminals = [top('13', 30), top('14', 50), top('23', 110), top('24', 130)];

export const cylDoubleView = defineView<StateOf<'cylDouble'>>({
  type: 'cylDouble',
  geometry: { w: 250, h: 70, terminals: [...reedTerminals, bottom('A', 30, 70), bottom('B', 130, 70)] },
  Body: ({ s }) => (
    <g className="mech">
      <rect x={0} y={0} width={250} height={70} className="hit" />
      <CylinderShape pos={s?.pos ?? 0} retracted={s?.retracted} extended={s?.extended} />
      <path d="M 30 50 V 70 M 130 50 V 70" />
    </g>
  ),
});

export const cylSingleView = defineView<StateOf<'cylSingle'>>({
  type: 'cylSingle',
  geometry: { w: 250, h: 70, terminals: [...reedTerminals, bottom('A', 30, 70)] },
  Body: ({ s }) => (
    <g className="mech">
      <rect x={0} y={0} width={250} height={70} className="hit" />
      <CylinderShape pos={s?.pos ?? 0} single retracted={s?.retracted} extended={s?.extended} />
      <path d="M 30 50 V 70" />
      <path d="M 134 38 h 6 m 0 -4 l 4 4 l -4 4" className="thin" />
    </g>
  ),
});

// --- Hidrolik -------------------------------------------------------------------------------

export const hpuView = defineView<StateOf<'hpu'>>({
  type: 'hpu',
  geometry: { w: 170, h: 130, terminals: [top('U', 20), top('V', 40), top('W', 60), right('P', 40, 170), right('T', 100, 170)] },
  Body: ({ inst, s }) => (
    <g className="mech">
      <rect x={0} y={0} width={170} height={130} className="hit" />
      <g className={motorClass(s)}>
        <Lead x={20} y1={0} y2={34} />
        <Lead x={40} y1={0} y2={26} />
        <Lead x={60} y1={0} y2={34} />
        <circle cx={40} cy={50} r={22} className="box" />
        <Rotor cx={40} cy={50} r={20} angle={s?.angleDeg ?? 0} />
        <text x={40} y={52} className="sym-text small">
          M 3~
        </text>
      </g>
      <line x1={62} y1={50} x2={78} y2={50} strokeDasharray="3 2" className="thin" />
      {/* Pompa */}
      <circle cx={96} cy={50} r={16} className="box" />
      <path d="M 96 36 L 104 46 L 88 46 Z" className="arrow" />
      <path d="M 96 66 V 108" className="thin" />
      <path d="M 96 34 V 26 H 150 V 40 H 170" />
      {/* Emniyet valfi: P → T */}
      <rect x={130} y={50} width={16} height={26} className={s?.reliefOpen ? 'valve-pos active' : 'valve-pos'} />
      <path d="M 138 40 V 50 M 138 76 V 100 H 170 M 134 66 l 4 6 l 4 -6" className="thin" />
      <path d="M 146 58 l 4 -3 l 4 6 l 4 -6" className="thin" />
      {/* Tank */}
      <path d="M 76 108 V 120 H 156 V 108" />
      <text x={116} y={116} className="sym-text tiny">
        {s ? `${Math.round(s.oilC)} °C` : 'tank'}
      </text>
      <text x={150} y={20} className="sym-text tiny readout">
        {s ? `${Math.round(s.pressure)} bar` : `${numParam(inst, 'reliefBar')} bar`}
      </text>
    </g>
  ),
});

const G43: Record<string, Glyph> = {
  // A sol üst (10,0), B sağ üst (30,0), P sol alt (10,40), T sağ alt (30,40)
  a: { arrows: [[10, 40, 10, 0], [30, 0, 30, 40]] },
  b: { arrows: [[10, 40, 30, 0], [10, 0, 30, 40]] },
  closed: { blocks: [[10, 0], [30, 0], [10, 40], [30, 40]] },
  tandem: { lines: [[10, 40, 10, 30], [10, 30, 30, 30], [30, 30, 30, 40]], blocks: [[10, 0], [30, 0]] },
  float: { lines: [[10, 0, 10, 20], [30, 0, 30, 40], [10, 20, 30, 20]], blocks: [[10, 40]] },
};

export const valve43View = defineView<StateOf<'valve43'>>({
  type: 'valve43',
  geometry: {
    w: 180,
    h: 80,
    terminals: [left('A1', 30), left('A2', 50), right('B1', 30, 180), right('B2', 50, 180), top('A', 80), top('B', 100), bottom('P', 80, 80), bottom('T', 100, 80)],
  },
  Body: ({ inst, s }) => {
    const center = s?.center ?? strParam(inst, 'center');
    const active = ['a', 'center', 'b'].indexOf(s?.pos ?? 'center');
    return (
      <g className={`mech valve${s?.fault ? ' tripped' : ''}`}>
        <rect x={0} y={0} width={180} height={80} className="hit" />
        <SolenoidLeft s={s} inst={inst} />
        <ValveSquares x0={30} squares={[G43.a!, G43[center] ?? G43.closed!, G43.b!]} portCol={1} active={active} />
        <SolenoidRight x={150} on={s?.y2} />
        <Lead x={80} y1={0} y2={VY} />
        <Lead x={100} y1={0} y2={VY} />
        <Lead x={80} y1={VY + SQ} y2={80} />
        <Lead x={100} y1={VY + SQ} y2={80} />
      </g>
    );
  },
});

export const hydCylinderView = defineView<StateOf<'hydCylinder'>>({
  type: 'hydCylinder',
  geometry: { w: 250, h: 70, terminals: [...reedTerminals, bottom('A', 30, 70), bottom('B', 130, 70)] },
  Body: ({ s }) => (
    <g className="mech hydraulic-cyl">
      <rect x={0} y={0} width={250} height={70} className="hit" />
      <CylinderShape pos={s?.pos ?? 0} thick retracted={s?.retracted} extended={s?.extended} />
      <path d="M 30 54 V 70 M 130 54 V 70" />
      <text x={200} y={64} className="sym-text tiny readout">
        {s ? `${Math.round(s.mm)} mm` : ''}
      </text>
    </g>
  ),
});

// --- Ekskavatör kolu ------------------------------------------------------------------------

const EXC_SENSORS = ['BU', 'BD', 'AE', 'AR', 'KC', 'KO'];
const RAD = Math.PI / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const excavatorView = defineView<StateOf<'excavator'>>({
  type: 'excavator',
  geometry: {
    w: 320,
    h: 230,
    terminals: [
      top('L+', 20),
      top('M', 40),
      ...EXC_SENSORS.map((n, i) => top(n, 100 + i * 20)),
      ...['A1', 'B1', 'A2', 'B2', 'A3', 'B3'].map((n, i) => bottom(n, 20 + i * 20 + Math.floor(i / 2) * 20, 230)),
    ],
  },
  Body: ({ s }) => {
    const boom = s?.boom ?? 0.6;
    const arm = s?.arm ?? 0.3;
    const bucket = s?.bucket ?? 0.3;
    // Kinematik (yalnız çizim): bom pivotu → arm pivotu → kova pivotu → kova ucu
    const pivot = { x: 110, y: 150 };
    const a1 = lerp(-15, 55, boom) * RAD; // bom açısı (yataydan yukarı)
    const L1 = 110;
    const p2 = { x: pivot.x + L1 * Math.cos(a1), y: pivot.y - L1 * Math.sin(a1) };
    const a2 = a1 - lerp(150, 60, arm) * RAD; // arm açısı (bom'a göre aşağı kırık)
    const L2 = 80;
    const p3 = { x: p2.x + L2 * Math.cos(a2), y: p2.y - L2 * Math.sin(a2) };
    const a3 = a2 - lerp(30, 160, bucket) * RAD;
    const L3 = 30;
    const tip = { x: p3.x + L3 * Math.cos(a3), y: p3.y - L3 * Math.sin(a3) };
    const back = { x: p3.x + 18 * Math.cos(a3 + 1.7), y: p3.y - 18 * Math.sin(a3 + 1.7) };
    return (
      <g className="mech excavator">
        <rect x={0} y={0} width={320} height={230} className="hit" />
        {EXC_SENSORS.map((n, i) => (
          <Lead key={n} x={100 + i * 20} y1={0} y2={10} />
        ))}
        <text x={160} y={20} className="sym-text tiny">
          sınır sensörleri
        </text>
        {/* Zemin, kazı alanı ve palet */}
        <line x1={0} y1={196} x2={320} y2={196} className="ground" />
        <path d="M 220 196 q 40 -14 90 0" className="soil" />
        <rect x={30} y={176} width={110} height={18} rx={9} className="box" />
        <rect x={50} y={130} width={70} height={46} rx={4} className="box cab" />
        <rect x={56} y={136} width={22} height={18} className="window" />
        {/* Kol */}
        <line x1={pivot.x} y1={pivot.y} x2={p2.x} y2={p2.y} className="boom" />
        <line x1={p2.x} y1={p2.y} x2={p3.x} y2={p3.y} className="boom" />
        <path d={`M ${p3.x} ${p3.y} L ${tip.x} ${tip.y} L ${back.x} ${back.y} Z`} className={s?.full ? 'bucket full' : 'bucket'} />
        {/* Silindirler (çizgi olarak) */}
        <line x1={95} y1={165} x2={(pivot.x + p2.x) / 2} y2={(pivot.y + p2.y) / 2 + 6} className="hyd-rod" />
        <line x1={(pivot.x + p2.x) / 2} y1={(pivot.y + p2.y) / 2 - 4} x2={p2.x + 10 * Math.cos(a2)} y2={p2.y - 10 * Math.sin(a2) - 8} className="hyd-rod" />
        <line x1={(p2.x + p3.x) / 2} y1={(p2.y + p3.y) / 2} x2={back.x} y2={back.y} className="hyd-rod" />
        {[pivot, p2, p3].map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} className="hub" />
        ))}
        <text x={300} y={40} className="sym-text tiny readout" textAnchor="end">
          {s ? `${Math.round(s.pressure)} bar · boşaltılan ${s.dumped}` : ''}
        </text>
        {/* Hidrolik portlar */}
        {['bom', 'arm', 'kova'].map((n, i) => (
          <text key={n} x={30 + i * 60} y={214} className="sym-text tiny">
            {n}
          </text>
        ))}
        {[20, 40, 80, 100, 140, 160].map((x) => (
          <Lead key={x} x={x} y1={220} y2={230} />
        ))}
      </g>
    );
  },
  controls: [{ kind: 'button', label: 'Kovayı boşalt (elle)', action: 'empty', when: (s) => s.full }],
});


