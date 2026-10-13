// Mekanik elemanlar (silindir, konveyör, fan, pompa): animasyonlu semboller ve görünüm tanımları.
// Durum verilmezse (düzenleme modu, kütüphane önizlemesi) dinlenme konumunda çizilir.

import { numParam, strParam } from '../../sim/catalog';
import type { ComponentState } from '../../sim/simulation';
import { bottom, motorClass, Rotor, top } from './common';
import { defineView, type SymbolInstance } from './types';

type State<T extends ComponentState['type']> = (ComponentState & { type: T }) | undefined;

// --- Pnömatik silindir --------------------------------------------------------------------

const BARREL = { x0: 70, x1: 140, y0: 30, y1: 58 };
const PISTON_TRAVEL = 60;
const ROD_LENGTH = 90;

export function CylinderBody({ inst, s }: { inst: SymbolInstance; s: State<'cylinder'> }) {
  const pos = s?.position ?? 0;
  const px = BARREL.x0 + 2 + PISTON_TRAVEL * pos;
  const tip = px + 6 + ROD_LENGTH;
  const valve = s?.valve ?? false;
  return (
    <g className={`mech cylinder${s?.fault ? ' tripped' : ''}`}>
      <rect x={0} y={0} width={240} height={80} className="hit" />
      {/* Valf bobini (A1-A2) */}
      <line x1={20} y1={0} x2={20} y2={10} />
      <line x1={40} y1={0} x2={40} y2={10} />
      <rect x={14} y={10} width={32} height={14} className={valve ? 'coil on' : s?.fault ? 'coil fault' : 'coil'} />
      {strParam(inst, 'coilVoltage') === '230AC' && (
        <text x={30} y={17} className="sym-text tiny">
          ~
        </text>
      )}
      {/* 5/2 valf gövdesi: etkin konum vurgulanır */}
      <rect x={10} y={30} width={20} height={24} className={valve ? 'valve-pos active' : 'valve-pos'} />
      <rect x={30} y={30} width={20} height={24} className={valve ? 'valve-pos' : 'valve-pos active'} />
      <path d="M 14 36 L 26 48 M 26 36 L 14 48" className="thin" />
      <path d="M 34 36 V 48 M 46 36 V 48" className="thin" />
      {/* Hortumlar: üst port silindirin önüne, alt port arkasına */}
      <path d="M 50 36 H 56 V 14 H 132 V 30" className={valve ? 'hose' : 'hose live'} />
      <path d="M 50 48 H 62 V 22 H 76 V 30" className={valve ? 'hose live' : 'hose'} />
      {/* Gövde, piston ve mil */}
      <rect x={BARREL.x0} y={BARREL.y0} width={BARREL.x1 - BARREL.x0} height={BARREL.y1 - BARREL.y0} className="box" />
      <rect x={px} y={BARREL.y0 + 2} width={6} height={BARREL.y1 - BARREL.y0 - 4} className="piston" />
      <rect x={px + 6} y={41} width={ROD_LENGTH} height={6} className="rod" />
      <rect x={tip} y={34} width={5} height={20} className="piston" />
      {/* Uç sensörleri: geride 13-14, ileride 23-24 */}
      <line x1={70} y1={80} x2={70} y2={64} />
      <line x1={90} y1={80} x2={90} y2={64} />
      <rect x={70} y={58} width={20} height={6} className={s?.retracted ? 'sensor on' : 'sensor'} />
      <line x1={120} y1={80} x2={120} y2={64} />
      <line x1={140} y1={80} x2={140} y2={64} />
      <rect x={120} y={58} width={20} height={6} className={s?.extended ? 'sensor on' : 'sensor'} />
    </g>
  );
}

// --- Konveyör -----------------------------------------------------------------------------

/** Bandın kutu taşıyan kısmı: 82..250. Çizgi deseninin periyodu (12) uzunluğu tam böler. */
const BELT = { x0: 82, len: 168, top: 54, bottom: 70 };

