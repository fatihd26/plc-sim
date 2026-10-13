// IEC 60617 esinli sembol çizimleri (yerel koordinat). Durum verilirse canlı gösterilir.

import type { ReactNode } from 'react';
import { ANALOG_FULL } from '../../sim/address';
import { ESP32_PINS, PLC_AI, PLC_AQ, PLC_DI, PLC_DQ, strParam, type CustomDef } from '../../sim/catalog';
import type { ComponentState } from '../../sim/simulation';
import { viewOf } from '../devices';
import type { SymbolInstance } from '../devices/types';
import { geometryOf } from './geometry';

export type { SymbolInstance };

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

function PushActuator({ y, x = 0 }: { y: number; x?: number }) {
  return (
    <g className="actuator" transform={x ? `translate(${x} 0)` : undefined}>
      <path d={`M 7 ${y - 7} L 3 ${y - 7} L 3 ${y + 7} L 7 ${y + 7}`} />
      <line x1={3} y1={y} x2={14} y2={y} strokeDasharray="3 2" />
    </g>
  );
}

const st = <T extends ComponentState['type']>(s: ComponentState | undefined, t: T) =>
  s?.type === t ? (s as ComponentState & { type: T }) : undefined;

interface BodyProps {
  inst: SymbolInstance;
  state?: ComponentState;
  /** Sayfa geçişi: aynı etiketli geçişlerin bulunduğu sayfalar ("/2, /3"). */
  xrefText?: string;
}

