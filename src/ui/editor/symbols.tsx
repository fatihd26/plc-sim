// IEC 60617 esinli sembol çizimleri (yerel koordinat). Durum verilirse canlı gösterilir.

import type { ReactNode } from 'react';
import { PLC_DI, PLC_DQ, type ComponentType } from '../../sim/catalog';
import type { ComponentState } from '../../sim/simulation';
import { GEOMETRY } from './geometry';

interface PoleProps {
  x: number;
  /** Sabit kontak ucu ve mafsal noktasının y değerleri. */
  yFixed: number;
  yPivot: number;
  h: number;
  closed: boolean;
  nc?: boolean;
}

/** Tek kutuplu kontak: üst besleme ucu, hareketli bıçak, alt uç. */
function Pole({ x, yFixed, yPivot, h, closed, nc }: PoleProps) {
  const tip = closed ? (nc ? { x: x + 10, y: yFixed - 2 } : { x, y: yFixed }) : { x: x - 11, y: yFixed + 2 };
  return (
    <g className={closed ? 'pole closed' : 'pole'}>
      <line x1={x} y1={0} x2={x} y2={yFixed} />
      {nc && <line x1={x} y1={yFixed} x2={x + 8} y2={yFixed} />}
      <line x1={x} y1={yPivot} x2={tip.x} y2={tip.y} className="blade" />
      <line x1={x} y1={yPivot} x2={x} y2={h} />
    </g>
  );
}

/** Mantar başlı kilitlemeli itme (acil stop). */
function MushroomActuator({ y }: { y: number }) {
  return (
    <g className="actuator">
      <path d={`M 4 ${y - 9} A 9 9 0 0 0 4 ${y + 9} Z`} className="mushroom" />
      <line x1={4} y1={y} x2={14} y2={y} strokeDasharray="3 2" />
    </g>
  );
}

function PushActuator({ y }: { y: number }) {
  return (
    <g className="actuator">
      <path d={`M 7 ${y - 7} L 3 ${y - 7} L 3 ${y + 7} L 7 ${y + 7}`} />
      <line x1={3} y1={y} x2={14} y2={y} strokeDasharray="3 2" />
    </g>
  );
}

const st = <T extends ComponentState['type']>(s: ComponentState | undefined, t: T) =>
  s?.type === t ? (s as ComponentState & { type: T }) : undefined;

