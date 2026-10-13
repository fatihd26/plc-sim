// Sürücü ve özel motor sembolleri: frekans konvertörü, 6 uçlu (Y/Δ) motor, frenli motor.

import { strParam } from '../../sim/catalog';
import { bottom, Coil, Lead, motorClass, right, Rotor, top } from './common';
import { defineView, type StateOf } from './types';

// --- Frekans konvertörü ---------------------------------------------------------------------

export const vfdView = defineView<StateOf<'vfd'>>({
  type: 'vfd',
  geometry: {
    w: 200,
    h: 110,
    terminals: [
      top('L1', 20),
      top('L2', 40),
      top('L3', 60),
      top('DI1', 100),
      top('DI2', 120),
      top('DI3', 140),
      top('AI', 160),
      bottom('U', 20, 110),
      bottom('V', 40, 110),
      bottom('W', 60, 110),
      bottom('13', 100, 110),
      bottom('14', 120, 110),
      bottom('97', 140, 110),
      bottom('98', 160, 110),
      right('RS485_A', 40, 200),
      right('RS485_B', 60, 200),
    ],
  },
  Body: ({ inst, s }) => {
    const modbus = strParam(inst, 'control') === 'modbus';
    return (
      <g className={`mech vfd${s?.tripped ? ' tripped' : ''}`}>
        {[20, 40, 60, 100, 120, 140, 160].map((x) => (
          <Lead key={x} x={x} y1={0} y2={10} />
        ))}
        {[20, 40, 60].map((x) => (
          <Lead key={x} x={x} y1={100} y2={110} />
        ))}
        <path d="M 196 40 H 200 M 196 60 H 200" />
        <rect x={4} y={10} width={192} height={90} rx={4} className="box" />
        {/* Güç katı: doğrultucu → DC bara → evirici */}
        <path d="M 14 30 h 20 l 10 -8 M 34 30 l 10 8" className="thin" />
        <text x={50} y={46} className="sym-text tiny">
          ~ / =  / ~
        </text>
        {/* Ekran */}
        <rect x={84} y={22} width={72} height={30} rx={2} className="display" />
        <text x={120} y={33} className="sym-text readout">
          {s ? `${s.freq.toFixed(1)} Hz` : '0.0 Hz'}
        </text>
        <text x={120} y={46} className="sym-text tiny readout">
          {s ? (s.tripped ? 'ARIZA' : s.running ? (s.direction > 0 ? 'İLERİ ▶' : '◀ GERİ') : 'DUR') : modbus ? 'MODBUS' : 'KLEMENS'}
        </text>
        <circle cx={170} cy={30} r={3} className={s?.running ? 'led on' : 'led'} />
        <text x={180} y={31} className="sym-text tiny" textAnchor="start">
          R
        </text>
        <circle cx={170} cy={42} r={3} className={s?.tripped ? 'led fault' : 'led'} />
        <text x={180} y={43} className="sym-text tiny" textAnchor="start">
          F
        </text>
        <text x={40} y={70} className="sym-text small">
          VFD
        </text>
        {/* Röle kontakları */}
        <g className={s?.running ? 'pole closed' : 'pole'}>
          <line x1={100} y1={100} x2={100} y2={86} />
          <line x1={100} y1={86} x2={s?.running ? 120 : 117} y2={s?.running ? 86 : 79} className="blade" />
          <line x1={120} y1={86} x2={120} y2={100} />
        </g>
        <g className={s?.tripped ? 'pole closed' : 'pole'}>
          <line x1={140} y1={100} x2={140} y2={86} />
          <line x1={140} y1={86} x2={s?.tripped ? 160 : 157} y2={s?.tripped ? 86 : 79} className="blade" />
          <line x1={160} y1={86} x2={160} y2={100} />
        </g>
        <text x={190} y={52} className="sym-text tiny" textAnchor="end">
          485
        </text>
      </g>
    );
  },
  controls: [{ kind: 'button', label: 'Arıza reset (panel)', action: 'reset', when: (s) => s.tripped }],
});

// --- 6 uçlu motor ---------------------------------------------------------------------------

export const motor6View = defineView<StateOf<'motor6'>>({
  type: 'motor6',
  geometry: {
    w: 140,
    h: 90,
    terminals: [top('U1', 20), top('V1', 40), top('W1', 60), top('U2', 80), top('V2', 100), top('W2', 120)],
  },
  Body: ({ s }) => {
    const conn = s?.connection ?? 'off';
    return (
      <g className={motorClass(s)}>
        {[20, 40, 60, 80, 100, 120].map((x) => (
          <path key={x} d={`M ${x} 0 V 14 L ${70 + (x - 70) * 0.3} 34`} />
        ))}
        <rect x={10} y={8} width={120} height={8} rx={2} className="frame" />
        <circle cx={70} cy={60} r={26} className="box" />
        <Rotor cx={70} cy={60} r={24} angle={s?.angleDeg ?? 0} />
        <text x={70} y={58} className="sym-text">
          M
        </text>
        <text x={70} y={72} className="sym-text small">
          3~
        </text>
        <text x={118} y={78} className={`sym-text ${conn === 'wrong' ? 'fault-text' : ''}`}>
          {conn === 'star' ? 'Y' : conn === 'delta' ? 'Δ' : conn === 'wrong' ? '!' : ''}
        </text>
      </g>
    );
  },
});

// --- Frenli motor ---------------------------------------------------------------------------

export const brakeMotorView = defineView<StateOf<'brakeMotor'>>({
  type: 'brakeMotor',
  geometry: { w: 120, h: 90, terminals: [top('U', 20), top('V', 40), top('W', 60), top('BR1', 80), top('BR2', 100)] },
  Body: ({ inst, s }) => (
    <g className={motorClass(s)}>
      <Lead x={20} y1={0} y2={40} />
      <Lead x={40} y1={0} y2={30} />
      <Lead x={60} y1={0} y2={40} />
      <circle cx={40} cy={58} r={24} className="box" />
      <Rotor cx={40} cy={58} r={22} angle={s?.angleDeg ?? 0} />
      <text x={40} y={60} className="sym-text small">
        M 3~
      </text>
      {/* Fren: bobin + balata */}
      <Lead x={80} y1={0} y2={30} />
      <Lead x={100} y1={0} y2={30} />
      <Coil x={90} y={30} on={s?.released} fault={!!s?.fault} ac={strParam(inst, 'brakeVoltage') === '230AC'} />
      <line x1={64} y1={58} x2={80} y2={58} strokeDasharray="3 2" className="thin" />
      <rect x={80} y={50} width={6} height={16} className={s?.released ? 'brake open' : 'brake'} />
      <rect x={90} y={50} width={6} height={16} className={s?.released ? 'brake open' : 'brake'} />
    </g>
  ),
});