export function SymbolBody({ inst, state, xrefText }: BodyProps): ReactNode {
  const g = geometryOf(inst);
  switch (inst.type) {
    case 'mains3':
      return (
        <g>
          <rect x={4} y={2} width={92} height={26} rx={2} className="box" />
          <text x={50} y={19} className="sym-text">
            3~/N 400/230 V
          </text>
          {[20, 40, 60, 80].map((x) => (
            <line key={x} x1={x} y1={28} x2={x} y2={40} />
          ))}
        </g>
      );
    case 'psu24': {
      const s = st(state, 'psu24');
      return (
        <g className={s?.limited ? 'tripped' : ''}>
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
    }
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
        <g className={s?.tripped ? 'tripped' : ''}>
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
    case 'fuse': {
      const s = st(state, 'fuse');
      return (
        <g className={s?.tripped ? 'tripped' : ''}>
          <rect x={0} y={0} width={40} height={60} className="hit" />
          <Pole x={20} yFixed={18} yPivot={42} h={60} closed={s?.closed ?? true} />
          <path d="M 17 15 l 6 6 m 0 -6 l -6 6" className="thin" />
          <path d="M 4 26 h 5 v 8 h -5" className="thin" />
        </g>
      );
    }
    case 'lamp': {
      const s = st(state, 'lamp');
      const color = strParam(inst, 'color');
      return (
        <g className={`lamp-sym lamp-${color}${s?.lit ? ' lit' : ''}${s?.fault ? ' tripped' : ''}`}>
          <line x1={20} y1={0} x2={20} y2={18} />
          <circle cx={20} cy={30} r={12} className="bulb" />
          <path d="M 11.5 21.5 L 28.5 38.5 M 28.5 21.5 L 11.5 38.5" />
          <line x1={20} y1={42} x2={20} y2={60} />
          {strParam(inst, 'voltage') === '230AC' && (
            <text x={34} y={52} className="sym-text tiny">
              ~
            </text>
          )}
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
    case 'junction':
      return <circle cx={10} cy={10} r={3.5} className="junction-dot" />;
    case 'xref':
      return (
        <g>
          <path d="M 0 10 L 10 2 H 58 V 18 H 10 Z" className="box" />
          {xrefText && (
            <text x={34} y={14} className="sym-text tiny">
              {xrefText}
            </text>
          )}
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
          <rect
            x={110}
            y={28}
            width={20}
            height={24}
            className={s?.coilEnergized ? 'coil on' : s?.fault ? 'coil fault' : 'coil'}
          />
          <line x1={120} y1={52} x2={120} y2={80} />
          {strParam(inst, 'coilVoltage') === '230AC' && (
            <text x={120} y={44} className="sym-text tiny">
              ~
            </text>
          )}
        </g>
      );
    }
    case 'relay': {
      const s = st(state, 'relay');
      const closed = s?.closed ?? false;
      return (
        <g>
          <rect x={2} y={6} width={g.w - 4} height={g.h - 12} rx={3} className="frame" />
          <Pole x={20} yFixed={26} yPivot={54} h={80} closed={closed} />
          <Pole x={40} yFixed={26} yPivot={54} h={80} closed={closed} />
          <Pole x={60} yFixed={26} yPivot={54} h={80} closed={!closed} nc />
          <line x1={12} y1={40} x2={64} y2={40} strokeDasharray="4 3" className="thin" />
          <line x1={80} y1={0} x2={80} y2={28} />
          <rect x={71} y={28} width={18} height={24} className={s?.coilEnergized ? 'coil on' : s?.fault ? 'coil fault' : 'coil'} />
          <line x1={80} y1={52} x2={80} y2={80} />
          {strParam(inst, 'coilVoltage') === '230AC' && (
            <text x={80} y={44} className="sym-text tiny">
              ~
            </text>
          )}
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
          <text x={208} y={50} className="sym-text tiny">
            485
          </text>
          {[...PLC_AI, ...PLC_AQ].map((name, i) => {
            const raw = i < PLC_AI.length ? s?.ai[i]?.raw : s?.aq[i - PLC_AI.length];
            const y = 20 + i * 20;
            return (
              <g key={name}>
                <line x1={0} y1={y} x2={4} y2={y} />
                <text x={8} y={y + 3} className="sym-text tiny" textAnchor="start">
                  {s && raw !== undefined ? analogText(raw) : i < PLC_AI.length ? 'AI' : 'AQ'}
                </text>
              </g>
            );
          })}
        </g>
      );
    }
    case 'esp32': {
      const s = st(state, 'esp32');
      return (
        <g>
          <rect x={4} y={6} width={g.w - 8} height={g.h - 12} rx={4} className="box" />
          {ESP32_PINS.map((pin, i) => (
            <rect
              key={pin}
              x={16 + i * 20}
              y={74}
              width={8}
              height={5}
              className={s?.pins.find((p) => p.pin === pin)?.on ? 'led on' : 'led'}
            />
          ))}
          <rect x={14} y={20} width={8} height={5} className={s?.powered ? 'led on' : 'led'} />
          <text x={26} y={23} className="sym-text tiny" textAnchor="start">
            PWR
          </text>
          <rect x={104} y={20} width={8} height={5} className={s?.busPeers.length ? 'led on' : s?.rs485Fault ? 'led fault' : 'led'} />
          <text x={116} y={23} className="sym-text tiny" textAnchor="start">
            485
          </text>
          <text x={80} y={46} className="sym-text">
            ESP32
          </text>
          <text x={120} y={66} className="sym-text tiny">
            {s ? `${(s.adcMv / 1000).toFixed(1)} V` : '0–10 V'}
          </text>
        </g>
      );
    }
    case 'custom':
      return <CustomBody def={inst.custom} state={st(state, 'custom')} w={g.w} />;
    default: {
      const view = viewOf(inst.type);
      if (!view) return <rect x={0} y={0} width={g.w} height={g.h} className="box" />;
      return <view.Body inst={inst} s={state?.type === inst.type ? state : undefined} />;
    }
  }
}

/** Kullanıcı bileşeni: kutup türüne göre kontak, bobin, lamba veya köprü; ortak çerçeve. */
function CustomBody({ def, state, w }: { def?: CustomDef; state?: ComponentState & { type: 'custom' }; w: number }) {
  const poles = def?.poles ?? [];
  const xs = (kinds: string[]) => poles.flatMap((p, i) => (kinds.includes(p.kind) ? [20 + i * 20] : []));
  const contactXs = xs(['NO', 'NC']);
  const pushXs = xs(['pushNO', 'pushNC']);
  return (
    <g className={state?.fault ? 'tripped' : state?.pressed ? 'pressed' : ''}>
      <rect x={0} y={0} width={w} height={80} className="hit" />
      <rect x={2} y={6} width={w - 4} height={68} rx={3} className="frame" />
      {poles.map((p, i) => {
        const x = 20 + i * 20;
        const on = state?.poles[i];
        switch (p.kind) {
          case 'link':
            return <line key={i} x1={x} y1={0} x2={x} y2={80} />;
          case 'NO':
          case 'pushNO':
            return <Pole key={i} x={x} yFixed={26} yPivot={54} h={80} closed={on ?? false} />;
          case 'NC':
          case 'pushNC':
            return <Pole key={i} x={x} yFixed={26} yPivot={54} h={80} closed={on ?? true} nc />;
          case 'coil':
            return (
              <g key={i}>
                <line x1={x} y1={0} x2={x} y2={28} />
                <rect x={x - 7} y={28} width={14} height={24} className={on ? 'coil on' : 'coil'} />
                <line x1={x} y1={52} x2={x} y2={80} />
              </g>
            );
          case 'lamp':
            return (
              <g key={i} className={on ? 'lamp-sym lamp-yellow lit' : 'lamp-sym lamp-yellow'}>
                <line x1={x} y1={0} x2={x} y2={32} />
                <circle cx={x} cy={40} r={8} className="bulb" />
                <path d={`M ${x - 5.5} 34.5 L ${x + 5.5} 45.5 M ${x + 5.5} 34.5 L ${x - 5.5} 45.5`} />
                <line x1={x} y1={48} x2={x} y2={80} />
              </g>
            );
        }
      })}
      {contactXs.length > 1 && (
        <line
          x1={contactXs[0]! - 6}
          y1={40}
          x2={contactXs[contactXs.length - 1]! - 6}
          y2={40}
          strokeDasharray="4 3"
          className="thin"
        />
      )}
      {pushXs.length > 0 && <PushActuator y={40} x={pushXs[0]! - 20} />}
      <text x={w - 6} y={16} className="sym-text tiny" textAnchor="end">
        {def?.title ?? ''}
      </text>
    </g>
  );
}

/** Kütüphane önizlemesi: sembolü verilen kutuya sığdırır. */
export function SymbolPreview({ inst, width = 64, height = 48 }: { inst: SymbolInstance; width?: number; height?: number }) {
  const g = geometryOf(inst);
  return (
    <svg viewBox={`-6 -6 ${g.w + 12} ${g.h + 12}`} width={width} height={height} className="preview" aria-hidden>
      <SymbolBody inst={inst} />
      {g.terminals.map((t) => (
        <circle key={t.name} cx={t.x} cy={t.y} r={3} className="terminal" />
      ))}
    </svg>
  );
}

/** Analog ham değerin kısa gösterimi (0..27648 → 0..10 V; 32767 = taşma/kablo kopuk). */
function analogText(raw: number): string {
  if (raw >= 32767) return '!!';
  return `${((raw * 10) / ANALOG_FULL).toFixed(1)}`;
}
