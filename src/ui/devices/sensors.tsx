// Sensör ve transmitter sembolleri: PNP yaklaşım/optik sensörler, limit switch, enkoder,
// analog transmitterler (ISA etiketli daire) ve potansiyometre.

import { numParam, strParam } from '../../sim/catalog';
import { bottom, Lead, top } from './common';
import { defineView, type StateOf, type SymbolInstance } from './types';

// --- PNP sensörler --------------------------------------------------------------------------

type Pnp = StateOf<'proxInductive'> | StateOf<'proxCapacitive'> | StateOf<'photoSensor'>;

const PNP_GEO = { w: 60, h: 70, terminals: [top('BN', 10), top('BU', 30), top('BK', 50)] };

function PnpBody({ inst, s, kind }: { inst: SymbolInstance; s: Pnp | undefined; kind: 'IND' | 'CAP' | 'OPT' }) {
  const nc = strParam(inst, 'output') === 'NC';
  return (
    <g className={`mech sensor-sym${s?.out ? ' on' : ''}`}>
      <rect x={0} y={0} width={60} height={70} className="hit" />
      <Lead x={10} y1={0} y2={14} />
      <Lead x={30} y1={0} y2={14} />
      <Lead x={50} y1={0} y2={14} />
      <rect x={4} y={14} width={52} height={28} rx={3} className="box" />
      {/* IEC 60617 yaklaşım sensörü: eşkenar dörtgen içinde algılama işareti */}
      <path d="M 18 28 l 8 -8 l 8 8 l -8 8 Z" className="thin" />
      {kind === 'OPT' ? (
        <path d="M 22 26 l 4 4 m -1 -3 v 3 h -3 M 26 24 l 4 4 m -1 -3 v 3 h -3" className="thin" />
      ) : (
        <text x={26} y={29} className="sym-text tiny">
          {kind === 'IND' ? 'Fe' : '≈'}
        </text>
      )}
      <text x={45} y={24} className="sym-text tiny">
        {kind}
      </text>
      <text x={45} y={35} className="sym-text tiny">
        {nc ? 'NC' : 'NO'}
      </text>
      <circle cx={50} cy={14} r={3} className={s?.out ? 'led on' : 'led'} />
      {/* Algılama yüzü ve alanı */}
      <rect x={18} y={42} width={24} height={6} className="box" />
      <path d="M 20 52 q 10 6 20 0 M 23 57 q 7 4 14 0" className={s?.detect ? 'field on' : 'field'} />
      {s && !s.hasTarget && <rect x={22} y={62} width={16} height={7} rx={1} className={s.manual ? 'target-obj on' : 'target-obj'} />}
    </g>
  );
}

const pnpControls = [
  {
    kind: 'button' as const,
    label: (s: Pnp) => (s.manual ? 'Nesneyi kaldır' : 'Nesne koy'),
    action: 'toggle',
    when: (s: Pnp) => !s.hasTarget,
  },
];

export const inductiveView = defineView<StateOf<'proxInductive'>>({
  type: 'proxInductive',
  geometry: PNP_GEO,
  Body: ({ inst, s }) => <PnpBody inst={inst} s={s} kind="IND" />,
  click: { action: 'toggle' },
  controls: pnpControls,
});

export const capacitiveView = defineView<StateOf<'proxCapacitive'>>({
  type: 'proxCapacitive',
  geometry: PNP_GEO,
  Body: ({ inst, s }) => <PnpBody inst={inst} s={s} kind="CAP" />,
  click: { action: 'toggle' },
  controls: pnpControls,
});

export const photoView = defineView<StateOf<'photoSensor'>>({
  type: 'photoSensor',
  geometry: PNP_GEO,
  Body: ({ inst, s }) => <PnpBody inst={inst} s={s} kind="OPT" />,
  click: { action: 'toggle' },
  controls: pnpControls,
});

// --- Limit switch ---------------------------------------------------------------------------

export const limitSwitchView = defineView<StateOf<'limitSwitch'>>({
  type: 'limitSwitch',
  geometry: { w: 60, h: 60, terminals: [top('13', 20), top('21', 40), bottom('14', 20, 60), bottom('22', 40, 60)] },
  Body: ({ s }) => {
    const on = s?.actuated ?? false;
    return (
      <g className={on ? 'pressed' : ''}>
        <rect x={0} y={0} width={60} height={60} className="hit" />
        {/* NO 13-14 */}
        <g className={on ? 'pole closed' : 'pole'}>
          <line x1={20} y1={0} x2={20} y2={20} />
          <line x1={20} y1={40} x2={on ? 20 : 11} y2={on ? 20 : 22} className="blade" />
          <line x1={20} y1={40} x2={20} y2={60} />
        </g>
        {/* NC 21-22 */}
        <g className={!on ? 'pole closed' : 'pole'}>
          <line x1={40} y1={0} x2={40} y2={20} />
          <line x1={40} y1={20} x2={48} y2={20} />
          <line x1={40} y1={40} x2={on ? 31 : 50} y2={on ? 22 : 18} className="blade" />
          <line x1={40} y1={40} x2={40} y2={60} />
        </g>
        <line x1={6} y1={30} x2={44} y2={30} strokeDasharray="3 2" className="thin" />
        {/* Makaralı kol */}
        <circle cx={5} cy={30} r={4} className="box" />
      </g>
    );
  },
  click: 'hold',
  controls: [{ kind: 'hold', label: 'Makaraya bas', held: (s) => s.pressed, when: (s) => !s.hasTarget }],
});