export function SymbolBody({ type, state }: { type: ComponentType; state?: ComponentState }): ReactNode {
  const g = GEOMETRY[type];
  switch (type) {
    case 'mains3':
      return (
        <g>
          <rect x={4} y={2} width={72} height={26} rx={2} className="box" />
          <text x={40} y={19} className="sym-text">
            3~ 400 V
          </text>
          {[20, 40, 60].map((x) => (
            <line key={x} x1={x} y1={28} x2={x} y2={40} />
          ))}
        </g>
      );
    case 'psu24':
      return (
        <g>
          <rect x={4} y={2} width={52} height={44} rx={2} className="box" />
          <line x1={4} y1={46} x2={56} y2={2} className="thin" />
          <text x={17} y={18} className="sym-text small">
            ~
          </text>
          <text x={42} y={40} className="sym-text small">
            24V=
          </text>
          <line x1={20} y1={46} x2={20} y2={60} />
          <line x1={40} y1={46} x2={40} y2={60} />
        </g>
      );
    case 'buttonNO': {
      const s = st(state, 'buttonNO');
      return (
        <g className={s?.pressed ? 'pressed' : ''}>
          <rect x={0} y={0} width={40} height={60} className="hit" />
          <Pole x={20} yFixed={18} yPivot={42} h={60} closed={s?.contactClosed ?? false} />
          <PushActuator y={30} />
        </g>
      );
    }
    case 'buttonNC': {
      const s = st(state, 'buttonNC');
      return (
        <g className={s?.pressed ? 'pressed' : ''}>
          <rect x={0} y={0} width={40} height={60} className="hit" />
          <Pole x={20} yFixed={18} yPivot={42} h={60} closed={s?.contactClosed ?? true} nc />
          <PushActuator y={30} />
        </g>
      );
    }
    case 'estop': {
      const s = st(state, 'estop');
      return (
        <g className={s?.pressed ? 'pressed estop' : 'estop'}>
          <rect x={0} y={0} width={40} height={60} className="hit" />
          <Pole x={20} yFixed={18} yPivot={42} h={60} closed={s?.contactClosed ?? true} nc />
          <MushroomActuator y={30} />
        </g>
      );
    }
    case 'breaker3': {
      const s = st(state, 'breaker3');
      const closed = s?.closed ?? true;
      return (
        <g>
          <rect x={2} y={6} width={g.w - 4} height={g.h - 12} rx={3} className="frame" />
          {[20, 40, 60].map((x) => (
            <g key={x}>
              <Pole x={x} yFixed={26} yPivot={54} h={80} closed={closed} />
              <path d={`M ${x - 3} 23 l 6 6 m 0 -6 l -6 6`} className="thin" />
            </g>
          ))}
          <line x1={9} y1={40} x2={60} y2={40} strokeDasharray="4 3" className="thin" />
          <path d="M 4 34 h 5 v 12 h -5" className="thin" />
        </g>
      );
    }
    case 'lamp': {
      const s = st(state, 'lamp');
      return (
        <g className={s?.lit ? 'lamp-sym lit' : 'lamp-sym'}>
          <line x1={20} y1={0} x2={20} y2={18} />
          <circle cx={20} cy={30} r={12} className="bulb" />
          <path d="M 11.5 21.5 L 28.5 38.5 M 28.5 21.5 L 11.5 38.5" />
          <line x1={20} y1={42} x2={20} y2={60} />
        </g>
      );
    }
    case 'terminal':
      return (
        <g>
          <line x1={10} y1={0} x2={10} y2={15} />
          <circle cx={10} cy={20} r={5} className="box" />
          <line x1={10} y1={25} x2={10} y2={40} />
        </g>
      );
    case 'contactor': {
      const s = st(state, 'contactor');
      const closed = s?.closed ?? false;
      return (
        <g>
          <rect x={2} y={6} width={g.w - 4} height={g.h - 12} rx={3} className="frame" />
          {[20, 40, 60, 80].map((x) => (
            <Pole key={x} x={x} yFixed={26} yPivot={54} h={80} closed={closed} />
          ))}
          <Pole x={100} yFixed={26} yPivot={54} h={80} closed={!closed} nc />
          <line x1={12} y1={40} x2={104} y2={40} strokeDasharray="4 3" className="thin" />
          <line x1={120} y1={0} x2={120} y2={28} />
          <rect x={110} y={28} width={20} height={24} className={s?.coilEnergized ? 'coil on' : 'coil'} />
          <line x1={120} y1={52} x2={120} y2={80} />
        </g>
      );
    }
    case 'thermal': {
      const s = st(state, 'thermal');
      const tripped = s?.tripped ?? false;
      return (
        <g className={tripped ? 'tripped' : ''}>
          <rect x={2} y={6} width={g.w - 4} height={g.h - 12} rx={3} className="frame" />
          {[20, 40, 60].map((x) => (
            <g key={x}>
              <line x1={x} y1={0} x2={x} y2={28} />
              <path d={`M ${x} 28 h -6 v 8 h 12 v 8 h -6`} className="heater" />
              <line x1={x} y1={44} x2={x} y2={80} />
            </g>
          ))}
          <Pole x={80} yFixed={26} yPivot={54} h={80} closed={!tripped} nc />
          <Pole x={100} yFixed={26} yPivot={54} h={80} closed={tripped} />
          <line x1={26} y1={40} x2={84} y2={40} strokeDasharray="4 3" className="thin" />
        </g>
      );
    }
    case 'motor3': {
      const s = st(state, 'motor3');
      const cls = s?.powered ? 'motor powered' : s?.running ? 'motor coasting' : 'motor';
      return (
        <g className={cls}>
          <line x1={20} y1={0} x2={20} y2={34} />
          <line x1={40} y1={0} x2={40} y2={24} />
          <line x1={60} y1={0} x2={60} y2={34} />
          <circle cx={40} cy={50} r={26} className="box" />
          <g transform={`rotate(${s?.angleDeg ?? 0} 40 50)`} className="rotor">
            {[0, 120, 240].map((a) => (
              <path key={a} d="M 40 27 L 37 31 L 43 31 Z" transform={`rotate(${a} 40 50)`} />
            ))}
          </g>
          <text x={40} y={50} className="sym-text">
            M
          </text>
          <text x={40} y={64} className="sym-text small">
            3~
          </text>
        </g>
      );
    }
    case 'plc': {
      const s = st(state, 'plc');
      return (
        <g>
          <rect x={4} y={6} width={g.w - 8} height={g.h - 12} rx={4} className="box" />
          {PLC_DI.map((_, i) => (
            <rect key={i} x={56 + i * 20} y={30} width={8} height={5} className={s?.diTerminals[i] ? 'led on' : 'led'} />
          ))}
          {PLC_DQ.map((_, i) => (
            <rect key={i} x={56 + i * 20} y={65} width={8} height={5} className={s?.dqTerminals[i] ? 'led on' : 'led'} />
          ))}
          <rect x={14} y={44} width={8} height={5} className={s?.powered ? 'led on' : 'led'} />
          <text x={34} y={49} className="sym-text tiny" textAnchor="start">
            RUN
          </text>
          <text x={136} y={53} className="sym-text">
            PLC
          </text>
        </g>
      );
    }
  }
}

/** Kütüphane önizlemesi: sembolü verilen kutuya sığdırır. */
export function SymbolPreview({ type, width = 64, height = 48 }: { type: ComponentType; width?: number; height?: number }) {
  const g = GEOMETRY[type];
  return (
    <svg viewBox={`-6 -6 ${g.w + 12} ${g.h + 12}`} width={width} height={height} className="preview" aria-hidden>
      <SymbolBody type={type} />
      {g.terminals.map((t) => (
        <circle key={t.name} cx={t.x} cy={t.y} r={3} className="terminal" />
      ))}
    </svg>
  );
}