export function ConveyorBody({ s }: { inst: SymbolInstance; s: State<'conveyor'> }) {
  const boxLen = (s?.boxLength ?? 0.12) * BELT.len;
  const sensorX = BELT.x0 + (s?.sensorAt ?? 0.76) * BELT.len;
  const beltShift = (s?.beltPos ?? 0) * BELT.len;
  const rollerAngle = (beltShift / 7) * (180 / Math.PI);
  return (
    <g className="mech conveyor">
      <rect x={0} y={0} width={260} height={80} className="hit" />
      {/* Tahrik motoru */}
      <g className={motorClass(s)}>
        <line x1={20} y1={0} x2={20} y2={42} />
        <line x1={40} y1={0} x2={40} y2={28} />
        <line x1={60} y1={0} x2={60} y2={42} />
        <circle cx={40} cy={50} r={22} className="box" />
        <Rotor cx={40} cy={50} r={20} angle={s ? rollerAngle : 0} />
        <text x={40} y={52} className="sym-text small">
          M 3~
        </text>
      </g>
      <line x1={62} y1={62} x2={82} y2={62} strokeDasharray="3 2" className="thin" />
      {/* Bant ve tamburlar */}
      <rect x={BELT.x0 - 4} y={BELT.top} width={BELT.len + 8} height={BELT.bottom - BELT.top} rx={8} className="belt" />
      <line
        x1={BELT.x0}
        y1={BELT.top}
        x2={BELT.x0 + BELT.len}
        y2={BELT.top}
        className="belt-marks"
        strokeDashoffset={-beltShift}
      />
      {[BELT.x0 + 6, BELT.x0 + BELT.len - 6].map((cx) => (
        <g key={cx} transform={`rotate(${rollerAngle} ${cx} 62)`}>
          <circle cx={cx} cy={62} r={6} className="box" />
          <line x1={cx - 6} y1={62} x2={cx + 6} y2={62} className="thin" />
        </g>
      ))}
      {/* Kutular */}
      {s?.boxes.map((p, i) => (
        <g key={i} className={s.boxMetal[i] ? 'crate metal' : 'crate'}>
          <rect x={BELT.x0 + p * BELT.len} y={BELT.top - 18} width={boxLen} height={18} rx={1.5} />
          <path
            d={`M ${BELT.x0 + p * BELT.len + 3} ${BELT.top - 9} h ${boxLen - 6}`}
            className="crate-tape"
          />
        </g>
      ))}
      {/* Fotosel (13-14): ışın kesilince kapanır */}
      <line x1={200} y1={0} x2={200} y2={16} />
      <line x1={220} y1={0} x2={220} y2={16} />
      <rect x={200} y={16} width={20} height={12} rx={2} className={s?.sensor ? 'sensor on' : 'sensor'} />
      <line x1={sensorX} y1={28} x2={sensorX} y2={BELT.top} className={s?.sensor ? 'beam blocked' : 'beam'} />
    </g>
  );
}

// --- Fan ----------------------------------------------------------------------------------

export function FanBody({ inst, s }: { inst: SymbolInstance; s: State<'fan'> }) {
  return (
    <g className={`mech fan ${motorClass(s)}${s?.fault ? ' tripped' : ''}`}>
      <line x1={20} y1={0} x2={20} y2={25} />
      <line x1={40} y1={0} x2={40} y2={25} />
      <circle cx={30} cy={44} r={22} className="box" />
      <g transform={`rotate(${s?.angleDeg ?? 0} 30 44)`} className="fan-blades">
        {[0, 90, 180, 270].map((a) => (
          <path key={a} d="M 30 44 C 24 36 26 26 32 25 C 36 30 35 38 30 44 Z" transform={`rotate(${a} 30 44)`} />
        ))}
      </g>
      <circle cx={30} cy={44} r={3} className="hub" />
      <text x={54} y={74} className="sym-text tiny">
        {strParam(inst, 'voltage') === '230AC' ? '~' : '='}
      </text>
    </g>
  );
}

// --- Pompa + depo -------------------------------------------------------------------------

const TANK = { x0: 100, x1: 170, top: 30, bottom: 130 };