// --- Enkoder --------------------------------------------------------------------------------

export const encoderView = defineView<StateOf<'encoder'>>({
  type: 'encoder',
  geometry: { w: 60, h: 70, terminals: [top('+', 10), top('-', 30), bottom('A', 30, 70), bottom('B', 50, 70)] },
  Body: ({ s }) => {
    const angle = ((s?.pulses ?? 0) * 3.6) % 360;
    return (
      <g className="mech">
        <Lead x={10} y1={0} y2={14} />
        <Lead x={30} y1={0} y2={14} />
        <rect x={4} y={14} width={52} height={42} rx={3} className="box" />
        <g transform={`rotate(${angle} 22 35)`}>
          <circle cx={22} cy={35} r={14} className="box" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <rect key={a} x={21} y={22} width={2} height={5} transform={`rotate(${a} 22 35)`} className="slot" />
          ))}
        </g>
        <text x={46} y={24} className="sym-text tiny">
          ENC
        </text>
        <circle cx={44} cy={36} r={3} className={s?.a ? 'led on' : 'led'} />
        <circle cx={44} cy={46} r={3} className={s?.b ? 'led on' : 'led'} />
        <Lead x={30} y1={56} y2={70} />
        <Lead x={50} y1={56} y2={70} />
      </g>
    );
  },
});

// --- Analog transmitterler ------------------------------------------------------------------

type Tx = StateOf<'levelTx'> | StateOf<'tempTx'> | StateOf<'pressureTx'>;

const TX_GEO = { w: 60, h: 70, terminals: [top('+', 10), top('-', 30), top('OUT', 50)] };

function TxBody({ inst, s, tag }: { inst: SymbolInstance; s: Tx | undefined; tag: string }) {
  const unit = s?.unit ?? '';
  return (
    <g className={`mech tx${s?.powered ? ' on' : ''}`}>
      <rect x={0} y={0} width={60} height={70} className="hit" />
      <Lead x={10} y1={0} y2={16} />
      <Lead x={30} y1={0} y2={12} />
      <Lead x={50} y1={0} y2={16} />
      {/* ISA cihaz dairesi */}
      <circle cx={30} cy={34} r={18} className="box" />
      <line x1={12} y1={34} x2={48} y2={34} className="thin" />
      <text x={30} y={27} className="sym-text small">
        {tag}
      </text>
      <text x={30} y={42} className="sym-text tiny">
        {strParam(inst, 'signal') === '4-20mA' ? '4-20' : '0-10V'}
      </text>
      <text x={30} y={64} className="sym-text tiny readout">
        {s ? `${s.value.toFixed(unit === 'bar' ? 1 : 0)} ${unit}` : `${numParam(inst, 'min')}–${numParam(inst, 'max')}`}
      </text>
    </g>
  );
}

const txControls = [
  {
    kind: 'slider' as const,
    label: 'Ölçülen değer (elle)',
    action: 'set',
    min: (s: Tx) => s.min,
    max: (s: Tx) => s.max,
    step: 0.5,
    unit: (s: Tx) => s.unit,
    value: (s: Tx) => s.value,
    when: (s: Tx) => !s.hasTarget,
  },
];

export const levelTxView = defineView<StateOf<'levelTx'>>({
  type: 'levelTx',
  geometry: TX_GEO,
  Body: ({ inst, s }) => <TxBody inst={inst} s={s} tag="LT" />,
  controls: txControls,
});

export const tempTxView = defineView<StateOf<'tempTx'>>({
  type: 'tempTx',
  geometry: TX_GEO,
  Body: ({ inst, s }) => <TxBody inst={inst} s={s} tag="TT" />,
  controls: txControls,
});

export const pressureTxView = defineView<StateOf<'pressureTx'>>({
  type: 'pressureTx',
  geometry: TX_GEO,
  Body: ({ inst, s }) => <TxBody inst={inst} s={s} tag="PT" />,
  controls: txControls,
});

// --- Potansiyometre -------------------------------------------------------------------------

export const potentiometerView = defineView<StateOf<'potentiometer'>>({
  type: 'potentiometer',
  geometry: { w: 60, h: 70, terminals: [top('+', 20), bottom('-', 20, 70), bottom('OUT', 40, 70)] },
  Body: ({ inst, s }) => {
    const pct = s?.pct ?? numParam(inst, 'initialPct');
    const y = 52 - pct * 0.34;
    return (
      <g className="mech">
        <rect x={0} y={0} width={60} height={70} className="hit" />
        <Lead x={20} y1={0} y2={18} />
        <rect x={14} y={18} width={12} height={34} className="box" />
        <Lead x={20} y1={52} y2={70} />
        <path d={`M 40 70 V ${y} H 30`} />
        <path d={`M 27 ${y} l 6 -4 v 8 Z`} className="arrow" />
        <text x={46} y={12} className="sym-text tiny readout">
          {Math.round(pct)}%
        </text>
      </g>
    );
  },
  controls: [{ kind: 'slider', label: 'Düğme', action: 'set', min: 0, max: 100, step: 1, unit: '%', value: (s) => s.pct }],
});