export function PumpBody({ inst, s }: { inst: SymbolInstance; s: State<'pump'> }) {
  const level = s?.level ?? numParam(inst, 'initialPct') / 100;
  const h = TANK.bottom - TANK.top;
  const yAt = (f: number) => TANK.bottom - f * h;
  const pumping = !!s && Math.abs(s.speed) > 0.05;
  const draining = numParam(inst, 'drainS') > 0 && level > 0 && !!s;
  return (
    <g className={`mech pump${s?.overflowing ? ' overflow' : ''}`}>
      <rect x={0} y={0} width={200} height={140} className="hit" />
      {/* Pompa motoru */}
      <g className={motorClass(s)}>
        <line x1={20} y1={0} x2={20} y2={34} />
        <line x1={40} y1={0} x2={40} y2={24} />
        <line x1={60} y1={0} x2={60} y2={34} />
        <circle cx={40} cy={50} r={26} className="box" />
        <Rotor cx={40} cy={50} r={23} angle={s?.angleDeg ?? 0} />
        <text x={40} y={46} className="sym-text">
          P
        </text>
        <text x={40} y={60} className="sym-text small">
          3~
        </text>
      </g>
      {/* Basma hattı ve tüketim çıkışı */}
      <path d="M 66 50 H 84 V 18 H 130 V 32" className="pipe" />
      <path d="M 66 50 H 84 V 18 H 130 V 32" className={pumping ? 'flow on' : 'flow'} />
      <path d={`M 135 ${TANK.bottom} V 140`} className="pipe" />
      <path d={`M 135 ${TANK.bottom} V 140`} className={draining ? 'flow on' : 'flow'} />
      {/* Depo ve su */}
      <rect x={TANK.x0} y={TANK.top} width={TANK.x1 - TANK.x0} height={h} className="box tank" />
      {level > 0 && (
        <rect x={TANK.x0 + 1} y={yAt(level)} width={TANK.x1 - TANK.x0 - 2} height={level * h - 1} className="water" />
      )}
      {s?.overflowing && <path d={`M ${TANK.x0} ${TANK.top} q -6 10 -4 24`} className="spill" />}
      {/* Seviye sensörleri: üst 23-24, alt 13-14 */}
      {[
        { f: s?.highAt ?? 0.8, on: s?.high, y0: 40 },
        { f: s?.lowAt ?? 0.2, on: s?.low, y0: 100 },
      ].map(({ f, on, y0 }) => (
        <g key={y0}>
          <line x1={TANK.x0} y1={yAt(f)} x2={TANK.x1} y2={yAt(f)} strokeDasharray="2 3" className="thin level-mark" />
          <rect x={172} y={y0} width={14} height={20} rx={2} className={on ? 'sensor on' : 'sensor'} />
          <line x1={186} y1={y0} x2={200} y2={y0} />
          <line x1={186} y1={y0 + 20} x2={200} y2={y0 + 20} />
        </g>
      ))}
      <text x={TANK.x0 + (TANK.x1 - TANK.x0) / 2} y={TANK.top + 10} className="sym-text tiny">
        {Math.round(level * 100)}%
      </text>
    </g>
  );
}

// --- Görünüm tanımları ----------------------------------------------------------------------

export const cylinderView = defineView<NonNullable<State<'cylinder'>>>({
  type: 'cylinder',
  geometry: {
    w: 240,
    h: 80,
    terminals: [top('A1', 20), top('A2', 40), bottom('13', 70, 80), bottom('14', 90, 80), bottom('23', 120, 80), bottom('24', 140, 80)],
  },
  Body: CylinderBody,
});

export const conveyorView = defineView<NonNullable<State<'conveyor'>>>({
  type: 'conveyor',
  geometry: { w: 260, h: 80, terminals: [top('U', 20), top('V', 40), top('W', 60), top('13', 200), top('14', 220)] },
  Body: ConveyorBody,
  click: { action: 'addBox' },
  controls: [{ kind: 'button', label: 'Kutu ekle', action: 'addBox' }],
});

export const fanView = defineView<NonNullable<State<'fan'>>>({
  type: 'fan',
  geometry: { w: 60, h: 80, terminals: [top('X1', 20), top('X2', 40)] },
  Body: FanBody,
});

export const pumpView = defineView<NonNullable<State<'pump'>>>({
  type: 'pump',
  geometry: {
    w: 200,
    h: 140,
    terminals: [
      top('U', 20),
      top('V', 40),
      top('W', 60),
      ...[['23', 40], ['24', 60], ['13', 100], ['14', 120]].map(([name, y]) => ({
        name: name as string,
        x: 200,
        y: y as number,
        dir: 'right' as const,
      })),
    ],
  },
  Body: PumpBody,
});
